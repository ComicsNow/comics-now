const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

describe('Standalone Graph UI Features & Modes (TDD)', () => {
  let dom;
  let document;
  let window;

  beforeEach(() => {
    const htmlPath = path.join(__dirname, '../public/index.html');
    const html = fs.readFileSync(htmlPath, 'utf8');

    dom = new JSDOM(html, {
      runScripts: 'dangerously',
      resources: 'usable',
      url: 'http://127.0.0.1:3021/'
    });

    document = dom.window.document;
    window = dom.window;
  });

  test('contains layout mode tabs for Network, Dual-Axis, and Horizon', () => {
    const tabs = document.querySelectorAll('.mode-tab[data-mode]');
    const modes = Array.from(tabs).map(t => t.getAttribute('data-mode'));

    expect(modes).toContain('network');
    expect(modes).toContain('dual-axis');
    expect(modes).toContain('horizon');

    const networkTab = document.getElementById('tab-network');
    expect(networkTab.classList.contains('active')).toBe(true);
  });

  test('contains publication history scrubber controls with slider and play button', () => {
    const scrubberBar = document.getElementById('scrubber-bar');
    expect(scrubberBar).not.toBeNull();

    const playBtn = document.getElementById('scrubber-play-btn');
    expect(playBtn).not.toBeNull();
    expect(playBtn.textContent.trim()).toBe('▶');

    const slider = document.getElementById('scrubber-slider');
    expect(slider).not.toBeNull();
    expect(slider.type).toBe('range');

    const yearDisplay = document.getElementById('scrubber-year-display');
    expect(yearDisplay).not.toBeNull();

    const eraDisplay = document.getElementById('scrubber-era-display');
    expect(eraDisplay).not.toBeNull();
  });

  test('contains continuity friction spotlight button and floating banner', () => {
    const frictionBtn = document.getElementById('friction-spotlight-btn');
    expect(frictionBtn).not.toBeNull();

    const banner = document.getElementById('friction-spotlight-banner');
    expect(banner).not.toBeNull();
    expect(banner.style.display).toBe('none');
  });

  test('contains interactive dossier elements with friction index meter and action buttons', () => {
    const bottomSheet = document.getElementById('bottom-sheet');
    expect(bottomSheet).not.toBeNull();

    const frictionBadge = document.getElementById('sb-friction-badge');
    expect(frictionBadge).not.toBeNull();

    const frictionScore = document.getElementById('sb-friction-score');
    expect(frictionScore).not.toBeNull();

    const frictionFill = document.getElementById('sb-friction-fill');
    expect(frictionFill).not.toBeNull();

    const debutYear = document.getElementById('sb-debut-year');
    expect(debutYear).not.toBeNull();

    const latestYear = document.getElementById('sb-latest-year');
    expect(latestYear).not.toBeNull();

    // Action buttons
    expect(document.getElementById('dossier-spotlight-btn')).not.toBeNull();
    expect(document.getElementById('dossier-play-btn')).not.toBeNull();
    expect(document.getElementById('dossier-isolate-btn')).not.toBeNull();
  });
});
