#!/usr/bin/env node
/**
 * Comics Now - Publisher Lore & Reading Order CLI Extractor
 *
 * Uses Jina Reader (r.jina.ai) to scrape reading order guides and lore for free,
 * runs through Gemini to extract validated chronological sequences, and syncs
 * to comics-now.db adhering to multi-series (Rule 3), threshold (Rule 4),
 * duplicate prevention (Rule 5), and multi-user parity (Rule 6).
 */

const path = require('path');
const Database = require('better-sqlite3');
const {
  fetchUrlAsMarkdown,
  parseLoreWithGemini,
  syncExtractedLoreToDatabase
} = require('../server/services/publisher-lore-extractor');

const PRESETS = {
  'dc-all-in': {
    publisher: 'DC Comics',
    name: 'DC All In & Absolute Universe',
    url: 'https://comicbookreadingorders.com/dc/events/dc-all-in-reading-order/'
  },
  'crisis': {
    publisher: 'DC Comics',
    name: 'Crisis on Infinite Earths',
    url: 'https://comicbookreadingorders.com/dc/events/crisis-on-infinite-earths-reading-order/'
  },
  'flashpoint': {
    publisher: 'DC Comics',
    name: 'Flashpoint Continuity Reboot',
    url: 'https://comicbookreadingorders.com/dc/events/flashpoint-reading-order/'
  },
  'secret-wars': {
    publisher: 'Marvel',
    name: 'Secret Wars (2015) Multiverse Incursion',
    url: 'https://comicbookreadingorders.com/marvel/events/secret-wars-2015-reading-order/'
  },
  'infinity-gauntlet': {
    publisher: 'Marvel',
    name: 'The Infinity Gauntlet Saga',
    url: 'https://comicbookreadingorders.com/marvel/events/infinity-gauntlet-reading-order/'
  },
  'energon-universe': {
    publisher: 'Image',
    name: 'Energon Universe (Transformers & G.I. Joe)',
    url: 'https://comicbookreadingorders.com/other/energon-universe-reading-order/'
  },
  'mignolaverse': {
    publisher: 'Dark Horse Comics',
    name: 'Hellboy Universe / Mignolaverse Chronology',
    url: 'https://comicbookreadingorders.com/other/hellboy-reading-order/'
  }
};

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--list-presets') || args.includes('-l')) {
    console.log('\nAvailable Publisher Reading Order & Lore Presets:');
    Object.entries(PRESETS).forEach(([key, val]) => {
      console.log(`  • ${key.padEnd(20)} [${val.publisher}] ${val.name}\n    Source: ${val.url}`);
    });
    console.log('');
    process.exit(0);
  }

  let presetKey = null;
  let targetUrl = null;
  let publisher = 'DC Comics';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--preset' && args[i + 1]) presetKey = args[++i];
    else if (args[i] === '--url' && args[i + 1]) targetUrl = args[++i];
    else if (args[i] === '--publisher' && args[i + 1]) publisher = args[++i];
  }

  if (presetKey && PRESETS[presetKey]) {
    const p = PRESETS[presetKey];
    targetUrl = p.url;
    publisher = p.publisher;
    console.log(`[Preset Selected] ${p.name} (${publisher})`);
  }

  if (!targetUrl) {
    console.log(`
Comics Now - Publisher Lore & Reading Order Extractor

Usage:
  node scripts/extract-publisher-lore.js --preset <preset-name>
  node scripts/extract-publisher-lore.js --url <web_url> --publisher <publisher_name>
  node scripts/extract-publisher-lore.js --list-presets

Examples:
  node scripts/extract-publisher-lore.js --preset dc-all-in
  node scripts/extract-publisher-lore.js --preset secret-wars
  node scripts/extract-publisher-lore.js --preset energon-universe
    `);
    process.exit(0);
  }

  const dbPath = process.env.COMICS_DB_PATH || path.join(__dirname, '../comics-now.db');
  console.log(`[Database] Connecting to ${dbPath}...`);
  const rawDb = new Database(dbPath);

  // Wrap better-sqlite3 with async helpers matching app convention
  const db = {
    dbAll: async (sql, params = []) => rawDb.prepare(sql).all(...params),
    dbGet: async (sql, params = []) => rawDb.prepare(sql).get(...params),
    dbRun: async (sql, params = []) => rawDb.prepare(sql).run(...params)
  };

  // Get Gemini API Key
  const { getConfig } = require('../server/config');
  const config = getConfig();
  let apiKey = process.env.GEMINI_API_KEY || config.geminiApiKey;
  let model = process.env.GEMINI_MODEL || config.geminiModel || 'gemini-3.5-flash-lite';

  try {
    const keyRow = await db.dbGet("SELECT value FROM settings WHERE key = 'geminiApiKey'");
    if (keyRow?.value) {
      try { apiKey = JSON.parse(keyRow.value); } catch { apiKey = keyRow.value; }
    }
  } catch (_) {}

  if (!apiKey) {
    console.error('[ERROR] Gemini API key is not configured in Settings or GEMINI_API_KEY environment.');
    process.exit(1);
  }

  console.log(`\n1. Fetching clean Markdown via Jina Reader:`);
  console.log(`   URL: ${targetUrl}`);
  const markdown = await fetchUrlAsMarkdown(targetUrl);
  console.log(`   Fetched ${markdown.length} characters of clean markdown text.`);

  console.log(`\n2. Parsing Reading Order, Story Arcs & Multiverse Lore with Gemini (${model})...`);
  const extracted = await parseLoreWithGemini({
    markdown,
    publisher,
    apiKey,
    model
  });

  console.log(`\n3. Extraction Results:`);
  console.log(`   Reading List Name : ${extracted?.reading_list?.name || 'N/A'}`);
  console.log(`   Total Issues      : ${extracted?.reading_list?.issues?.length || 0}`);
  console.log(`   Story Arc         : ${extracted?.story_arc?.name || 'N/A'} (${extracted?.story_arc?.start_year || ''} - ${extracted?.story_arc?.end_year || ''})`);
  if (extracted?.multiverse_lore?.length > 0) {
    console.log(`   Multiverse Lore   :`);
    extracted.multiverse_lore.forEach(m => console.log(`     • [${m.designation}] ${m.reality_name}: ${m.continuity_notes || ''}`));
  }

  console.log(`\n4. Synchronizing to Comics Now Database (Multi-User Parity)...`);
  const syncRes = await syncExtractedLoreToDatabase(db, extracted);

  if (syncRes.success) {
    console.log(`   ✅ Successfully synced reading list '${syncRes.listName}'!`);
    console.log(`   Matched Comics : ${syncRes.matchedComicsCount}`);
    console.log(`   Users Synced   : ${syncRes.usersSynced} (default-user + registered users)`);
  } else {
    console.log(`   ⚠️  Sync skipped: ${syncRes.reason}`);
  }

  console.log('\nDone!\n');
}

main().catch(err => {
  console.error('[Fatal Error]', err.message);
  process.exit(1);
});
