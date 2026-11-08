/**
 * @jest-environment jsdom
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

describe('Story Arc Metro & Proportional Progression Visualizer UI', () => {
  let sandbox;
  let sampleCollections;
  let sampleIssues;

  beforeEach(() => {
    document.body.innerHTML = '';

    sampleCollections = [
      {
        id: 'col-1',
        position: 1,
        title: 'DC K.O.',
        subtitle: 'Main Event',
        pageCount: 192,
        releaseYear: 2024,
        owned: true,
        readStatus: 'read',
        lastReadPage: 192,
        comicId: 201,
        coverImageUrl: '/covers/dcko-1.jpg'
      },
      {
        id: 'col-2',
        position: 2,
        title: 'DC K.O.: Superman',
        subtitle: 'Champions Tie-In',
        pageCount: 200,
        releaseYear: 2024,
        owned: true,
        readStatus: 'reading',
        lastReadPage: 45,
        comicId: 202,
        coverImageUrl: '/covers/dcko-2.jpg'
      },
      {
        id: 'col-3',
        position: 3,
        title: 'DC K.O.: All Fight',
        subtitle: 'The Climax',
        pageCount: 248,
        releaseYear: 2025,
        owned: false,
        readStatus: 'missing',
        lastReadPage: 0,
        comicId: null,
        coverImageUrl: null
      }
    ];

    sampleIssues = [
      {
        id: 'iss-1',
        position: 1,
        seriesName: 'Batman',
        issueNumber: '136',
        publicationDate: 'Aug 2023',
        storyParts: 'The Gotham War: Prelude',
        importance: 'Essential',
        isOwned: true,
        owned: true,
        readStatus: 'read',
        pageCount: 32,
        comicId: 101,
        coverImageUrl: '/covers/batman-136.jpg'
      },
      {
        id: 'iss-2',
        position: 2,
        seriesName: 'Catwoman',
        issueNumber: '57',
        publicationDate: 'Sep 2023',
        storyParts: 'The Gotham War: Part 1',
        importance: 'Essential',
        isOwned: false,
        owned: false,
        readStatus: 'missing',
        pageCount: 32,
        comicId: null,
        coverImageUrl: null
      }
    ];

    sandbox = {
      window,
      document,
      console,
      setTimeout,
      clearTimeout,
      escapeHtml: str => String(str || '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]))
    };

    vm.createContext(sandbox);

    const loadModule = (relPath) => {
      const fullPath = path.resolve(__dirname, relPath);
      if (fs.existsSync(fullPath)) {
        const code = fs.readFileSync(fullPath, 'utf8')
          .replace(/^\s*import\s+[\s\S]*?from\s+['"][^'"]+['"];?/gm, '')
          .replace(/^\s*import\s+['"][^'"]+['"];?/gm, '')
          .replace(/export\s+const\s+/g, 'const ')
          .replace(/export\s+let\s+/g, 'let ')
          .replace(/export\s+function\s+/g, 'function ')
          .replace(/export\s+async\s+function\s+/g, 'async function ')
          .replace(/export\s+\{[\s\S]*?\};?/g, '')
          .replace(/export\s+default\s+[\s\S]*?;?/g, '');
        vm.runInContext(code, sandbox);
      }
    };

    loadModule('../public/js/library/story-arcs-collections.js');
    loadModule('../public/js/library/story-arcs-metro.js');
  });

  test('renderStoryArcMetroView renders inspector card, metro line, and proportional bar', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    expect(typeof sandbox.renderStoryArcMetroView).toBe('function');
    sandbox.renderStoryArcMetroView(container, sampleCollections, 'collections');

    const inspector = container.querySelector('#story-arc-metro-inspector');
    expect(inspector).not.toBeNull();

    const metroLine = container.querySelector('#story-arc-metro-line');
    expect(metroLine).not.toBeNull();

    const propBar = container.querySelector('#story-arc-metro-prop-bar');
    expect(propBar).not.toBeNull();

    const nodes = metroLine.querySelectorAll('.metro-node');
    expect(nodes.length).toBe(3);

    const segments = propBar.querySelectorAll('.prop-segment');
    expect(segments.length).toBe(3);
  });

  test('proportional bar calculates page shares accurately', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    sandbox.renderStoryArcMetroView(container, sampleCollections, 'collections');

    // Total pages = 192 + 200 + 248 = 640 pages
    // col-1 = 192 / 640 = 30.0%
    // col-2 = 200 / 640 = 31.25%
    // col-3 = 248 / 640 = 38.75%
    const segments = container.querySelectorAll('.prop-segment');
    expect(segments[0].style.width).toBe('30%');
    expect(segments[1].style.width).toBe('31.25%');
    expect(segments[2].style.width).toBe('38.75%');
  });

  test('clicking a metro node synchronizes inspector card and proportional bar', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    sandbox.renderStoryArcMetroView(container, sampleCollections, 'collections');

    const nodes = container.querySelectorAll('.metro-node');
    const segments = container.querySelectorAll('.prop-segment');

    // Initially node 0 is active
    expect(nodes[0].classList.contains('active')).toBe(true);
    expect(segments[0].classList.contains('active')).toBe(true);

    // Click node 1 (DC K.O.: Superman)
    nodes[1].click();

    expect(nodes[1].classList.contains('active')).toBe(true);
    expect(nodes[0].classList.contains('active')).toBe(false);
    expect(segments[1].classList.contains('active')).toBe(true);

    const titleEl = container.querySelector('#metro-inspector-title');
    expect(titleEl.textContent).toContain('DC K.O.: Superman');

    const pagesEl = container.querySelector('#metro-inspector-pages');
    expect(pagesEl.textContent).toContain('200');

    const percentEl = container.querySelector('#metro-inspector-percent');
    expect(percentEl.textContent).toContain('31.3%');
  });

  test('clicking a proportional segment synchronizes metro node and inspector card', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    sandbox.renderStoryArcMetroView(container, sampleCollections, 'collections');

    const segments = container.querySelectorAll('.prop-segment');
    segments[2].click();

    const nodes = container.querySelectorAll('.metro-node');
    expect(nodes[2].classList.contains('active')).toBe(true);

    const titleEl = container.querySelector('#metro-inspector-title');
    expect(titleEl.textContent).toContain('DC K.O.: All Fight');

    const statusBadge = container.querySelector('#metro-inspector-status');
    expect(statusBadge.textContent).toContain('Missing');
  });

  test('prev and next navigation buttons step through stations', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    sandbox.renderStoryArcMetroView(container, sampleCollections, 'collections');

    const prevBtn = container.querySelector('#metro-inspector-prev-btn');
    const nextBtn = container.querySelector('#metro-inspector-next-btn');

    // Click next from station 0 to station 1
    nextBtn.click();
    let nodes = container.querySelectorAll('.metro-node');
    expect(nodes[1].classList.contains('active')).toBe(true);

    // Click next to station 2
    nextBtn.click();
    nodes = container.querySelectorAll('.metro-node');
    expect(nodes[2].classList.contains('active')).toBe(true);

    // Click prev back to station 1
    prevBtn.click();
    nodes = container.querySelectorAll('.metro-node');
    expect(nodes[1].classList.contains('active')).toBe(true);
  });

  test('read CTA invokes onComicSelect callback when item is owned', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    const onComicSelect = jest.fn();
    sandbox.renderStoryArcMetroView(container, sampleCollections, 'collections', onComicSelect);

    const readBtn = container.querySelector('#metro-inspector-read-btn');
    expect(readBtn).not.toBeNull();
    readBtn.click();

    expect(onComicSelect).toHaveBeenCalledWith(sampleCollections[0]);
  });

  test('keyboard arrow keys navigate active station', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    sandbox.renderStoryArcMetroView(container, sampleCollections, 'collections');

    const eventRight = new window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true });
    container.dispatchEvent(eventRight);

    let nodes = container.querySelectorAll('.metro-node');
    expect(nodes[1].classList.contains('active')).toBe(true);

    const eventLeft = new window.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true });
    container.dispatchEvent(eventLeft);

    nodes = container.querySelectorAll('.metro-node');
    expect(nodes[0].classList.contains('active')).toBe(true);
  });

  test('renders empty state when items list is empty', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    sandbox.renderStoryArcMetroView(container, [], 'collections');

    expect(container.textContent).toContain('No items found');
  });

  test('inspector card subtitle and headers contain overflow on narrow widths', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    sandbox.renderStoryArcMetroView(container, sampleCollections, 'collections');

    const inspector = container.querySelector('#story-arc-metro-inspector');
    expect(inspector.classList.contains('overflow-hidden')).toBe(true);
    expect(inspector.classList.contains('w-full')).toBe(true);

    const subEl = container.querySelector('#metro-inspector-subtitle');
    expect(subEl.classList.contains('line-clamp-2')).toBe(true);
    expect(subEl.classList.contains('break-words')).toBe(true);
  });
});
