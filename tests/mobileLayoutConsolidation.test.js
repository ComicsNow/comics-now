/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const HTML_PATH = path.join(ROOT, 'public', 'index.html');
const CSS_PATH = path.join(ROOT, 'public', 'style.css');
const FILTER_BAR_PATH = path.join(ROOT, 'public', 'js', 'library', 'filter-bar.js');
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

describe('Mobile Layout Modernization & Consolidation', () => {
  let htmlContent;
  let cssContent;

  beforeAll(() => {
    htmlContent = fs.readFileSync(HTML_PATH, 'utf8');
    cssContent = fs.readFileSync(CSS_PATH, 'utf8');
  });

  describe('Secondary Tools Grouping in Header Toolbar', () => {
    it('groups secondary tools (#reading-list-button, #ct-button, #settings-button) into a cohesive container', () => {
      document.body.innerHTML = htmlContent;
      const group = document.getElementById('secondary-tools-group');
      expect(group).not.toBeNull();
      expect(group.querySelector('#reading-list-button')).not.toBeNull();
      expect(group.querySelector('#ct-button')).not.toBeNull();
      expect(group.querySelector('#settings-button')).not.toBeNull();
    });

    it('preserves #downloads-button standalone alongside secondary tools without modifying its core attributes', () => {
      document.body.innerHTML = htmlContent;
      const dlBtn = document.getElementById('downloads-button');
      expect(dlBtn).not.toBeNull();
      expect(dlBtn.getAttribute('aria-label')).toBe('Downloads');
      expect(dlBtn.getAttribute('onclick')).toBe('openDownloadsPanel()');

      // Secondary tools group does NOT contain downloads-button
      const group = document.getElementById('secondary-tools-group');
      expect(group.querySelector('#downloads-button')).toBeNull();
    });

    it('preserves the second download icon (#downloaded-btn in smart filter pills)', () => {
      document.body.innerHTML = htmlContent;
      const downloadedPill = document.getElementById('downloaded-btn');
      expect(downloadedPill).not.toBeNull();
    });
  });

  describe('Consolidated Filter Bar with Industry-Standard Expand/Collapse Toggle', () => {
    it('includes an industry-standard expand toggle button in the filter container', () => {
      document.body.innerHTML = htmlContent;
      const toggle = document.getElementById('filter-expand-toggle');
      expect(toggle).not.toBeNull();
      expect(toggle.getAttribute('aria-expanded')).toBe('false');
      expect(toggle.getAttribute('aria-label')).toMatch(/filter/i);
    });

    it('consolidates filters into one row by default and expands to two rows when toggled', () => {
      document.body.innerHTML = htmlContent;
      const container = document.getElementById('filters-container');
      const toggle = document.getElementById('filter-expand-toggle');
      expect(container).not.toBeNull();
      expect(toggle).not.toBeNull();

      // Run filter-bar module in VM
      const sandbox = loadModuleInVm(FILTER_BAR_PATH);
      sandbox.initFilterConsolidation();

      // Default state: collapsed
      expect(toggle.getAttribute('aria-expanded')).toBe('false');
      expect(container.dataset.expanded).toBe('false');

      // Click to expand
      toggle.click();
      expect(toggle.getAttribute('aria-expanded')).toBe('true');
      expect(container.dataset.expanded).toBe('true');
      expect(container.classList.contains('filters-expanded')).toBe(true);

      // Click again to collapse
      toggle.click();
      expect(toggle.getAttribute('aria-expanded')).toBe('false');
      expect(container.dataset.expanded).toBe('false');
    });

    it('defines CSS styles for single-row collapsed mode and 2-row expanded mode', () => {
      expect(cssContent).toMatch(/#filters-container/);
      expect(cssContent).toMatch(/\.filter-expand-btn|#filter-expand-toggle/);
      expect(cssContent).toMatch(/filters-expanded/);
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
      // Must maintain bold/heavy green banner
      expect(cssContent).toMatch(/\.status-banner/);
      expect(cssContent).toMatch(/\.status-read[^{]*\{[^}]*(?:rgba\(16,\s*185,\s*129|#059669|#10b981|#047857)/);
    });

    it('ensures cover art bleeds full width and height with object-fit cover', () => {
      expect(cssContent).toMatch(/\.comic-cover-image[^{]*\{[^}]*object-fit:\s*cover/);
      expect(cssContent).toMatch(/\.comic-cover-image[^{]*\{[^}]*width:\s*100%/);
    });
  });
});
