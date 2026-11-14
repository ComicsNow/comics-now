/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

function stripEsmSyntax(source) {
  return source
    .replace(/import\s+[\s\S]*?from\s+['"][^'"]+['"];?/g, '')
    .replace(/export\s+async\s+function\s+/g, 'async function ')
    .replace(/export\s+function\s+/g, 'function ')
    .replace(/export\s+const\s+/g, 'const ')
    .replace(/export\s+let\s+/g, 'let ')
    .replace(/export\s+\{[\s\S]*?\};?/g, '')
    .replace(/export\s+default\s+[\s\S]*?;?/g, '');
}

function loadFrontendFunctions(relPaths) {
  const domUtilsPath = path.resolve(__dirname, '../../../../public/js/core/dom-utils.js');
  const domUtilsCode = stripEsmSyntax(fs.readFileSync(domUtilsPath, 'utf8'));
  const combined = relPaths
    .map((p) => stripEsmSyntax(fs.readFileSync(path.resolve(__dirname, '../../../../', p), 'utf8')))
    .join('\n;\n');

  const sandbox = {
    document,
    window,
    CSS_CLASSES: {},
    ICONS: {},
    render: () => {},
    raw: (v) => v,
    launchComicReader: jest.fn(),
    fetch: jest.fn(),
    console,
    encodeURIComponent,
  };
  vm.runInNewContext(`${domUtilsCode}\n;\n${combined}`, sandbox);
  return sandbox;
}

describe('[M-1] Story-arc viewer and library XSS escaping', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  test('end-story-arc.js escapes HTML payloads in arcTitle, seriesName, and issueNumber', () => {
    const mod = loadFrontendFunctions(['public/js/viewer/end-story-arc.js']);
    const nav = document.createElement('div');
    document.body.appendChild(nav);

    const payload = '<img src=x onerror=alert(1)>';
    mod.renderStoryArcPrompt(nav, {
      arcTitle: payload,
      nextIssue: {
        isOwned: true,
        comicId: 42,
        seriesName: payload,
        issueNumber: payload,
      },
    });

    const banner = document.getElementById('story-arc-end-prompt');
    expect(banner).not.toBeNull();
    expect(banner.querySelectorAll('img').length).toBe(0);
    expect(banner.innerHTML).toContain('&lt;img src=x onerror=alert(1)&gt;');

    mod.renderStoryArcPrompt(nav, {
      arcTitle: payload,
      nextIssue: {
        isOwned: false,
        seriesName: payload,
        issueNumber: payload,
      },
    });

    expect(banner.querySelectorAll('img').length).toBe(0);
    expect(banner.innerHTML).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  test('story-arcs-collections.js escapes position, releaseYear, and coverImageUrl attributes', () => {
    const mod = loadFrontendFunctions(['public/js/library/story-arcs-collections.js']);
    const modal = document.createElement('div');
    modal.innerHTML = `
      <div id="story-arc-collections-grid-view"></div>
      <div id="story-arc-collections-checklist-view"></div>
    `;
    document.body.appendChild(modal);

    const htmlPayload = '<img src=x onerror=alert(1)>';
    const attrPayload = 'https://example.com/cover.jpg" onerror="alert(1)';
    const collections = [
      {
        title: htmlPayload,
        subtitle: htmlPayload,
        contentsRaw: htmlPayload,
        position: `1${htmlPayload}`,
        releaseYear: `2024${htmlPayload}`,
        coverImageUrl: attrPayload,
        owned: true,
        comicId: 7,
        readStatus: 'unread',
      },
    ];

    mod.renderCollectionsGridView(modal, collections);
    const gridImgs = modal.querySelectorAll('#story-arc-collections-grid-view img');
    expect(gridImgs.length).toBe(1);
    expect(gridImgs[0].getAttribute('onerror')).toBeNull();

    mod.renderCollectionsChecklistView(modal, collections);
    const checklistImgs = modal.querySelectorAll('#story-arc-collections-checklist-view img');
    expect(checklistImgs.length).toBe(0);
    expect(modal.querySelector('#story-arc-collections-checklist-view').innerHTML).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  test('story-arcs-issues.js escapes position, issueNumber, and coverImageUrl attributes', () => {
    const mod = loadFrontendFunctions([
      'public/js/library/story-arcs-collections.js',
      'public/js/library/story-arcs-issues.js',
    ]);
    const modal = document.createElement('div');
    modal.innerHTML = `
      <div id="story-arc-grid-view"></div>
      <table><tbody id="story-arc-checklist-tbody"></tbody></table>
    `;
    document.body.appendChild(modal);

    const htmlPayload = '<img src=x onerror=alert(1)>';
    const attrPayload = 'https://example.com/issue.jpg" onerror="alert(1)';
    const issues = [
      {
        seriesName: htmlPayload,
        issueNumber: `5${htmlPayload}`,
        position: `1${htmlPayload}`,
        publicationDate: `2025${htmlPayload}`,
        storyParts: htmlPayload,
        coverImageUrl: attrPayload,
        owned: true,
        comicId: 9,
        readStatus: 'unread',
      },
    ];

    mod.renderIssuesGridView(modal, issues);
    const gridImgs = modal.querySelectorAll('#story-arc-grid-view img');
    expect(gridImgs.length).toBe(1);
    expect(gridImgs[0].getAttribute('onerror')).toBeNull();
    expect(modal.querySelector('#story-arc-grid-view').innerHTML).toContain('&lt;img src=x onerror=alert(1)&gt;');

    mod.renderIssuesChecklistView(modal, issues);
    const checklistImgs = modal.querySelectorAll('#story-arc-checklist-tbody img');
    expect(checklistImgs.length).toBe(0);
    expect(modal.querySelector('#story-arc-checklist-tbody').innerHTML).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });
});
