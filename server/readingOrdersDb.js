/**
 * ReadingOrders Database Service
 *
 * Dedicated SQLite storage for scraped reading orders and story arcs.
 * Keeps reading order continuity isolated from user library state.
 */
const path = require('path');
const Database = require('better-sqlite3');
const { normalizeSeries, isIssueInRange } = require('./services/continuityMatcher');

const DEFAULT_DB_PATH = path.join(__dirname, '..', 'data', 'reading-orders.db');

function initReadingOrdersDb(dbPath = DEFAULT_DB_PATH) {
  const db = new Database(dbPath);

  // WAL mode for concurrency if not in-memory
  if (dbPath !== ':memory:') {
    db.pragma('journal_mode = WAL');
  }

  // Schema creation
  db.exec(`
    CREATE TABLE IF NOT EXISTS reading_orders (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      publisher TEXT,
      url TEXT,
      cover_image TEXT,
      description TEXT,
      category TEXT,
      total_issues INTEGER DEFAULT 0,
      total_collections INTEGER DEFAULT 0,
      last_scraped_mod TEXT,
      created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
      updated_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
    );

    CREATE TABLE IF NOT EXISTS reading_order_issues (
      id TEXT PRIMARY KEY,
      reading_order_id TEXT NOT NULL,
      position INTEGER NOT NULL,
      series_name TEXT NOT NULL,
      issue_number TEXT NOT NULL,
      issue_title TEXT,
      publication_date TEXT,
      importance TEXT DEFAULT 'Regular',
      story_parts TEXT,
      cover_image_url TEXT,
      collected_in_title TEXT,
      FOREIGN KEY (reading_order_id) REFERENCES reading_orders(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_roi_order_pos ON reading_order_issues(reading_order_id, position);
    CREATE INDEX IF NOT EXISTS idx_roi_lookup ON reading_order_issues(series_name COLLATE NOCASE, issue_number);

    CREATE TABLE IF NOT EXISTS reading_order_collections (
      id TEXT PRIMARY KEY,
      reading_order_id TEXT NOT NULL,
      position INTEGER NOT NULL,
      title TEXT NOT NULL,
      subtitle TEXT,
      page_count INTEGER,
      release_year INTEGER,
      description TEXT,
      contents_raw TEXT,
      cover_image_url TEXT,
      FOREIGN KEY (reading_order_id) REFERENCES reading_orders(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_roc_order_pos ON reading_order_collections(reading_order_id, position);
  `);

  // Self-heal known misclassified publishers
  try {
    db.prepare(`
      UPDATE reading_orders
      SET publisher = 'DC Comics'
      WHERE id = 'blackest-night' AND (publisher = 'Other' OR publisher IS NULL)
    `).run();
  } catch (_) {}

  // Prepared statements
  const insertOrderStmt = db.prepare(`
    INSERT INTO reading_orders (id, title, publisher, url, cover_image, description, category, last_scraped_mod, updated_at)
    VALUES (@id, @title, @publisher, @url, @coverImage, @description, @category, @lastScrapedMod, @updatedAt)
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      publisher = COALESCE(excluded.publisher, reading_orders.publisher),
      url = COALESCE(excluded.url, reading_orders.url),
      cover_image = COALESCE(excluded.cover_image, reading_orders.cover_image),
      description = COALESCE(excluded.description, reading_orders.description),
      category = COALESCE(excluded.category, reading_orders.category),
      last_scraped_mod = COALESCE(excluded.last_scraped_mod, reading_orders.last_scraped_mod),
      updated_at = excluded.updated_at
  `);

  const deleteIssuesForOrderStmt = db.prepare(`DELETE FROM reading_order_issues WHERE reading_order_id = ?`);
  const insertIssueStmt = db.prepare(`
    INSERT INTO reading_order_issues (
      id, reading_order_id, position, series_name, issue_number,
      issue_title, publication_date, importance, story_parts,
      cover_image_url, collected_in_title
    ) VALUES (
      @id, @readingOrderId, @position, @seriesName, @issueNumber,
      @issueTitle, @publicationDate, @importance, @storyParts,
      @coverImageUrl, @collectedInTitle
    )
  `);

  const deleteCollectionsForOrderStmt = db.prepare(`DELETE FROM reading_order_collections WHERE reading_order_id = ?`);
  const insertCollectionStmt = db.prepare(`
    INSERT INTO reading_order_collections (
      id, reading_order_id, position, title, subtitle,
      page_count, release_year, description, contents_raw, cover_image_url
    ) VALUES (
      @id, @readingOrderId, @position, @title, @subtitle,
      @pageCount, @releaseYear, @description, @contentsRaw, @coverImageUrl
    )
  `);

  const updateCountsStmt = db.prepare(`
    UPDATE reading_orders
    SET total_issues = (SELECT COUNT(*) FROM reading_order_issues WHERE reading_order_id = ?),
        total_collections = (SELECT COUNT(*) FROM reading_order_collections WHERE reading_order_id = ?)
    WHERE id = ?
  `);

  function upsertReadingOrder(order) {
    insertOrderStmt.run({
      id: order.id,
      title: order.title,
      publisher: order.publisher || null,
      url: order.url || null,
      coverImage: order.coverImage || null,
      description: order.description || null,
      category: order.category || 'Event',
      lastScrapedMod: order.lastScrapedMod || null,
      updatedAt: Date.now()
    });
  }

  function upsertIssues(orderId, issues) {
    const insertMany = db.transaction((rows) => {
      deleteIssuesForOrderStmt.run(orderId);
      let idx = 0;
      for (const row of rows) {
        idx++;
        insertIssueStmt.run({
          id: `${orderId}_${row.position || idx}_${idx}`,
          readingOrderId: orderId,
          position: row.position || idx,
          seriesName: row.seriesName,
          issueNumber: String(row.issueNumber || ''),
          issueTitle: row.issueTitle || null,
          publicationDate: row.publicationDate || null,
          importance: row.importance || 'Regular',
          storyParts: row.storyParts || null,
          coverImageUrl: row.coverImageUrl || null,
          collectedInTitle: row.collectedIn || null
        });
      }
      updateCountsStmt.run(orderId, orderId, orderId);
    });
    insertMany(issues);
  }

  function upsertCollections(orderId, collections) {
    const insertMany = db.transaction((rows) => {
      deleteCollectionsForOrderStmt.run(orderId);
      let idx = 0;
      for (const row of rows) {
        idx++;
        insertCollectionStmt.run({
          id: `${orderId}_col_${row.position || idx}_${idx}`,
          readingOrderId: orderId,
          position: row.position || idx,
          title: row.title,
          subtitle: row.subtitle || null,
          pageCount: row.pageCount || null,
          releaseYear: row.releaseYear || null,
          description: row.description || null,
          contentsRaw: row.contentsRaw || null,
          coverImageUrl: row.coverImageUrl || null
        });
      }
      updateCountsStmt.run(orderId, orderId, orderId);
    });
    insertMany(collections);
  }

  function getReadingOrders(options = {}) {
    let query = 'SELECT * FROM reading_orders';
    const params = [];
    if (options.publisher) {
      query += ' WHERE publisher = ?';
      params.push(options.publisher);
    }
    query += ' ORDER BY title ASC';
    if (options.limit) {
      query += ' LIMIT ?';
      params.push(options.limit);
      if (options.offset) {
        query += ' OFFSET ?';
        params.push(options.offset);
      }
    }
    return db.prepare(query).all(...params);
  }

  function getReadingOrderById(id) {
    return db.prepare('SELECT * FROM reading_orders WHERE id = ?').get(id);
  }

  function getReadingOrderIssues(orderId) {
    return db.prepare('SELECT * FROM reading_order_issues WHERE reading_order_id = ? ORDER BY position ASC').all(orderId);
  }

  function getReadingOrderCollections(orderId) {
    const rows = db.prepare('SELECT * FROM reading_order_collections WHERE reading_order_id = ? ORDER BY position ASC').all(orderId);
    return rows.map(r => ({
      id: r.id,
      readingOrderId: r.reading_order_id,
      position: r.position,
      title: r.title,
      subtitle: r.subtitle,
      pageCount: r.page_count,
      releaseYear: r.release_year,
      description: r.description,
      contentsRaw: r.contents_raw,
      coverImageUrl: r.cover_image_url
    }));
  }

  function findArcForIssue(seriesName, issueNumber) {
    if (!seriesName) return null;
    const normTargetSeries = normalizeSeries(seriesName);

    // 1. Fast exact lookup
    let match = db.prepare(`
      SELECT * FROM reading_order_issues
      WHERE series_name = ? COLLATE NOCASE AND issue_number = ?
      LIMIT 1
    `).get(seriesName, String(issueNumber));

    // 2. Normalized series and range lookup
    if (!match) {
      const candidates = db.prepare(`SELECT * FROM reading_order_issues`).all();
      match = candidates.find(c => {
        const normCandSeries = normalizeSeries(c.series_name);
        return normCandSeries === normTargetSeries && isIssueInRange(issueNumber, c.issue_number);
      });
    }

    if (!match) return null;

    const prev = db.prepare(`
      SELECT * FROM reading_order_issues
      WHERE reading_order_id = ? AND position < ?
      ORDER BY position DESC LIMIT 1
    `).get(match.reading_order_id, match.position);

    const next = db.prepare(`
      SELECT * FROM reading_order_issues
      WHERE reading_order_id = ? AND position > ?
      ORDER BY position ASC LIMIT 1
    `).get(match.reading_order_id, match.position);

    return {
      readingOrderId: match.reading_order_id,
      position: match.position,
      importance: match.importance,
      storyParts: match.story_parts,
      previousIssue: prev ? {
        position: prev.position,
        seriesName: prev.series_name,
        issueNumber: prev.issue_number,
        importance: prev.importance
      } : null,
      nextIssue: next ? {
        position: next.position,
        seriesName: next.series_name,
        issueNumber: next.issue_number,
        importance: next.importance
      } : null
    };
  }

  function findArcForCollection(comic) {
    if (!comic) return null;
    const seriesStr = String(comic.series || '').trim();
    const nameStr = String(comic.name || '').trim();
    const fullText = normalizeSeries(`${seriesStr} ${nameStr}`);
    if (!fullText) return null;

    const collections = db.prepare(`SELECT * FROM reading_order_collections ORDER BY position ASC`).all();
    if (!collections || collections.length === 0) return null;

    for (const col of collections) {
      const colTitleNorm = normalizeSeries(col.title);
      if (!colTitleNorm) continue;

      const vMatch = colTitleNorm.match(/\b(?:volume|vol|part|book)\s*(\d+|one|two|three|four|five)\b/i);
      if (vMatch) {
        const rootTitle = colTitleNorm.replace(/\b(?:volume|vol|part|book)\s*(\d+|one|two|three|four|five)\b/i, '').trim();
        const vToken = vMatch[1].toLowerCase();
        const numMap = { one: '1', two: '2', three: '3', four: '4', five: '5' };
        const vNum = numMap[vToken] || vToken;

        const hasRoot = fullText.includes(rootTitle);
        const hasVol = fullText.includes(`volume ${vNum}`) || fullText.includes(`vol ${vNum}`) || fullText.includes(`part ${vNum}`);
        if (hasRoot && hasVol) {
          return {
            readingOrderId: col.reading_order_id,
            position: col.position,
            importance: 'Essential',
            isCollection: true,
            collectionTitle: col.title
          };
        }
      } else {
        if (fullText.includes(colTitleNorm)) {
          if (fullText.includes('companion') && !colTitleNorm.includes('companion')) {
            continue;
          }
          return {
            readingOrderId: col.reading_order_id,
            position: col.position,
            importance: 'Essential',
            isCollection: true,
            collectionTitle: col.title
          };
        }
      }
    }

    return null;
  }

  return {
    db,
    upsertReadingOrder,
    upsertIssues,
    upsertCollections,
    getReadingOrders,
    getReadingOrderById,
    getReadingOrderIssues,
    getReadingOrderCollections,
    findArcForIssue,
    findArcForCollection
  };
}

module.exports = {
  initReadingOrdersDb,
  DEFAULT_DB_PATH
};
