/**
 * Lore Index Manager Service
 *
 * Manages the isolated /opt/comics-now/lore-index.db database.
 * Stores canonical reading orders, story arcs, and multiverse chronologies across publishers,
 * computes "owned vs missing" gap analysis against the user's library,
 * and provides safe on-demand synchronization back into comics-now.db.
 */

const crypto = require('crypto');
const Database = require('better-sqlite3');

function getHashId(seed) {
  return crypto.createHash('sha1').update(String(seed)).digest('hex');
}

function normalizeStr(s) {
  return (s || '').trim().toLowerCase();
}

function normalizeNumber(num) {
  if (num == null) return '';
  const s = String(num).trim();
  if (/^\d+$/.test(s)) {
    return String(parseInt(s, 10));
  }
  return s.toLowerCase();
}

/**
 * Initializes the SQLite lore database schema.
 */
function initLoreDatabase(dbPath = '/opt/comics-now/lore-index.db') {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS reading_orders (
      id TEXT PRIMARY KEY,
      publisher TEXT,
      name TEXT NOT NULL,
      description TEXT,
      source_url TEXT,
      total_canonical_issues INTEGER DEFAULT 0,
      owned_issues_count INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS reading_order_issues (
      id TEXT PRIMARY KEY,
      reading_order_id TEXT NOT NULL,
      sequence_num INTEGER NOT NULL,
      series TEXT NOT NULL,
      number TEXT,
      title TEXT,
      publisher TEXT,
      role TEXT,
      local_comic_id TEXT,
      is_owned INTEGER DEFAULT 0,
      FOREIGN KEY (reading_order_id) REFERENCES reading_orders(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS story_arcs (
      id TEXT PRIMARY KEY,
      publisher TEXT,
      name TEXT NOT NULL,
      start_year INTEGER,
      end_year INTEGER,
      description TEXT,
      multiverse_lore TEXT
    );

    CREATE TABLE IF NOT EXISTS crossover_bridges (
      id TEXT PRIMARY KEY,
      publisher_a TEXT,
      series_a TEXT,
      publisher_b TEXT,
      series_b TEXT,
      notes TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_roi_order ON reading_order_issues(reading_order_id);
    CREATE INDEX IF NOT EXISTS idx_roi_owned ON reading_order_issues(is_owned);
  `);

  return db;
}

/**
 * Matches a canonical issue candidate against the library comics list.
 */
function matchComicInLibrary(issue, libraryComics) {
  if (!Array.isArray(libraryComics) || libraryComics.length === 0) return null;

  const targetSeries = normalizeStr(issue.series);
  const targetNum = normalizeNumber(issue.number);

  // 1. Exact series match and issue number match
  const exact = libraryComics.find(c => {
    const s = normalizeStr(c.series);
    const n = normalizeNumber(c.issueNumber || c.number);
    if (s === targetSeries) {
      if (targetNum && n === targetNum) return true;
      if (!targetNum) return true;
    }
    return false;
  });
  if (exact) return exact;

  // 2. Substring or filename match (e.g. Omnibus / Special / Title in comic name)
  const partial = libraryComics.find(c => {
    const s = normalizeStr(c.series);
    const name = normalizeStr(c.name);
    const matchesSeries = s.includes(targetSeries) || targetSeries.includes(s) || name.includes(targetSeries);
    if (!matchesSeries) return false;

    if (targetNum && (name.includes(`#${targetNum}`) || name.includes(` ${targetNum} `) || name.includes(` ${targetNum}.`) || name.includes(` ${issue.number} `))) {
      return true;
    }
    if (issue.title && name.includes(normalizeStr(issue.title))) {
      return true;
    }
    return false;
  });
  if (partial) return partial;

  // 3. Subtitle / arc title phrase match
  if (issue.title) {
    const titleWords = normalizeStr(issue.title)
      .replace(/vol(ume)?\.?\s*\d+/gi, '')
      .replace(/#\s*\d+/gi, '')
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 3 && w !== 'tempest' && w !== 'issue' && w !== 'part');

    if (titleWords.length > 0) {
      const titleMatch = libraryComics.find(c => {
        const s = normalizeStr(c.series);
        const name = normalizeStr(c.name);
        const n = normalizeNumber(c.issueNumber || c.number);

        // If both have numbers and they conflict, do not match across different issues
        if (targetNum && n && targetNum !== n) return false;

        const matchesSeries = s.includes(targetSeries) || targetSeries.includes(s) || name.includes(targetSeries);
        if (!matchesSeries) return false;
        return titleWords.some(w => name.includes(w) || s.includes(w));
      });
      if (titleMatch) return titleMatch;
    }
  }

  return null;
}

/**
 * Indexes a canonical reading order into lore-index.db and maps owned comics.
 */
function indexReadingOrder(loreDb, orderData, libraryComics = []) {
  if (!orderData || !orderData.name) {
    throw new Error('Reading order name is required.');
  }

  const orderId = getHashId(orderData.name);
  const issues = Array.isArray(orderData.issues) ? orderData.issues : [];

  let ownedCount = 0;
  const processedIssues = issues.map((issue, idx) => {
    const matched = matchComicInLibrary(issue, libraryComics);
    const isOwned = matched ? 1 : 0;
    if (isOwned) ownedCount++;

    return {
      id: getHashId(`${orderId}-${idx}-${issue.series}-${issue.number || ''}`),
      reading_order_id: orderId,
      sequence_num: idx + 1,
      series: issue.series || 'Unknown Series',
      number: issue.number != null ? String(issue.number) : '',
      title: issue.title || '',
      publisher: issue.publisher || orderData.publisher || '',
      role: issue.role || 'Core',
      local_comic_id: matched ? matched.id : null,
      is_owned: isOwned
    };
  });

  // Begin transaction
  const upsertOrder = loreDb.prepare(`
    INSERT INTO reading_orders (id, publisher, name, description, source_url, total_canonical_issues, owned_issues_count, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET
      publisher = excluded.publisher,
      description = excluded.description,
      source_url = excluded.source_url,
      total_canonical_issues = excluded.total_canonical_issues,
      owned_issues_count = excluded.owned_issues_count,
      updated_at = CURRENT_TIMESTAMP
  `);

  const deleteOldIssues = loreDb.prepare('DELETE FROM reading_order_issues WHERE reading_order_id = ?');
  const insertIssue = loreDb.prepare(`
    INSERT INTO reading_order_issues (id, reading_order_id, sequence_num, series, number, title, publisher, role, local_comic_id, is_owned)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const transaction = loreDb.transaction(() => {
    upsertOrder.run(
      orderId,
      orderData.publisher || 'Multiple',
      orderData.name,
      orderData.description || '',
      orderData.source_url || '',
      issues.length,
      ownedCount
    );

    deleteOldIssues.run(orderId);

    for (const item of processedIssues) {
      insertIssue.run(
        item.id,
        item.reading_order_id,
        item.sequence_num,
        item.series,
        item.number,
        item.title,
        item.publisher,
        item.role,
        item.local_comic_id,
        item.is_owned
      );
    }
  });

  transaction();
  return orderId;
}

/**
 * Retrieves unowned canonical issues for gap tracking ("what am I missing?").
 */
function getMissingIssuesForOrder(loreDb, orderId) {
  return loreDb.prepare(`
    SELECT sequence_num, series, number, title, publisher, role
    FROM reading_order_issues
    WHERE reading_order_id = ? AND is_owned = 0
    ORDER BY sequence_num ASC
  `).all(orderId);
}

/**
 * Safely imports/syncs an indexed lore reading order into comics-now.db.
 * Enforces all 6 preservation & curation rules:
 * - Rule 1: Never delete user reading lists or remove comics
 * - Rule 2: Never reset user reading progress
 * - Rule 3: Multi-series only
 * - Rule 4: Threshold >= 3 owned comics
 * - Rule 5: No duplicate lists
 * - Rule 6: Multi-user parity sync across all registered users
 */
async function syncLoreOrderToComicsNow(loreDb, comicsNowDb, orderId, options = {}) {
  const order = loreDb.prepare('SELECT * FROM reading_orders WHERE id = ?').get(orderId);
  if (!order) {
    return { success: false, reason: `Reading order '${orderId}' not found in lore index.` };
  }

  // Get owned comics in sequence
  const ownedIssues = loreDb.prepare(`
    SELECT sequence_num, series, local_comic_id
    FROM reading_order_issues
    WHERE reading_order_id = ? AND is_owned = 1 AND local_comic_id IS NOT NULL
    ORDER BY sequence_num ASC
  `).all(orderId);

  // Enforce Rule 4: Minimum Threshold >= 3 comics
  if (ownedIssues.length < 3) {
    return {
      success: false,
      reason: `Rule 4 violation: Threshold requirement not met. Library only has ${ownedIssues.length} matching comics (minimum 3 required).`
    };
  }

  // Enforce Rule 3: Multi-Series Only (>= 2 distinct series)
  const distinctSeries = new Set(ownedIssues.map(i => normalizeStr(i.series)));
  if (distinctSeries.size < 2) {
    return {
      success: false,
      reason: `Rule 3 violation: Single-series list rejected (${distinctSeries.size} series). Reading lists must span at least 2 distinct series.`
    };
  }

  // Check if target database is better-sqlite3 or async helper
  const isBetterSqlite = typeof comicsNowDb.prepare === 'function';

  // Helper query methods
  const queryAll = async (sql, params = []) => {
    if (isBetterSqlite) return comicsNowDb.prepare(sql).all(...params);
    return comicsNowDb.dbAll(sql, params);
  };
  const queryGet = async (sql, params = []) => {
    if (isBetterSqlite) return comicsNowDb.prepare(sql).get(...params);
    return comicsNowDb.dbGet(sql, params);
  };
  const queryRun = async (sql, params = []) => {
    if (isBetterSqlite) return comicsNowDb.prepare(sql).run(...params);
    return comicsNowDb.dbRun(sql, params);
  };

  // Enforce Rule 5: Duplicate Prevention
  const existing = await queryGet('SELECT id FROM reading_lists WHERE name = ? AND userId = ?', [order.name, 'default-user']);
  if (existing) {
    return {
      success: false,
      reason: `Rule 5 violation: Reading list '${order.name}' already exists in Comics Now.`
    };
  }

  // Rule 6: Get all registered users (supports both userId and id column)
  let users = [];
  try {
    const userRows = await queryAll('SELECT userId FROM users');
    users = (userRows || []).map(u => ({ id: u.userId }));
  } catch (_) {
    try {
      const userRows = await queryAll('SELECT id FROM users');
      users = (userRows || []).map(u => ({ id: u.id }));
    } catch (_) {}
  }
  if (!users || users.length === 0) {
    users = [{ id: 'default-user' }];
  }

  // Insert reading list and items with multi-user parity
  for (const user of users) {
    const listId = getHashId(`${user.id}-${order.name}`);

    await queryRun(
      `INSERT OR IGNORE INTO reading_lists (id, userId, name, description, sortOrder)
       VALUES (?, ?, ?, ?, 0)`,
      [listId, user.id, order.name, order.description || '']
    );

    let itemSort = 0;
    for (const issue of ownedIssues) {
      await queryRun(
        `INSERT OR IGNORE INTO reading_list_items (listId, comicId, sortOrder)
         VALUES (?, ?, ?)`,
        [listId, issue.local_comic_id, itemSort++]
      );
    }
  }

  return {
    success: true,
    matchedComics: ownedIssues.length,
    totalCanonical: order.total_canonical_issues,
    usersSynced: users.length,
    listName: order.name
  };
}

function extractIssueNumber(row) {
  if (row.issueNumber != null && String(row.issueNumber).trim()) {
    return String(row.issueNumber).trim();
  }
  if (row.metadata) {
    try {
      const m = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata;
      if (m.Number != null && String(m.Number).trim()) return String(m.Number).trim();
      if (m.number != null && String(m.number).trim()) return String(m.number).trim();
    } catch (_) {}
  }
  if (row.name) {
    const m = row.name.match(/#\s*(\d+)/) || row.name.match(/\b(\d+)(?:\s*(?:of|\/)\s*\d+)?\s*$/i);
    if (m) return m[1];
  }
  return '';
}

/**
 * Crawls and indexes all publishers/libraries that have at most maxSeries distinct series.
 * Strictly ignores Marvel publishers ("and we ccan ignore marvel").
 */
function crawlPublishersWithMaxSeries(loreDb, comicsNowDb, options = {}) {
  const maxSeries = options.maxSeries || 10;
  const minComics = options.minComics || 1;
  const excludePublishers = options.excludePublishers || ['Marvel', 'Marvel Comics'];

  const isBetterSqlite = typeof comicsNowDb.prepare === 'function';
  const queryAll = (sql, params = []) => isBetterSqlite ? comicsNowDb.prepare(sql).all(...params) : comicsNowDb.all(sql, params);

  // Check columns present in comics table
  let hasMetadataCol = false;
  let hasIssueNumberCol = false;
  try {
    const cols = isBetterSqlite ? comicsNowDb.prepare('PRAGMA table_info(comics)').all() : [];
    hasMetadataCol = cols.some(c => c.name === 'metadata');
    hasIssueNumberCol = cols.some(c => c.name === 'issueNumber');
  } catch (_) {}

  // 1. Fetch publishers with <= maxSeries (excluding Marvel)
  const publisherRows = queryAll(`
    SELECT publisher, COUNT(DISTINCT series) as series_count, COUNT(*) as issue_count
    FROM comics
    WHERE publisher IS NOT NULL
      AND publisher != ''
      AND publisher NOT LIKE '%Marvel%'
    GROUP BY publisher
    HAVING series_count <= ? AND issue_count >= ?
    ORDER BY series_count ASC, issue_count DESC
  `, [maxSeries, minComics]);

  // Load all library comics for gap analysis
  const selectCols = ['id', 'publisher', 'series', 'name'];
  if (hasMetadataCol) selectCols.push('metadata');
  if (hasIssueNumberCol) selectCols.push('issueNumber');
  const allComicsRows = queryAll(`SELECT ${selectCols.join(', ')} FROM comics`);

  const libraryComics = allComicsRows.map(r => ({
    id: r.id,
    publisher: r.publisher,
    series: r.series,
    name: r.name,
    issueNumber: extractIssueNumber(r)
  }));

  let publishersProcessed = 0;
  let ordersIndexed = 0;
  let totalCanonical = 0;
  let totalOwned = 0;
  const indexedOrders = [];

  for (const pubRow of publisherRows) {
    const pubName = pubRow.publisher;
    if (excludePublishers.some(ex => pubName.toLowerCase().includes(ex.toLowerCase()))) {
      continue;
    }

    const seriesRows = queryAll(`
      SELECT series, COUNT(*) as count
      FROM comics
      WHERE publisher = ? AND series IS NOT NULL AND series != ''
      GROUP BY series
      ORDER BY series ASC
    `, [pubName]);

    if (seriesRows.length === 0) continue;
    publishersProcessed++;

    // 1. If publisher has >= 2 series, index a unified publisher chronology
    if (seriesRows.length >= 2) {
      const pubComics = queryAll(`
        SELECT ${selectCols.join(', ')}
        FROM comics
        WHERE publisher = ?
        ORDER BY series ASC, id ASC
      `, [pubName]);

      const publisherIssues = [];
      for (let i = 0; i < pubComics.length; i++) {
        const c = pubComics[i];
        const num = extractIssueNumber(c);
        publisherIssues.push({
          series: c.series,
          number: num || String(i + 1),
          title: c.name || `${c.series} #${num || i + 1}`,
          role: 'Franchise Issue'
        });
      }

      const pubOrderName = `${pubName}: Complete Reading Chronology`;
      const pubOrderObj = {
        name: pubOrderName,
        publisher: pubName,
        description: `Complete canonical library chronology for ${pubName} spanning ${seriesRows.length} distinct series.`,
        source_url: `local://comics-now/publisher/${encodeURIComponent(pubName)}`,
        issues: publisherIssues
      };

      const orderId = indexReadingOrder(loreDb, pubOrderObj, libraryComics);
      ordersIndexed++;
      const row = loreDb.prepare('SELECT total_canonical_issues, owned_issues_count FROM reading_orders WHERE id = ?').get(orderId);
      totalCanonical += row.total_canonical_issues;
      totalOwned += row.owned_issues_count;
      indexedOrders.push({
        id: orderId,
        publisher: pubName,
        name: pubOrderName,
        totalCanonical: row.total_canonical_issues,
        owned: row.owned_issues_count
      });
    }

    // 2. Index individual series canonical runs within the publisher
    for (const s of seriesRows) {
      const seriesComics = queryAll(`
        SELECT ${selectCols.join(', ')}
        FROM comics
        WHERE publisher = ? AND series = ?
        ORDER BY id ASC
      `, [pubName, s.series]);

      const seriesIssues = [];
      for (let j = 0; j < seriesComics.length; j++) {
        const sc = seriesComics[j];
        const num = extractIssueNumber(sc);
        seriesIssues.push({
          series: sc.series,
          number: num || String(j + 1),
          title: sc.name || `${sc.series} #${num || j + 1}`,
          role: 'Core Issue'
        });
      }

      const seriesOrderName = `${pubName}: ${s.series}`;
      const seriesOrderObj = {
        name: seriesOrderName,
        publisher: pubName,
        description: `Canonical run and reading order for ${s.series} (${pubName}).`,
        source_url: `local://comics-now/series/${encodeURIComponent(s.series)}`,
        issues: seriesIssues
      };

      const sOrderId = indexReadingOrder(loreDb, seriesOrderObj, libraryComics);
      ordersIndexed++;
      const sRow = loreDb.prepare('SELECT total_canonical_issues, owned_issues_count FROM reading_orders WHERE id = ?').get(sOrderId);
      totalCanonical += sRow.total_canonical_issues;
      totalOwned += sRow.owned_issues_count;
      indexedOrders.push({
        id: sOrderId,
        publisher: pubName,
        name: seriesOrderName,
        totalCanonical: sRow.total_canonical_issues,
        owned: sRow.owned_issues_count
      });
    }
  }

  return {
    publishersProcessed,
    ordersIndexed,
    totalCanonicalIssues: totalCanonical,
    ownedIssues: totalOwned,
    missingIssues: totalCanonical - totalOwned,
    orders: indexedOrders
  };
}

module.exports = {
  initLoreDatabase,
  indexReadingOrder,
  getMissingIssuesForOrder,
  syncLoreOrderToComicsNow,
  crawlPublishersWithMaxSeries
};
