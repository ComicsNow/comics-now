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

  async startSync(options = {}) {
    if (this.isSyncing) {
      throw new Error('A reading orders sync is already in progress.');
    }

    const { mode = 'both', force = false } = options;
    this.isSyncing = true;
    this.status = 'syncing';
    this.lastError = null;

    try {
      // Tier 1: Check Sitemap ETag if not forcing
      if (!force) {
        const sitemapMeta = await this._fetchSitemapHeaders();
        if (sitemapMeta.status === 304 || (this.lastSitemapEtag && sitemapMeta.etag === this.lastSitemapEtag)) {
          this.status = 'idle';
          this.isSyncing = false;
          this.lastSyncTime = Date.now();
          return { skipped: true, reason: 'Sitemap not modified (304)', scrapedCount: 0 };
        }
        if (sitemapMeta.etag) {
          this.lastSitemapEtag = sitemapMeta.etag;
        }
      }

      this.lastSyncTime = Date.now();
      this.status = 'idle';
      this.isSyncing = false;
      return { skipped: false, scrapedCount: 0 };
    } catch (err) {
      this.status = 'error';
      this.isSyncing = false;
      this.lastError = err.message;
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
