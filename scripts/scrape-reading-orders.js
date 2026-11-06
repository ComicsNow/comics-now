#!/usr/bin/env node
/**
 * Comics Now! - ReadingOrders.com Scraper & Sync CLI
 *
 * Scrapes reading orders, single issue sequences, and collected editions
 * from readingorders.com and indexes them into data/reading-orders.db.
 */
const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const { initReadingOrdersDb, DEFAULT_DB_PATH } = require('../server/readingOrdersDb');
const { parseReadingOrderPage, parseCollectedEditionsPage } = require('../server/services/readingOrdersParser');

const SITEMAP_URL = 'https://readingorders.com/sitemap-0.xml';
const BASE_URL = 'https://readingorders.com';
const USER_AGENT = 'ComicsNow-ContinuityEngine/1.0 (+https://github.com/comicsnow)';

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function inferPublisher(title, slug) {
  const lower = `${title} ${slug}`.toLowerCase();
  if (/batman|superman|justice league|flashpoint|crisis|green lantern|blackest night|brightest day|zero hour|knightfall|no man's land|infinite crisis|final crisis|52\b|dc\b|aquaman|wonder woman|swamp thing|sandman|hellblazer/i.test(lower)) {
    return 'DC Comics';
  }
  if (/civil war|spider-man|avengers|x-men|marvel|hulk|thor|iron man|daredevil|secret wars|infinity|fantastic four|wolverine|deadpool|captain america/i.test(lower)) {
    return 'Marvel Comics';
  }
  if (/star wars/i.test(lower)) return 'Marvel Comics';
  if (/spawn|invincible|walking dead|saga|image\b/i.test(lower)) return 'Image Comics';
  return 'Other';
}

async function fetchWithRetry(url, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT }
      });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      return await res.text();
    } catch (err) {
      if (attempt === retries) throw err;
      await sleep(1000 * attempt);
    }
  }
  return null;
}

async function fetchSitemapEntries() {
  const xml = await fetchWithRetry(SITEMAP_URL);
  if (!xml) return [];
  const $ = cheerio.load(xml, { xmlMode: true });
  const entries = [];

  $('url').each((_, el) => {
    const loc = $(el).find('loc').text().trim();
    const lastmod = $(el).find('lastmod').text().trim();
    if (loc.includes('/reading-orders/') && !loc.endsWith('/collected-editions')) {
      const slug = loc.replace(/.*\/reading-orders\//, '').replace(/\/$/, '');
      if (slug) {
        entries.push({ slug, url: loc, lastmod });
      }
    }
  });

  return entries;
}

async function runScraper(options = {}) {
  const mode = options.mode || 'both'; // 'issues' | 'collected' | 'both'
  const limit = options.limit ? parseInt(options.limit, 10) : Infinity;
  const singleSlug = options.slug || null;
  const dbPath = options.dbPath || DEFAULT_DB_PATH;

  // Ensure target data dir exists
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const dbService = initReadingOrdersDb(dbPath);

  console.log(`[Scraper] Initialized reading-orders.db at: ${dbPath}`);
  console.log(`[Scraper] Mode: ${mode}, Limit: ${limit === Infinity ? 'All' : limit}`);

  let targets = [];
  if (singleSlug) {
    targets = [{ slug: singleSlug, url: `${BASE_URL}/reading-orders/${singleSlug}`, lastmod: null }];
  } else {
    console.log('[Scraper] Fetching sitemap index...');
    targets = await fetchSitemapEntries();
    console.log(`[Scraper] Found ${targets.length} reading orders in sitemap.`);
  }

  const toProcess = targets.slice(0, limit);
  let processed = 0;
  let errors = 0;

  for (const target of toProcess) {
    try {
      console.log(`[${processed + 1}/${toProcess.length}] Ingesting: ${target.slug}...`);

      // 1. Ingest Issue-level reading order
      if (mode === 'issues' || mode === 'both') {
        const pageHtml = await fetchWithRetry(target.url);
        if (pageHtml) {
          const parsedOrder = parseReadingOrderPage(pageHtml, target.slug);
          const publisher = inferPublisher(parsedOrder.title, target.slug);

          dbService.upsertReadingOrder({
            id: target.slug,
            title: parsedOrder.title,
            publisher,
            url: target.url,
            description: parsedOrder.description,
            coverImage: parsedOrder.issues[0]?.coverImageUrl || null,
            lastScrapedMod: target.lastmod
          });

          if (parsedOrder.issues.length > 0) {
            dbService.upsertIssues(target.slug, parsedOrder.issues);
          }
        }
      }

      // 2. Ingest Collected editions
      if (mode === 'collected' || mode === 'both') {
        const collUrl = `${BASE_URL}/reading-orders/${target.slug}/collected-editions`;
        const collHtml = await fetchWithRetry(collUrl);
        if (collHtml) {
          const parsedColls = parseCollectedEditionsPage(collHtml, target.slug);
          if (parsedColls.collections.length > 0) {
            dbService.upsertCollections(target.slug, parsedColls.collections);
          }
        }
      }

      processed++;
      await sleep(150); // Courteous crawl delay
    } catch (err) {
      console.error(`[Scraper] Error scraping ${target.slug}:`, err.message);
      errors++;
    }
  }

  console.log(`[Scraper] Ingestion complete. Processed: ${processed}, Errors: ${errors}`);
  return { processed, errors };
}

// CLI entrypoint
if (require.main === module) {
  const args = process.argv.slice(2);
  const options = { mode: 'both' };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--mode' && args[i + 1]) options.mode = args[++i];
    if (args[i] === '--limit' && args[i + 1]) options.limit = args[++i];
    if (args[i] === '--slug' && args[i + 1]) options.slug = args[++i];
  }

  runScraper(options).catch(err => {
    console.error('[Scraper] Fatal error:', err);
    process.exit(1);
  });
}

module.exports = {
  runScraper,
  fetchSitemapEntries,
  inferPublisher
};
