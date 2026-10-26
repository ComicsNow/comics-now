/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const HTML_PATH = path.join(ROOT, 'public', 'index.html');
const CSS_PATH = path.join(ROOT, 'public', 'style.css');
const ALPHA_LIST_PATH = path.join(ROOT, 'public', 'js', 'library', 'alpha-list.js');

function loadModuleInVm(filePath, customSandbox = {}) {
  const code = fs.readFileSync(filePath, 'utf8')
    .replace(/import\s+[\s\S]*?from\s+['"][^'"]+['"];?/g, '')
    .replace(/import\s+['"][^'"]+['"];?/g, '')
    .replace(/export\s+const\s+/g, 'const ')
    .replace(/export\s+let\s+/g, 'let ')
    .replace(/export\s+function\s+/g, 'function ')
    .replace(/export\s+async\s+function\s+/g, 'async function ')
    .replace(/export\s+\{[\s\S]*?\};?/g, '')
    .replace(/export\s+default\s+[\s\S]*?;?/g, '');

  const sandbox = {
    window,
    document,
    console,
    state: {},
    ...customSandbox
  };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  return sandbox;
}

describe('Mobile Layout - Unconsolidated Filter Bar, Plugin-Friendly Header & Edge Index', () => {
  let htmlContent;
  let cssContent;

  beforeAll(() => {
    htmlContent = fs.readFileSync(HTML_PATH, 'utf8');
    cssContent = fs.readFileSync(CSS_PATH, 'utf8');
  });

  describe('Header Toolbar & Plugin Insertion Compatibility', () => {
    it('has standard header action buttons sharing the same parent container', () => {
      document.body.innerHTML = htmlContent;
      const readingListBtn = document.getElementById('reading-list-button');
      const downloadsBtn = document.getElementById('downloads-button');
      const ctBtn = document.getElementById('ct-button');
      const settingsBtn = document.getElementById('settings-button');

      expect(readingListBtn).not.toBeNull();
      expect(downloadsBtn).not.toBeNull();
      expect(ctBtn).not.toBeNull();
      expect(settingsBtn).not.toBeNull();

      // All buttons share the same header actions group
      expect(readingListBtn.parentElement).toBe(settingsBtn.parentElement);
      expect(downloadsBtn.parentElement).toBe(settingsBtn.parentElement);
      expect(ctBtn.parentElement).toBe(settingsBtn.parentElement);
    });

    it('supports private plugin buttons being inserted before #settings-button seamlessly', () => {
      document.body.innerHTML = htmlContent;
      const settingsBtn = document.getElementById('settings-button');
      const headerGroup = settingsBtn.parentElement;
      expect(headerGroup).not.toBeNull();

      // Simulate plugin insertion (tracker.js / aria.js)
      const mockPluginBtn = document.createElement('button');
      mockPluginBtn.id = 'tracker-button';
      headerGroup.insertBefore(mockPluginBtn, settingsBtn);

      expect(document.getElementById('tracker-button')).not.toBeNull();
      expect(mockPluginBtn.nextElementSibling).toBe(settingsBtn);
    });

    it('preserves the download icon (#downloads-button) with original attributes', () => {
      document.body.innerHTML = htmlContent;
      const dlBtn = document.getElementById('downloads-button');
      expect(dlBtn.getAttribute('aria-label')).toBe('Downloads');
      expect(dlBtn.getAttribute('onclick')).toBe('openDownloadsPanel()');
    });

    it('preserves the second download icon (#downloaded-btn in smart filter pills)', () => {
      document.body.innerHTML = htmlContent;
      const downloadedPill = document.getElementById('downloaded-btn');
      expect(downloadedPill).not.toBeNull();
    });
  });

  describe('Native Unconsolidated Filter Bar', () => {
    it('does NOT contain an expand toggle button (consolidated filter undone)', () => {
      document.body.innerHTML = htmlContent;
      const toggle = document.getElementById('filter-expand-toggle');
      expect(toggle).toBeNull();
    });

    it('renders all four status filter pills directly inside #filter-buttons', () => {
      document.body.innerHTML = htmlContent;
      const buttons = document.querySelectorAll('#filter-buttons .filter-btn');
      expect(buttons.length).toBe(4);
      const filters = Array.from(buttons).map(b => b.getAttribute('data-filter'));
      expect(filters).toEqual(['all', 'unread', 'in-progress', 'read']);
    });
  });

  describe('Edge Index Vertical Alphabet Scrubber', () => {
    it('configures alpha filters as vertical edge indexes along screen edge', () => {
      document.body.innerHTML = htmlContent;
      const pubFilter = document.getElementById('publisher-alpha-filter');
      const seriesFilter = document.getElementById('series-alpha-filter');
      const comicFilter = document.getElementById('comic-alpha-filter');

      expect(pubFilter).not.toBeNull();
      expect(seriesFilter).not.toBeNull();
      expect(comicFilter).not.toBeNull();

      expect(pubFilter.classList.contains('edge-index')).toBe(true);
      expect(seriesFilter.classList.contains('edge-index')).toBe(true);
      expect(comicFilter.classList.contains('edge-index')).toBe(true);
    });

    it('renders letters vertically in renderAlphaFilter and handles selection', () => {
      const targetDiv = document.createElement('div');
      targetDiv.id = 'test-alpha-filter';
      targetDiv.className = 'edge-index';
      document.body.appendChild(targetDiv);

      const state = { activeAlphaFilter: 'All' };
      const renderFn = jest.fn();
      const testData = [
        { name: 'Action Comics' },
        { name: 'Batman' },
        { name: 'Crisis' }
      ];

      const sandbox = loadModuleInVm(ALPHA_LIST_PATH, { state });
      sandbox.renderAlphaFilter(targetDiv, testData, renderFn, 'comics');

      const buttons = targetDiv.querySelectorAll('.alpha-filter-btn');
      expect(buttons.length).toBeGreaterThanOrEqual(28); // All, #, A-Z

      // Click 'B'
      const btnB = Array.from(buttons).find(b => b.textContent.trim() === 'B');
      expect(btnB).toBeDefined();
      btnB.click();

      expect(btnB.classList.contains('active')).toBe(true);
    });

    it('contains edge-index CSS styling in style.css', () => {
      expect(cssContent).toMatch(/\.edge-index|\.edge-index-rail/);
    });
  });

  describe('Heavy Green Banner & Cover Art Bleed', () => {
    it('retains heavy green banner styling for read status', () => {
      expect(cssContent).toMatch(/\.status-banner/);
      expect(cssContent).toMatch(/\.status-read[^{]*\{[^}]*(?:rgba\(16,\s*185,\s*129|#059669|#10b981|#047857)/);
    });

    it('ensures cover art bleeds full width and height with object-fit cover', () => {
      expect(cssContent).toMatch(/\.comic-cover-image[^{]*\{[^}]*object-fit:\s*cover/);
      expect(cssContent).toMatch(/\.comic-cover-image[^{]*\{[^}]*width:\s*100%/);
    });
  });
});
