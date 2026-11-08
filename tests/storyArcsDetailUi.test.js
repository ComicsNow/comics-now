/**
 * @jest-environment jsdom
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

describe('Story Arcs Detail & Banner UI View', () => {
  let sandbox;

  beforeEach(() => {
    document.body.innerHTML = '';

    const state = {
      API_BASE_URL: 'http://localhost:3000'
    };

    sandbox = {
      window,
      document,
      console,
      setTimeout,
      clearTimeout,
      state,
      getStoryArcEditionPreference: jest.fn().mockReturnValue('issues'),
      launchComicReader: jest.fn(),
      escapeHtml: str => String(str || '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])),
      fetch: jest.fn().mockImplementation((url) => {
        if (url.includes('/api/v1/story-arcs/court-of-owls')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              ok: true,
              storyArc: {
                id: 'court-of-owls',
                title: 'Batman: The Court of Owls',
                publisher: 'DC Comics',
                description: 'A secret society has controlled Gotham from the shadows for centuries.',
                totalIssues: 3,
                ownedCount: 2,
                missingCount: 1,
                completenessPercent: 67,
                issues: [
                  {
                    id: 'iss-1',
                    position: 1,
                    seriesName: 'Batman',
                    issueNumber: '1',
                    publicationDate: 'Nov 2011',
                    importance: 'Essential',
                    storyParts: 'Court of Owls: Part 1',
                    isOwned: true,
                    comicId: 101,
                    coverImageUrl: '/covers/batman-1.jpg'
                  },
                  {
                    id: 'iss-2',
                    position: 2,
                    seriesName: 'Nightwing',
                    issueNumber: '1',
                    publicationDate: 'Nov 2011',
                    importance: 'Tie-In',
                    storyParts: 'Court of Owls Tie-In: Part 1',
                    isOwned: false,
                    comicId: null,
                    coverImageUrl: null
                  },
                  {
                    id: 'iss-3',
                    position: 3,
                    seriesName: 'Batman',
                    issueNumber: '2',
                    publicationDate: 'Dec 2011',
                    importance: 'Essential',
                    storyParts: 'Court of Owls: Part 2',
                    isOwned: true,
                    comicId: 102,
                    coverImageUrl: '/covers/batman-2.jpg'
                  }
                ],
                collections: [
                  {
                    id: 'col-1',
                    position: 1,
                    title: 'Batman Vol. 1: The Court of Owls',
                    subtitle: 'Collects Batman #1-7',
                    releaseYear: 2012,
                    pageCount: 176
                  }
                ]
              }
            })
          });
        }
        return Promise.resolve({ ok: false });
      })
    };

    vm.createContext(sandbox);

    const loadModule = (relPath) => {
      const fullPath = path.resolve(__dirname, relPath);
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
    };

    loadModule('../public/js/library/story-arcs-collections.js');
    loadModule('../public/js/library/story-arcs-issues.js');
    loadModule('../public/js/library/story-arcs-metro.js');
    loadModule('../public/js/library/story-arcs-detail.js');
  });

  test('showStoryArcDetail mounts modal with Gold/Amber trade dress and title', async () => {
    await sandbox.showStoryArcDetail('court-of-owls', 'Batman: The Court of Owls', 'grid');

    const modal = document.getElementById('story-arc-detail-modal');
    expect(modal).not.toBeNull();
    expect(modal.classList.contains('hidden')).toBe(false);

    const title = document.getElementById('story-arc-modal-title');
    expect(title.textContent).toContain('Batman: The Court of Owls');

    const publisherBadge = document.getElementById('story-arc-publisher-badge');
    expect(publisherBadge.textContent).toBe('DC Comics');

    const ownedBadge = document.getElementById('story-arc-owned-badge');
    expect(ownedBadge.textContent).toContain('2/3 In Library');
  });

  test('view mode switcher switches between grid and checklist', async () => {
    await sandbox.showStoryArcDetail('court-of-owls', 'Batman: The Court of Owls', 'grid');

    const gridContainer = document.getElementById('story-arc-grid-view');
    const checklistContainer = document.getElementById('story-arc-checklist-view');

    expect(gridContainer.classList.contains('hidden')).toBe(false);
    expect(checklistContainer.classList.contains('hidden')).toBe(true);

    const checklistBtn = document.getElementById('story-arc-view-checklist-btn');
    checklistBtn.click();
    expect(gridContainer.classList.contains('hidden')).toBe(true);
    expect(checklistContainer.classList.contains('hidden')).toBe(false);

    const gridBtn = document.getElementById('story-arc-view-grid-btn');
    gridBtn.click();
    expect(gridContainer.classList.contains('hidden')).toBe(false);
    expect(checklistContainer.classList.contains('hidden')).toBe(true);
  });

  test('view mode switcher supports metro timeline view mode', async () => {
    await sandbox.showStoryArcDetail('court-of-owls', 'Batman: The Court of Owls', 'grid');

    const gridContainer = document.getElementById('story-arc-grid-view');
    const metroContainer = document.getElementById('story-arc-metro-view');
    const metroBtn = document.getElementById('story-arc-view-metro-btn');

    expect(metroBtn).not.toBeNull();
    expect(gridContainer.classList.contains('hidden')).toBe(false);
    expect(metroContainer.classList.contains('hidden')).toBe(true);

    metroBtn.click();
    expect(gridContainer.classList.contains('hidden')).toBe(true);
    expect(metroContainer.classList.contains('hidden')).toBe(false);

    // Inspector card and metro nodes should be rendered
    const nodes = metroContainer.querySelectorAll('.metro-node');
    expect(nodes.length).toBe(3);
  });

  test('grid view renders owned issue cards and missing gap cards', async () => {
    await sandbox.showStoryArcDetail('court-of-owls', 'Batman: The Court of Owls', 'grid');

    const cards = document.querySelectorAll('#story-arc-grid-view .story-arc-issue-card');
    expect(cards.length).toBe(3);

    // First card: owned
    expect(cards[0].textContent).toContain('Batman');
    expect(cards[0].textContent).toContain('#1');
    expect(cards[0].textContent).toContain('In Library');

    // Second card: missing gap
    expect(cards[1].textContent).toContain('Nightwing');
    expect(cards[1].textContent).toContain('#1');
    expect(cards[1].textContent).toContain('Missing');
  });

  test('checklist view renders chronological table of issues', async () => {
    await sandbox.showStoryArcDetail('court-of-owls', 'Batman: The Court of Owls', 'checklist');

    const rows = document.querySelectorAll('#story-arc-checklist-view tbody tr');
    expect(rows.length).toBe(3);
    expect(rows[0].textContent).toContain('Batman');
    expect(rows[1].textContent).toContain('Nightwing');
  });

  test('closeStoryArcDetail closes and hides the modal', async () => {
    await sandbox.showStoryArcDetail('court-of-owls', 'Batman: The Court of Owls');
    const modal = document.getElementById('story-arc-detail-modal');
    expect(modal.classList.contains('hidden')).toBe(false);

    sandbox.closeStoryArcDetail();
    expect(modal.classList.contains('hidden')).toBe(true);
  });
});
