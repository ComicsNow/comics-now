/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function loadScanModule() {
  const fullPath = path.resolve(__dirname, '../../../../public/js/comictagger/scan.js');
  let code = fs.readFileSync(fullPath, 'utf8');
  code = code.replace(/^import\s+[\s\S]*?from\s+['"][^'"]+['"];?\s*$/gm, '');
  code = code.replace(/export\s+async\s+function\s+/g, 'async function ');
  code = code.replace(/export\s+function\s+/g, 'function ');

  const sandbox = {
    document,
    window,
    console,
    Date,
    Number,
    String,
    Map,
    Array,
    Proxy,
    globalThis,
    escapeHtml,
    html: (strings, ...vals) => ({
      toHTML: () => strings.reduce((acc, s, i) => acc + s + (i < vals.length ? escapeHtml(vals[i]) : ''), '')
    }),
    raw: (htmlStr) => ({ __isRawHtml: true, html: htmlStr }),
    state: { API_BASE_URL: 'http://localhost:3000' },
    canonicalGlobal: { API_BASE_URL: 'http://localhost:3000' },
    fetch: (...args) => global.fetch(...args),
    setScanRunningUI: jest.fn(),
    appendLocalCtLogLine: jest.fn(),
    ctTabMatches: null,
  };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  return sandbox;
}

describe('Recent Scan Audits per-run inspection & status filtering', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="ct-logs-container"></div>';
  });

  it('classifies result statuses into successful, failed, and skipped buckets', () => {
    const mod = loadScanModule();
    expect(mod.classifyScanResultStatus('tagged')).toBe('successful');
    expect(mod.classifyScanResultStatus('success')).toBe('successful');
    expect(mod.classifyScanResultStatus('failed')).toBe('failed');
    expect(mod.classifyScanResultStatus('error')).toBe('failed');
    expect(mod.classifyScanResultStatus('skipped')).toBe('skipped');
    expect(mod.classifyScanResultStatus('review')).toBe('skipped');
    expect(mod.classifyScanResultStatus('no_match')).toBe('skipped');
  });

  it('expands a scan run on Inspect click and filters results by Successful, Failed, and Skipped', async () => {
    const runDetail = {
      id: '20261114_025804_abc12345',
      results: [
        { filename: 'Batman 001.cbz', status: 'tagged', matched_title: 'Batman #1', confidence: 0.95, source: 'ComicVine' },
        { filename: 'Broken 002.cbz', status: 'failed', error: 'Corrupt archive' },
        { filename: 'Review 003.cbz', status: 'review', reason: 'Low confidence <script>alert(1)</script>' }
      ]
    };

    global.fetch = jest.fn((url) => {
      if (url.endsWith('/api/v1/tag-comics-now/scan-logs')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            ok: true,
            logs: [{
              id: '20261114_025804_abc12345',
              timestamp: '2026-11-14T02:58:04.000Z',
              type: 'library',
              target: '/comics/DC',
              total_files: 3,
              tagged_count: 1,
              skipped_count: 1,
              failed_count: 1
            }]
          })
        });
      }
      if (url.endsWith('/api/v1/tag-comics-now/scan-logs/20261114_025804_abc12345')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ ok: true, log: runDetail })
        });
      }
      return Promise.reject(new Error(`Unexpected URL: ${url}`));
    });

    const mod = loadScanModule();
    await mod.loadScanLogs();

    const inspectBtn = document.querySelector('[data-toggle-run-id="20261114_025804_abc12345"]');
    expect(inspectBtn).not.toBeNull();
    inspectBtn.click();
    await new Promise(r => setTimeout(r, 0));

    const panel = document.querySelector('[data-run-detail-panel="20261114_025804_abc12345"]');
    expect(panel.classList.contains('hidden')).toBe(false);
    expect(panel.textContent).toContain('Batman 001.cbz');
    expect(panel.textContent).toContain('Broken 002.cbz');
    expect(panel.textContent).toContain('Review 003.cbz');
    // Ensure XSS payload was escaped, not injected
    expect(panel.querySelector('script')).toBeNull();

    // Filter: Successful
    panel.querySelector('[data-audit-filter="successful"]').click();
    expect(panel.textContent).toContain('Batman 001.cbz');
    expect(panel.textContent).not.toContain('Broken 002.cbz');
    expect(panel.textContent).not.toContain('Review 003.cbz');

    // Filter: Failed
    panel.querySelector('[data-audit-filter="failed"]').click();
    expect(panel.textContent).not.toContain('Batman 001.cbz');
    expect(panel.textContent).toContain('Broken 002.cbz');
    expect(panel.textContent).not.toContain('Review 003.cbz');

    // Filter: Skipped
    panel.querySelector('[data-audit-filter="skipped"]').click();
    expect(panel.textContent).not.toContain('Batman 001.cbz');
    expect(panel.textContent).not.toContain('Broken 002.cbz');
    expect(panel.textContent).toContain('Review 003.cbz');
  });
});
