#!/usr/bin/env node
/**
 * Comics Now - Lore Index Builder & Library Gap Analyzer
 *
 * Populates /opt/comics-now/lore-index.db with canonical reading orders,
 * analyzes owned vs. missing issues across your library, and provides
 * safe on-demand synchronization back into comics-now.db.
 */

const path = require('path');
const Database = require('better-sqlite3');
const {
  initLoreDatabase,
  indexReadingOrder,
  getMissingIssuesForOrder,
  syncLoreOrderToComicsNow,
  crawlPublishersWithMaxSeries
} = require('../server/services/lore-index-manager');
const {
  fetchUrlAsMarkdown,
  parseLoreWithGemini
} = require('../server/services/publisher-lore-extractor');

const LORE_DB_PATH = process.env.LORE_DB_PATH || path.join(__dirname, '../lore-index.db');
const COMICS_NOW_DB_PATH = process.env.COMICS_DB_PATH || path.join(__dirname, '../comics-now.db');

// Canonical Presets for Library Franchises (DC, Image, Dynamite, Cross-Publisher)
const CORE_CANONICAL_PRESETS = [
  {
    name: 'The League of Extraordinary Gentlemen: Complete Chronology',
    publisher: 'DC / ABC / Top Shelf / IDW',
    description: 'Alan Moore and Kevin O\'Neill\'s complete literary universe across all 4 publishing eras.',
    source_url: 'https://en.wikipedia.org/wiki/The_League_of_Extraordinary_Gentlemen',
    issues: [
      { series: 'The League of Extraordinary Gentlemen: The Omnibus Edition', number: '1', title: 'Volume I & Volume II (1898-1899)', role: 'Core Anchor' },
      { series: 'The League of Extraordinary Gentlemen: The Black Dossier', number: '1', title: 'The Black Dossier (1958)', role: 'Bridge' },
      { series: 'The League of Extraordinary Gentlemen: Century Complete Edition', number: '1', title: 'Volume III: Century (1910, 1969, 2009)', role: 'Core Anchor' },
      { series: 'Nemo: Heart of Ice', number: '1', title: 'Nemo Trilogy: Heart of Ice (1925)', role: 'Spinoff' },
      { series: 'Nemo: The Roses of Berlin', number: '1', title: 'Nemo Trilogy: The Roses of Berlin (1941)', role: 'Spinoff' },
      { series: 'Nemo: River of Ghosts', number: '1', title: 'Nemo Trilogy: River of Ghosts (1975)', role: 'Spinoff' },
      { series: 'The League of Extraordinary Gentlemen: The Tempest', number: '1', title: 'Volume IV: The Tempest #1', role: 'Finale' },
      { series: 'The League of Extraordinary Gentlemen: The Tempest', number: '2', title: 'Volume IV: The Tempest #2', role: 'Finale' },
      { series: 'The League of Extraordinary Gentlemen: The Tempest', number: '3', title: 'Volume IV: The Tempest #3', role: 'Finale' },
      { series: 'The League of Extraordinary Gentlemen: The Tempest', number: '4', title: 'Volume IV: The Tempest #4', role: 'Finale' },
      { series: 'The League of Extraordinary Gentlemen: The Tempest', number: '5', title: 'Volume IV: The Tempest #5', role: 'Finale' },
      { series: 'The League of Extraordinary Gentlemen: The Tempest', number: '6', title: 'Volume IV: The Tempest #6', role: 'Grand Finale' }
    ]
  },
  {
    name: 'Image: Ice Cream Man & Swan Songs (W. Maxwell Prince)',
    publisher: 'Image',
    description: 'W. Maxwell Prince & Martín Morazzo\'s existential horror universe and companion anthologies.',
    source_url: 'https://imagecomics.com/comics/series/ice-cream-man',
    issues: [
      { series: 'Ice Cream Man', number: '1', title: 'Vol. 1: Rainbow Sprinkles', role: 'Core Anchor' },
      { series: 'Ice Cream Man', number: '2', title: 'Vol. 2: Strange Neapolitan', role: 'Core Anchor' },
      { series: 'Ice Cream Man', number: '3', title: 'Vol. 3: Hopscotch Mélange', role: 'Core Anchor' },
      { series: 'Ice Cream Man', number: '4', title: 'Vol. 4: Tiny Lives', role: 'Core Anchor' },
      { series: 'Ice Cream Man', number: '5', title: 'Vol. 5: Other Confections', role: 'Core Anchor' },
      { series: 'Ice Cream Man', number: '6', title: 'Vol. 6: Just Desserts', role: 'Core Anchor' },
      { series: 'Ice Cream Man', number: '7', title: 'Vol. 7: Certain Descents', role: 'Core Anchor' },
      { series: 'Ice Cream Man', number: '8', title: 'Vol. 8: Subjects and Objects', role: 'Core Anchor' },
      { series: 'Ice Cream Man', number: '9', title: 'Vol. 9: Heavy Narration', role: 'Core Anchor' },
      { series: 'Ice Cream Man', number: '10', title: 'The Mortal Coil Shuffle', role: 'Core Anchor' },
      { series: 'Swan Songs', number: '1', title: 'Vol. 1: Endings Anthology', role: 'Thematic Companion' }
    ]
  },
  {
    name: 'The Tick: Intercompany Crossover Chronology',
    publisher: 'New England Comics / Image / Dark Horse',
    description: 'Ben Edlund\'s The Tick crossing dimensions into Image\'s Invincible and Dark Horse\'s Madman.',
    source_url: 'https://en.wikipedia.org/wiki/The_Tick',
    issues: [
      { series: 'The Tick: The Tick Meets Invincible', number: '100', title: 'The Tick Meets Invincible', role: 'Intercompany Crossover' },
      { series: 'The Tick: The Tick Meets Madman', number: '101', title: 'The Tick Meets Madman', role: 'Intercompany Crossover' },
      { series: 'Madman Library Edition', number: '1', title: 'Madman Library Edition Vol 1', role: 'Counterpart Canon' }
    ]
  },
  {
    name: 'Dynamite: Project Superpowers & Kirby Genesis',
    publisher: 'Dynamite Entertainment',
    description: 'Alex Ross and Jim Krueger\'s grand Golden Age revival and Jack Kirby universe.',
    source_url: 'https://en.wikipedia.org/wiki/Project_Superpowers',
    issues: [
      { series: 'Project: Superpowers Omnibus', number: '1', title: 'Chapter 1: The Urn of Pandora', role: 'Core Anchor' },
      { series: 'Project: Superpowers Omnibus', number: '2', title: 'Chapter 2: The Inheritors', role: 'Core Anchor' },
      { series: 'Project: Superpowers Omnibus', number: '3', title: 'Chapter 3: The Superpowers Reborn', role: 'Core Anchor' },
      { series: 'The Black Bat Omnibus: Redemption', number: '1', title: 'The Black Bat: Redemption', role: 'Spinoff Tie-in' },
      { series: 'Kirby Genesis', number: '1', title: 'Kirby Genesis Main Event', role: 'Kirbyverse Event' },
      { series: 'Kirby: Genesis Captain Victory', number: '1', title: 'Captain Victory #1', role: 'Tie-in' },
      { series: 'Kirby: Genesis Silver Star', number: '1', title: 'Silver Star #1', role: 'Tie-in' },
      { series: 'Kirby: Genesis Dragonsbane', number: '1', title: 'Dragonsbane #1', role: 'Tie-in' }
    ]
  },
  {
    name: 'Image: The Ghost Machine Shared Universe',
    publisher: 'Image',
    description: 'Geoff Johns & Gary Frank\'s creator-owned shared continuity.',
    source_url: 'https://ghostmachinepro.com',
    issues: [
      { series: 'Junkyard Joe', number: '1', title: 'Junkyard Joe: The Veteran', role: 'Core Anchor' },
      { series: 'Redcoat Deluxe Edition', number: '1', title: 'Redcoat: The Immortal of 1776', role: 'Core Anchor' },
      { series: 'The Rocketfellers', number: '1', title: 'The Rocketfellers: 26th Century Family', role: 'Core Anchor' },
      { series: 'Tales of the Unnamed: The Blizzard', number: '1', title: 'The Blizzard: Survival Horror', role: 'Anthology Tie-in' },
      { series: 'Sisterhood: A Hyde Street Story', number: '1', title: 'Hyde Street: Sisterhood', role: 'Horror Tie-in' }
    ]
  },
  {
    name: 'DC & Image Intercompany Crossovers',
    publisher: 'DC Comics / Image',
    description: 'Classic crossover epics uniting Batman, Superman, and Top Cow\'s The Darkness.',
    source_url: 'https://en.wikipedia.org/wiki/The_Darkness_(comics)',
    issues: [
      { series: 'The Darkness / Batman', number: '1', title: 'The Darkness / Batman #1', role: 'Crossover' },
      { series: 'The Darkness / Superman', number: '1', title: 'The Darkness / Superman #1', role: 'Crossover' },
      { series: 'The Darkness / Superman', number: '2', title: 'The Darkness / Superman #2', role: 'Crossover' }
    ]
  },
  {
    name: 'DC & Dynamite Pulp Crossovers',
    publisher: 'DC Comics / Dynamite',
    description: 'Golden Age pulp legends meeting the Batman family.',
    source_url: 'https://en.wikipedia.org/wiki/Batman_%2766',
    issues: [
      { series: 'Batman \'66 Meets the Green Hornet', number: '1', title: 'Batman \'66 Meets the Green Hornet', role: 'Crossover' },
      { series: 'The Shadow/Batman', number: '1', title: 'The Shadow / Batman HC', role: 'Crossover' },
      { series: 'The Green Hornet \'66 Meets The Spirit', number: '1', title: 'The Green Hornet \'66 Meets The Spirit', role: 'Crossover' }
    ]
  }
];

function getAllLibraryComics(comicsNowDb) {
  try {
    const rows = comicsNowDb.prepare('SELECT id, publisher, series, name, metadata FROM comics').all();
    return rows.map(r => {
      let num = '';
      if (r.metadata) {
        try {
          const m = JSON.parse(r.metadata);
          num = m.Number != null ? String(m.Number) : (m.number != null ? String(m.number) : '');
        } catch (_) {}
      }
      return {
        id: r.id,
        publisher: r.publisher,
        series: r.series,
        name: r.name,
        issueNumber: num
      };
    });
  } catch (err) {
    console.error('[LoreBuilder] Failed to query comics-now.db:', err.message);
    return [];
  }
}

async function main() {
  const args = process.argv.slice(2);
  const loreDb = initLoreDatabase(LORE_DB_PATH);
  const comicsNowDb = new Database(COMICS_NOW_DB_PATH);

  // Command: List all indexed storylines
  if (args.includes('--list') || args.includes('-l')) {
    const orders = loreDb.prepare('SELECT * FROM reading_orders ORDER BY publisher, name').all();
    console.log(`\n📚 Indexed Reading Orders in ${LORE_DB_PATH}: (${orders.length} storylines)\n`);

    if (orders.length === 0) {
      console.log('  No reading orders indexed yet. Run `node scripts/build-lore-index.js --build-presets` to index core library storylines.\n');
      process.exit(0);
    }

    orders.forEach(o => {
      const pct = o.total_canonical_issues > 0 ? Math.round((o.owned_issues_count / o.total_canonical_issues) * 100) : 0;
      const synced = comicsNowDb.prepare('SELECT id FROM reading_lists WHERE name = ? AND userId = ?').get(o.name, 'default-user');
      const syncBadge = synced ? '✅ Live in Comics Now' : '⭕ Unsynced';

      console.log(`  • [${o.publisher}] ${o.name}`);
      console.log(`    Coverage : ${o.owned_issues_count} / ${o.total_canonical_issues} canonical issues (${pct}%)`);
      console.log(`    Status   : ${syncBadge} | ID: ${o.id}`);
      console.log('');
    });
    process.exit(0);
  }

  // Command: Show missing issues for an order
  const missingIdx = args.indexOf('--missing');
  if (missingIdx !== -1 && args[missingIdx + 1]) {
    const orderId = args[missingIdx + 1];
    const order = loreDb.prepare('SELECT name FROM reading_orders WHERE id = ?').get(orderId);
    if (!order) {
      console.error(`[Error] Order ID '${orderId}' not found.`);
      process.exit(1);
    }
    const missing = getMissingIssuesForOrder(loreDb, orderId);
    console.log(`\n🔍 Missing Issues Wishlist for '${order.name}': (${missing.length} unowned issues)\n`);
    missing.forEach(m => {
      console.log(`  [Seq #${m.sequence_num}] ${m.series} #${m.number} ${m.title ? '- ' + m.title : ''} (${m.publisher})`);
    });
    console.log('');
    process.exit(0);
  }

  // Command: Sync specific order into comics-now.db
  const syncIdx = args.indexOf('--sync');
  if (syncIdx !== -1 && args[syncIdx + 1]) {
    const orderId = args[syncIdx + 1];
    console.log(`[Sync] Importing reading order ${orderId} into comics-now.db...`);
    const res = await syncLoreOrderToComicsNow(loreDb, comicsNowDb, orderId);
    if (res.success) {
      console.log(`✅ Successfully synced '${res.listName}'! Matched: ${res.matchedComics} comics across ${res.usersSynced} users.`);
    } else {
      console.error(`❌ Sync failed: ${res.reason}`);
    }
    process.exit(res.success ? 0 : 1);
  }

  // Command: Sync all eligible orders into comics-now.db
  if (args.includes('--sync-all')) {
    const orders = loreDb.prepare('SELECT id, name FROM reading_orders WHERE owned_issues_count >= 3').all();
    console.log(`[Sync All] Checking ${orders.length} candidate storylines for sync...`);
    for (const o of orders) {
      const res = await syncLoreOrderToComicsNow(loreDb, comicsNowDb, o.id);
      if (res.success) {
        console.log(`  ✅ Synced '${o.name}' (${res.matchedComics} issues).`);
      } else {
        console.log(`  ⚠️ Skipped '${o.name}': ${res.reason}`);
      }
    }
    console.log('Done!');
    process.exit(0);
  }

  // Command: Build core library presets
  if (args.includes('--build-presets')) {
    console.log(`\n🚀 Indexing Core Storyline Presets into ${LORE_DB_PATH}...`);
    const libraryComics = getAllLibraryComics(comicsNowDb);
    console.log(`Loaded ${libraryComics.length} local library comics for gap analysis.`);

    for (const preset of CORE_CANONICAL_PRESETS) {
      const orderId = indexReadingOrder(loreDb, preset, libraryComics);
      const row = loreDb.prepare('SELECT total_canonical_issues, owned_issues_count FROM reading_orders WHERE id = ?').get(orderId);
      console.log(`  • Indexed: [${preset.publisher}] ${preset.name}`);
      console.log(`    Owned in Library: ${row.owned_issues_count} / ${row.total_canonical_issues} issues.`);
    }

    console.log(`\n✅ Presets successfully indexed into ${LORE_DB_PATH}!\nRun \`node scripts/build-lore-index.js --list\` to inspect.`);
    process.exit(0);
  }

  // Command: Crawl all series across library publishers (default maxSeries: 10, or --all-series)
  if (args.includes('--crawl-libraries') || args.includes('--all-series')) {
    const maxSeriesIdx = args.indexOf('--max-series');
    const maxSeries = maxSeriesIdx !== -1 ? parseInt(args[maxSeriesIdx + 1], 10) : (args.includes('--all-series') ? 99999 : 10);
    console.log(`\n🚀 Crawling and Indexing Series across Library Publishers (Max Series: ${maxSeries === 99999 ? 'ALL' : maxSeries}, Excluding Marvel)...`);
    const result = crawlPublishersWithMaxSeries(loreDb, comicsNowDb, { maxSeries });
    console.log(`\n✅ Finished Crawl!`);
    console.log(`   Publishers Processed   : ${result.publishersProcessed}`);
    console.log(`   Reading Orders Indexed : ${result.ordersIndexed}`);
    console.log(`   Total Canonical Issues : ${result.totalCanonicalIssues}`);
    console.log(`   Owned Issues in Library: ${result.ownedIssues}`);
    console.log(`   Missing Issues (Gaps)  : ${result.missingIssues}`);
    process.exit(0);
  }

  // External sources catalog for polite crawling across the 5 reading order authorities
  const EXTERNAL_LORE_TARGETS = [
    {
      name: 'The Incal / The Jodoverse',
      publisher: 'Humanoids',
      source: 'Wikipedia',
      url: 'https://en.wikipedia.org/wiki/The_Incal'
    },
    {
      name: 'Thorgal Complete Saga',
      publisher: 'Europe Comics / Cinebook',
      source: 'Wikipedia',
      url: 'https://en.wikipedia.org/wiki/Thorgal'
    },
    {
      name: 'The Adventures of Tintin',
      publisher: 'Casterman',
      source: 'Wikipedia',
      url: 'https://en.wikipedia.org/wiki/The_Adventures_of_Tintin'
    },
    {
      name: 'Asterix Complete Canon',
      publisher: 'Hachette',
      source: 'Wikipedia',
      url: 'https://en.wikipedia.org/wiki/Asterix'
    },
    {
      name: 'The Adventures of Blake & Mortimer',
      publisher: 'Cinebook',
      source: 'Wikipedia',
      url: 'https://en.wikipedia.org/wiki/Blake_and_Mortimer'
    },
    {
      name: 'XIII & XIII Mystery',
      publisher: 'Cinebook / Europe Comics',
      source: 'Wikipedia',
      url: 'https://en.wikipedia.org/wiki/XIII_(comics)'
    },
    {
      name: 'Grendel Universe (Matt Wagner)',
      publisher: 'Dark Horse Comics',
      source: 'Wikipedia',
      url: 'https://en.wikipedia.org/wiki/Grendel_(comics)'
    },
    {
      name: 'The Sandman Universe (Neil Gaiman)',
      publisher: 'DC Comics',
      source: 'Wikipedia',
      url: 'https://en.wikipedia.org/wiki/The_Sandman_(comic_book)'
    },
    {
      name: 'Invincible Universe Reading Order',
      publisher: 'Image / Skybound',
      source: 'Comic Book Herald',
      url: 'https://www.comicbookherald.com/the-complete-invincible-reading-order/'
    },
    {
      name: 'The Walking Dead Reading Order',
      publisher: 'Image / Skybound',
      source: 'Comic Book Herald',
      url: 'https://www.comicbookherald.com/the-walking-dead-reading-order/'
    },
    {
      name: 'The Boys Universe Reading Order',
      publisher: 'Dynamite Entertainment',
      source: 'Comic Book Herald',
      url: 'https://www.comicbookherald.com/the-boys-reading-order/'
    },
    {
      name: 'Hellboy / Mignolaverse Complete Chronology',
      publisher: 'Dark Horse Comics',
      source: 'Comic Book Herald',
      url: 'https://www.comicbookherald.com/the-complete-hellboy-reading-order/'
    },
    {
      name: 'Green Lantern: Geoff Johns Era',
      publisher: 'DC Comics',
      source: 'Comic Book Herald',
      url: 'https://www.comicbookherald.com/reading-dc-comics/green-lantern-reading-order/'
    }
  ];

  // Command: Polite multi-source external crawl across reading order authorities
  if (args.includes('--crawl-sources') || args.includes('--crawl-external')) {
    console.log(`\n🌐 Initiating Polite Multi-Source Crawl across 5 Authorities (${EXTERNAL_LORE_TARGETS.length} targets)...`);
    const { apiKey, model } = getGeminiConfig();
    if (!apiKey) {
      console.error(`[Error] Gemini API key not found in comics-now.db settings.`);
      process.exit(1);
    }

    const libraryComics = getAllLibraryComics(comicsNowDb);
    console.log(`Loaded ${libraryComics.length} local library comics for ownership mapping.\n`);

    let indexedCount = 0;
    for (let i = 0; i < EXTERNAL_LORE_TARGETS.length; i++) {
      const target = EXTERNAL_LORE_TARGETS[i];
      console.log(`[${i + 1}/${EXTERNAL_LORE_TARGETS.length}] Fetching '${target.name}' via ${target.source} (${target.url})...`);

      try {
        const markdown = await fetchUrlAsMarkdown(target.url);
        console.log(`  • Fetched ${markdown.length} chars. Extracting canonical lore via Gemini (${model})...`);

        const lore = await parseLoreWithGemini({ markdown, publisher: target.publisher, apiKey, model });
        const readingList = lore.reading_list || lore;
        if (!readingList.name) {
          readingList.name = lore.story_arc?.name || target.name;
        }
        if (!readingList.issues && (lore.issues || lore.reading_order)) {
          readingList.issues = lore.issues || lore.reading_order;
        }
        readingList.source_url = target.url;

        const orderId = indexReadingOrder(loreDb, readingList, libraryComics);
        const row = loreDb.prepare('SELECT total_canonical_issues, owned_issues_count FROM reading_orders WHERE id = ?').get(orderId);
        const pct = row.total_canonical_issues > 0 ? Math.round((row.owned_issues_count / row.total_canonical_issues) * 100) : 0;

        console.log(`  ✅ Indexed '${readingList.name}'! Coverage: ${row.owned_issues_count} / ${row.total_canonical_issues} issues (${pct}%).`);
        indexedCount++;
      } catch (err) {
        console.warn(`  ⚠️ Failed to process '${target.name}': ${err.message}`);
      }

      // Polite delay between requests ("scrape very kindly")
      if (i < EXTERNAL_LORE_TARGETS.length - 1) {
        console.log(`  ⏳ Polite throttle (2.5s pause)...`);
        await new Promise(r => setTimeout(r, 2500));
      }
    }

    console.log(`\n🎉 Polite multi-source crawl finished! Successfully indexed ${indexedCount} / ${EXTERNAL_LORE_TARGETS.length} major storylines into ${LORE_DB_PATH}.`);
    process.exit(0);
  }

  // Command: Dynamically crawl external canonical reading orders for series in library
  if (args.includes('--crawl-all-series') || args.includes('--auto-crawl-series')) {
    const limitIdx = args.indexOf('--limit');
    const limit = limitIdx !== -1 ? parseInt(args[limitIdx + 1], 10) : 30;

    console.log(`\n🔍 Dynamically Querying External Reading Orders for Library Series (Top ${limit} by issue count)...`);
    const seriesRows = comicsNowDb.prepare(`
      SELECT series, publisher, COUNT(*) as issue_count
      FROM comics
      WHERE publisher NOT LIKE '%Marvel%'
        AND series IS NOT NULL
        AND series != ''
      GROUP BY series, publisher
      ORDER BY issue_count DESC
      LIMIT ?
    `).all(limit);

    console.log(`Found ${seriesRows.length} library series to query across external authorities.\n`);

    const { apiKey, model } = getGeminiConfig();
    if (!apiKey) {
      console.error(`[Error] Gemini API key not found in comics-now.db settings.`);
      process.exit(1);
    }
    const libraryComics = getAllLibraryComics(comicsNowDb);

    let indexedCount = 0;
    for (let i = 0; i < seriesRows.length; i++) {
      const s = seriesRows[i];
      console.log(`[${i + 1}/${seriesRows.length}] Resolving '${s.series}' (${s.publisher}, ${s.issue_count} local comics)...`);

      try {
        // Query Wikipedia OpenSearch API dynamically (try exact series name first, then with (comics))
        let articleUrl = null;
        for (const query of [s.series, `${s.series} (comics)`, `${s.series} comic`]) {
          const searchUrl = `https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(query)}&limit=3&format=json`;
          const searchRes = await fetch(searchUrl, { headers: { 'User-Agent': 'ComicsNow-LoreExtractor/2.0' } });
          const searchData = await searchRes.json();
          if (searchData[3]?.[0]) {
            articleUrl = searchData[3][0];
            break;
          }
        }

        if (!articleUrl) {
          console.log(`  ⭕ No external Wikipedia reading order found for '${s.series}'.`);
          continue;
        }

        console.log(`  • Found authority article: ${articleUrl}`);
        const markdown = await fetchUrlAsMarkdown(articleUrl);
        const lore = await parseLoreWithGemini({ markdown, publisher: s.publisher, apiKey, model });

        const readingList = lore.reading_list || lore;
        if (!readingList.name) {
          readingList.name = `${s.series}: Canonical Chronology`;
        }
        if (!readingList.issues && (lore.issues || lore.reading_order)) {
          readingList.issues = lore.issues || lore.reading_order;
        }
        readingList.source_url = articleUrl;

        if (Array.isArray(readingList.issues) && readingList.issues.length > 0) {
          const orderId = indexReadingOrder(loreDb, readingList, libraryComics);
          const row = loreDb.prepare('SELECT total_canonical_issues, owned_issues_count FROM reading_orders WHERE id = ?').get(orderId);
          const pct = row.total_canonical_issues > 0 ? Math.round((row.owned_issues_count / row.total_canonical_issues) * 100) : 0;
          console.log(`  ✅ Indexed '${readingList.name}'! Coverage: ${row.owned_issues_count} / ${row.total_canonical_issues} canonical issues (${pct}%).`);
          indexedCount++;
        } else {
          console.log(`  ⚠️ No discrete issue list found in article for '${s.series}'.`);
        }
      } catch (err) {
        console.warn(`  ⚠️ Error querying '${s.series}': ${err.message}`);
      }

      // Polite 2.5s throttle between requests ("scrape very kindly")
      if (i < seriesRows.length - 1) {
        console.log(`  ⏳ Polite throttle (2.5s pause)...`);
        await new Promise(r => setTimeout(r, 2500));
      }
    }

    console.log(`\n🎉 Dynamic library crawl complete! Indexed ${indexedCount} reading orders into ${LORE_DB_PATH}.`);
    process.exit(0);
  }

  // Helper to get Gemini configuration from database
  function getGeminiConfig() {
    let apiKey = process.env.GEMINI_API_KEY || '';
    let model = 'gemini-3.5-flash-lite';
    try {
      const row = comicsNowDb.prepare("SELECT value FROM settings WHERE key = 'geminiApiKey'").get();
      if (row?.value) {
        try { apiKey = JSON.parse(row.value); } catch { apiKey = row.value; }
      }
      const modelRow = comicsNowDb.prepare("SELECT value FROM settings WHERE key = 'geminiModel'").get();
      if (modelRow?.value) {
        try { model = JSON.parse(modelRow.value); } catch { model = modelRow.value; }
      }
    } catch (_) {}
    return { apiKey, model };
  }

  // Command: Scrape any external URL via Jina Reader + Gemini
  const scrapeIdx = args.indexOf('--scrape');
  if (scrapeIdx !== -1 && args[scrapeIdx + 1]) {
    const targetUrl = args[scrapeIdx + 1];
    const pubIdx = args.indexOf('--publisher');
    const publisher = pubIdx !== -1 && args[pubIdx + 1] ? args[pubIdx + 1] : 'DC Comics';

    console.log(`\n🌐 Scraping Reading Order via Jina Reader: ${targetUrl}`);
    const markdown = await fetchUrlAsMarkdown(targetUrl);
    console.log(`Fetched ${markdown.length} characters of clean markdown.`);

    console.log(`Extracting canonical order and multiverse lore via Gemini...`);
    const { apiKey, model } = getGeminiConfig();
    if (!apiKey) {
      console.error(`[Error] Gemini API key not found in comics-now.db settings.`);
      process.exit(1);
    }

    const lore = await parseLoreWithGemini({ markdown, publisher, apiKey, model });
    const readingList = lore.reading_list || lore;
    if (!readingList.name) {
      readingList.name = lore.story_arc?.name || lore.name || `${publisher} Reading Order`;
    }
    if (!readingList.issues && (lore.issues || lore.reading_order)) {
      readingList.issues = lore.issues || lore.reading_order;
    }
    readingList.source_url = targetUrl;

    const libraryComics = getAllLibraryComics(comicsNowDb);
    const orderId = indexReadingOrder(loreDb, readingList, libraryComics);
    const row = loreDb.prepare('SELECT total_canonical_issues, owned_issues_count FROM reading_orders WHERE id = ?').get(orderId);

    console.log(`\n✅ Indexed '${readingList.name}' into ${LORE_DB_PATH}!`);
    console.log(`   Canonical Issues : ${row.total_canonical_issues}`);
    console.log(`   Owned in Library : ${row.owned_issues_count}`);
    console.log(`   Lore ID          : ${orderId}`);
    console.log(`   Run \`node scripts/build-lore-index.js --missing ${orderId}\` to see missing issues.`);
    process.exit(0);
  }

  console.log(`
Comics Now - Lore Index Builder & Gap Analyzer

Usage:
  node scripts/build-lore-index.js --build-presets   # Index core library storylines (LOEG, Ice Cream Man, Tick, etc.)
  node scripts/build-lore-index.js --list            # List all storylines and library coverage
  node scripts/build-lore-index.js --missing <id>    # Show missing issues wishlist for an order
  node scripts/build-lore-index.js --scrape <URL>    # Scrape any web URL via r.jina.ai & Gemini
  node scripts/build-lore-index.js --sync <id>       # Sync an order into comics-now.db
  node scripts/build-lore-index.js --sync-all        # Sync all eligible orders (>=3 comics, multi-series)
`);
}

if (require.main === module) {
  main().catch(err => {
    console.error('[Fatal Error]', err);
    process.exit(1);
  });
}
