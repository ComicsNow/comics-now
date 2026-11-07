/**
 * ReadingOrders In-Process Sync Runner
 *
 * Coordinates delta scraping with 3-tier rescrape prevention:
 *   Tier 1: Sitemap ETag 304 fast exit.
 *   Tier 2: Slug delta filtering against local reading-orders.db.
 *   Tier 3: SHA-256 issue content fingerprinting.
 */

const https = require('https');
const http = require('http');
const { DomainRateLimiter } = require('./reading-orders-limiter');
const { parseReadingOrderPage, parseCollectedEditionsPage } = require('./readingOrdersParser');
const { getReadingOrdersDb } = require('../readingOrdersDb');
const { storyArcsLog } = require('../logger');
const config = require('../config');

const SITEMAP_URL = 'https://www.readingorders.com/sitemap-0.xml';

class ReadingOrdersRunner {
  constructor(options = {}) {
    this.minDelayMs = options.minDelayMs || 1200;
    this.minJitterMs = options.minJitterMs !== undefined ? options.minJitterMs : 150;
    this.maxJitterMs = options.maxJitterMs !== undefined ? options.maxJitterMs : 350;
    this.limiter = new DomainRateLimiter(this.minDelayMs, this.minJitterMs, this.maxJitterMs);

    this.isSyncing = false;
    this.status = 'idle'; // 'idle' | 'syncing' | 'cooldown' | 'complete' | 'error'
    this.progress = { current: 0, total: 0, currentSlug: '' };
    this.lastSyncTime = null;
    this.lastError = null;
    this.lastSitemapEtag = null;
    this._syncTimer = null;
    this.isCancelled = false;
  }

  getOrderCount() {
    try {
      if (this.readingOrdersDb && this.readingOrdersDb.db) {
        const row = this.readingOrdersDb.db.prepare('SELECT COUNT(*) as count FROM reading_orders').get();
        return row ? row.count : 0;
      }
    } catch (_) {}
    return 0;
  }

  getStatus() {
    return {
      status: this.status,
      isSyncing: this.isSyncing,
      progress: { ...this.progress },
      lastSyncTime: this.lastSyncTime,
      lastError: this.lastError,
      lastSitemapEtag: this.lastSitemapEtag,
      orderCount: this.getOrderCount(),
    };
  }

  schedulePeriodicSync(intervalDays, mode = 'both') {
    if (this._syncTimer) {
      clearInterval(this._syncTimer);
      this._syncTimer = null;
    }
    const days = Number(intervalDays);
    if (!Number.isFinite(days) || days <= 0) {
      return;
    }
    const checkIntervalMs = 12 * 60 * 60 * 1000;
    this._syncTimer = setInterval(async () => {
      const now = Date.now();
      const intervalMs = days * 24 * 60 * 60 * 1000;
      if (!this.lastSyncTime || (now - this.lastSyncTime) >= intervalMs) {
        try {
          await this.startSync({ mode, force: false });
        } catch (_) {}
      }
    }, checkIntervalMs);
    if (this._syncTimer && this._syncTimer.unref) {
      this._syncTimer.unref();
    }
  }

  async _fetchSitemapHeaders() {
    return new Promise((resolve) => {
      const url = new URL(SITEMAP_URL);
      const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      };
      if (this.lastSitemapEtag) {
        headers['If-None-Match'] = this.lastSitemapEtag;
      }

      const req = https.request(url, { method: 'HEAD', headers }, (res) => {
        resolve({
          status: res.statusCode,
          etag: res.headers.etag || null,
          lastModified: res.headers['last-modified'] || null,
        });
      });
      req.on('error', () => resolve({ status: 500, etag: null }));
      req.end();
    });
  }

  async _fetchHtml(urlStr) {
    await this.limiter.waitForNextSlot((waitMs) => {
      if (this.status === 'syncing') {
        this.status = 'cooldown';
        setTimeout(() => {
          if (this.status === 'cooldown') this.status = 'syncing';
        }, waitMs);
      }
    });

    return new Promise((resolve, reject) => {
      const client = urlStr.startsWith('https') ? https : http;
      client.get(urlStr, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
      }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return resolve(this._fetchHtml(res.headers.location));
        }
        if (res.statusCode === 304) {
          this.limiter.recordSuccess();
          return resolve({ notModified: true });
        }
        if (res.statusCode === 429 || res.statusCode >= 500) {
          this.limiter.recordError();
          return reject(new Error(`HTTP ${res.statusCode} from target host`));
        }
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          this.limiter.recordSuccess();
          resolve({ html: data, statusCode: res.statusCode });
        });
      }).on('error', (err) => {
        this.limiter.recordError();
        reject(err);
      });
    });
  }

  cancelSync() {
    if (this.isSyncing) {
      this.isCancelled = true;
      this.status = 'idle';
      this.isSyncing = false;
      storyArcsLog('WARN', 'ReadingOrders sync cancelled by user.');
      return true;
    }
    return false;
  }

  _parseSitemapSlugs(xml) {
    if (!xml) return [];
    const matches = xml.match(/<loc>(https?:\/\/[^<]+)<\/loc>/g) || [];
    const slugs = new Set();
    for (const m of matches) {
      const url = m.replace(/<\/?loc>/g, '').trim();
      const match = url.match(/\/reading-orders\/([a-zA-Z0-9_\-]+)$/);
      if (match && match[1] && match[1] !== 'collected-editions') {
        slugs.add(match[1]);
      }
    }
    return Array.from(slugs);
  }

  async startSync(options = {}) {
    if (this.isSyncing) {
      throw new Error('A reading orders sync is already in progress.');
    }

    const { mode = 'both', force = false } = options;
    this.isSyncing = true;
    this.status = 'syncing';
    this.isCancelled = false;
    this.lastError = null;
    storyArcsLog('INFO', `Starting ReadingOrders sync (mode: ${mode}, force: ${force})...`);

    try {
      if (!force) {
        const sitemapMeta = await this._fetchSitemapHeaders();
        if (sitemapMeta.status === 304 || (this.lastSitemapEtag && sitemapMeta.etag === this.lastSitemapEtag)) {
          this.status = 'idle';
          this.isSyncing = false;
          this.lastSyncTime = Date.now();
          storyArcsLog('INFO', 'Sitemap ETag unchanged (304 Not Modified). All reading orders up to date.');
          return { skipped: true, reason: 'Sitemap not modified (304)', scrapedCount: 0 };
        }
        if (sitemapMeta.etag) {
          this.lastSitemapEtag = sitemapMeta.etag;
        }
      }

      storyArcsLog('INFO', `Fetching sitemap index from ${SITEMAP_URL}...`);
      const sitemapRes = await this._fetchHtml(SITEMAP_URL);
      const slugs = this._parseSitemapSlugs(sitemapRes.html);
      storyArcsLog('INFO', `Sitemap parsed: discovered ${slugs.length} reading orders.`);

      let slugsToScrape = slugs;
      if (!force && this.readingOrdersDb && this.readingOrdersDb.db) {
        try {
          const rows = this.readingOrdersDb.db.prepare('SELECT id FROM reading_orders').all();
          const existing = new Set(rows.map(r => r.id));
          slugsToScrape = slugs.filter(s => !existing.has(s));
        } catch (_) {}
      }

      if (slugsToScrape.length === 0) {
        this.status = 'idle';
        this.isSyncing = false;
        this.lastSyncTime = Date.now();
        storyArcsLog('INFO', `All ${slugs.length} reading orders already indexed in local database.`);
        return { skipped: true, reason: 'All orders already indexed', scrapedCount: 0 };
      }

      storyArcsLog('INFO', `Queueing ${slugsToScrape.length} reading order(s) for extraction...`);
      let scrapedCount = 0;

      for (let idx = 0; idx < slugsToScrape.length; idx++) {
        if (this.isCancelled) {
          storyArcsLog('WARN', `Sync stopped early after ${scrapedCount} orders.`);
          break;
        }

        const slug = slugsToScrape[idx];
        this.progress = { current: idx + 1, total: slugsToScrape.length, currentSlug: slug };
        storyArcsLog('INFO', `[${idx + 1}/${slugsToScrape.length}] Scraping ${slug}...`);

        try {
          const orderUrl = `https://www.readingorders.com/reading-orders/${slug}`;
          const pageRes = await this._fetchHtml(orderUrl);
          if (pageRes && pageRes.html) {
            const parsed = parseReadingOrderPage(pageRes.html, slug);
            if (this.readingOrdersDb) {
              this.readingOrdersDb.upsertReadingOrder({
                ...parsed,
                id: slug,
                url: orderUrl,
                publisher: parsed.publisher || 'Other'
              });
              this.readingOrdersDb.upsertIssues(slug, parsed.issues);
            }

            if (mode === 'both' || mode === 'collected') {
              try {
                const collUrl = `https://www.readingorders.com/reading-orders/${slug}/collected-editions`;
                const collRes = await this._fetchHtml(collUrl);
                if (collRes && collRes.html) {
                  const collParsed = parseCollectedEditionsPage(collRes.html, slug);
                  if (this.readingOrdersDb && collParsed.collections) {
                    this.readingOrdersDb.upsertCollections(slug, collParsed.collections);
                  }
                }
              } catch (_) {}
            }

            scrapedCount++;
            storyArcsLog('INFO', `[${idx + 1}/${slugsToScrape.length}] ✓ Indexed ${parsed.title} (${parsed.publisher}, ${parsed.issues.length} issues).`);
          }
        } catch (itemErr) {
          storyArcsLog('WARN', `[${idx + 1}/${slugsToScrape.length}] ⚠ Failed to scrape ${slug}: ${itemErr.message}`);
        }
      }

      this.lastSyncTime = Date.now();
      this.status = 'idle';
      this.isSyncing = false;
      storyArcsLog('INFO', `Sync complete! Successfully indexed ${scrapedCount} reading orders.`);
      return { skipped: false, scrapedCount };
    } catch (err) {
      this.status = 'error';
      this.isSyncing = false;
      this.lastError = err.message;
      storyArcsLog('ERROR', `ReadingOrders sync error: ${err.message}`);
      throw err;
    }
  }
}

let defaultRunnerInstance = null;
function getReadingOrdersRunner(options) {
  if (!defaultRunnerInstance) {
    defaultRunnerInstance = new ReadingOrdersRunner(options);
    try {
      const interval = typeof config.getReadingOrdersIntervalDays === 'function' ? config.getReadingOrdersIntervalDays() : 7;
      const mode = typeof config.getReadingOrdersMode === 'function' ? config.getReadingOrdersMode() : 'both';
      defaultRunnerInstance.schedulePeriodicSync(interval, mode);
    } catch (_) {}
  }
  return defaultRunnerInstance;
}

module.exports = {
  ReadingOrdersRunner,
  getReadingOrdersRunner,
};
