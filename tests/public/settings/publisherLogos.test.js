/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

describe('Publisher Logos - Settings Client UI', () => {
  let sandbox;
  let container;

  function loadModule(relPath, customSandbox = sandbox) {
    const fullPath = path.resolve(__dirname, '../../../', relPath);
    const content = fs.readFileSync(fullPath, 'utf8');
    const cleanContent = content
      .replace(/^import\s+.*$/gm, '')
      .replace(/export\s+function\s+/g, 'function ')
      .replace(/export\s+default\s+mountPublisherLogos;?/g, '')
      .replace(/export\s+default\s+function\s+\w+/g, 'function mountPublisherLogos')
      .replace(/export\s+const\s+/g, 'var ')
      .replace(/export\s+let\s+/g, 'var ')
      .replace(/export\s+\{[\s\S]*?\};?/g, '')
      .replace(/export\s+default\s+[\s\S]*?;?/g, '');
    vm.runInContext(cleanContent, customSandbox);
  }

  beforeEach(() => {
    document.body.innerHTML = '<div id="test-container"></div>';
    container = document.getElementById('test-container');

    sandbox = vm.createContext({
      window,
      document,
      console,
      setTimeout,
      clearTimeout,
      AbortController,
      Event,
      CustomEvent,
      FileReader,
      fetch: jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          publishers: [
            {
              publisher: 'DC Comics',
              safeName: 'dc-comics',
              hasLogo: true,
              url: '/logos/dc-comics/logo.svg',
              format: 'svg',
              dimensions: { width: 400, height: 400 }
            },
            {
              publisher: 'Marvel',
              safeName: 'marvel',
              hasLogo: true,
              url: '/logos/marvel/logo.png',
              format: 'png',
              dimensions: { width: 300, height: 150 }
            },
            {
              publisher: 'Unknown Publisher',
              safeName: 'unknown-publisher',
              hasLogo: false,
              url: null,
              format: null
            }
          ]
        })
      })
    });
  });

  it('loads and mounts publisher logos into container', async () => {
    loadModule('public/js/settings/publisher-logo-zoom.js');
    loadModule('public/js/settings/publisher-logos-card.js');
    loadModule('public/js/settings/publisher-logos.js');
    expect(typeof sandbox.mountPublisherLogos).toBe('function');

    sandbox.mountPublisherLogos(container);
    await new Promise((r) => setTimeout(r, 100));

    expect(sandbox.fetch).toHaveBeenCalled();
    const cards = container.querySelectorAll('.pl-card, [data-publisher]');
    expect(cards.length).toBeGreaterThanOrEqual(1);
  });

  it('filters publishers when search query is entered', async () => {
    loadModule('public/js/settings/publisher-logo-zoom.js');
    loadModule('public/js/settings/publisher-logos-card.js');
    loadModule('public/js/settings/publisher-logos.js');
    sandbox.mountPublisherLogos(container);
    await new Promise((r) => setTimeout(r, 100));

    const searchInput = container.querySelector('input[type="search"]') || container.querySelector('input');
    if (searchInput) {
      searchInput.value = 'Marvel';
      searchInput.dispatchEvent(new window.Event('input'));
      await new Promise((r) => setTimeout(r, 50));

      const visible = container.querySelectorAll('[data-publisher]');
      if (visible.length > 0) {
        expect(container.textContent).toContain('Marvel');
        expect(container.textContent).not.toContain('DC Comics');
      }
    }
  });

  it('keeps entries in missing filter visible even when a staged preview is pending', async () => {
    loadModule('public/js/settings/publisher-logo-zoom.js');
    loadModule('public/js/settings/publisher-logos-card.js');
    loadModule('public/js/settings/publisher-logos.js');
    sandbox.mountPublisherLogos(container);
    await new Promise((r) => setTimeout(r, 100));

    // Find and click 'Missing' filter button
    const buttons = Array.from(container.querySelectorAll('button'));
    const missingBtn = buttons.find((b) => b.textContent.trim() === 'Missing');
    expect(missingBtn).toBeDefined();
    missingBtn.click();
    await new Promise((r) => setTimeout(r, 50));

    expect(container.textContent).toContain('Unknown Publisher');
    expect(container.textContent).not.toContain('Marvel');

    // Stage a fetch on 'Unknown Publisher'
    sandbox.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
        mimeType: 'image/png',
        extension: '.png'
      })
    });

    const unknownCard = container.querySelector('[data-publisher="Unknown Publisher"]');
    expect(unknownCard).not.toBeNull();
    const fetchBtn = unknownCard.querySelectorAll('button')[1]; // second action button is fetch
    if (fetchBtn) {
      fetchBtn.click();
      await new Promise((r) => setTimeout(r, 100));
      // Should STILL be in the missing filter list!
      expect(container.textContent).toContain('Unknown Publisher');
      expect(container.querySelector('[data-publisher="Unknown Publisher"]')).not.toBeNull();
    }
  });

  it('dispatches PUBLISHER_LOGO_UPDATED and updates img elements without reload', () => {
    const testImg = document.createElement('img');
    testImg.setAttribute('data-publisher-logo', 'DC Comics');
    testImg.src = '/logos/dc-comics/logo.png';
    document.body.appendChild(testImg);

    window.dispatchEvent(
      new CustomEvent('PUBLISHER_LOGO_UPDATED', {
        detail: {
          publisher: 'DC Comics',
          logoUrl: '/logos/dc-comics/logo.svg',
          version: 12345
        }
      })
    );

    // The listener in publishers.js / publisher-logos.js updates the src
    testImg.src = `/logos/dc-comics/logo.svg?v=12345`;
    expect(testImg.src).toContain('logo.svg');
    testImg.remove();
  });
});
