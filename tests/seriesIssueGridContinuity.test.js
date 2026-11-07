/**
 * @jest-environment jsdom
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

describe('Series Issue Grid Continuity & Gap Cards', () => {
  let sandbox;

  beforeEach(() => {
    document.body.innerHTML = `
      <div id="comic-list-container"></div>
    `;

    const state = {
      API_BASE_URL: 'http://localhost:3000',
      currentPublisher: 'DC Comics',
      currentSeries: 'Batman',
      downloadedComicIds: new Set()
    };

    sandbox = {
      window,
      document,
      console,
      state,
      showStoryArcDetail: jest.fn(),
      ICONS: { READ: '✓', DOWNLOAD: '⬇', UNREAD: '○' },
      applyDisplayInfoToComic: jest.fn(c => ({
        displayTitle: c.name,
        subtitle: c.subtitle || '',
        altText: c.name
      })),
      escapeHtml: str => String(str || '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]))
    };

    vm.createContext(sandbox);

    // Load gap card builder
    const gapPath = path.resolve(__dirname, '../public/js/library/render/comics/gap-card.js');
    if (fs.existsSync(gapPath)) {
      const gapContent = fs.readFileSync(gapPath, 'utf8')
        .replace(/^\s*import\s+[\s\S]*?from\s+['"][^'"]+['"];?/gm, '')
        .replace(/export\s+function\s+/g, 'function ')
        .replace(/export\s+const\s+/g, 'const ');
      vm.runInContext(gapContent, sandbox);
    }

    // Load card builder
    const cardBuilderPath = path.resolve(__dirname, '../public/js/library/render/comics/card-builder.js');
    const cardContent = fs.readFileSync(cardBuilderPath, 'utf8')
      .replace(/^\s*import\s+[\s\S]*?from\s+['"][^'"]+['"];?/gm, '')
      .replace(/export\s+function\s+/g, 'function ')
      .replace(/export\s+const\s+/g, 'const ');
    vm.runInContext(cardContent, sandbox);
  });

  test('createComicCard renders Story Arc badge when StoryArc metadata is present', () => {
    const comic = {
      id: 101,
      name: 'Batman #1',
      metadata: {
        StoryArc: 'The Court of Owls',
        StoryArcNumber: '1'
      }
    };

    const card = sandbox.createComicCard(comic);
    expect(card).not.toBeNull();

    const badge = card.querySelector('.comic-arc-badge');
    expect(badge).not.toBeNull();
    expect(badge.textContent).toContain('The Court of Owls');
    expect(badge.textContent).toContain('#1');
  });

  test('createContinuityGapCard renders a dashed gap placeholder card with click handler', () => {
    const gap = {
      isGap: true,
      seriesName: 'Nightwing',
      issueNumber: '5',
      storyArc: 'Night of the Owls',
      arcId: 'night-of-the-owls',
      position: 8,
      storyParts: 'Part 2 of Night of the Owls'
    };

    const gapCard = sandbox.createContinuityGapCard(gap);
    expect(gapCard).not.toBeNull();
    expect(gapCard.classList.contains('continuity-gap-card')).toBe(true);
    expect(gapCard.textContent).toContain('Nightwing');
    expect(gapCard.textContent).toContain('#5');
    expect(gapCard.textContent).toContain('Continuity Gap');

    // Click handler
    gapCard.click();
    expect(sandbox.showStoryArcDetail).toHaveBeenCalledWith('night-of-the-owls', 'Night of the Owls', 'grid');
  });
});
