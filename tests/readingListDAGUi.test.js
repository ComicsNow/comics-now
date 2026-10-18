/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

describe('Reading List DAG UI - Play button and Read Issue button', () => {
  let sandbox;
  let mountContainer;

  beforeEach(() => {
    document.body.innerHTML = `
      <div id="mount-container"></div>
      <div id="reading-list-modal"></div>
    `;
    mountContainer = document.getElementById('mount-container');

    const state = {
      API_BASE_URL: 'http://localhost:3000',
      openComicViewer: jest.fn(),
      closeReadingListModal: jest.fn()
    };

    window.openComicViewer = state.openComicViewer;
    window.closeReadingListModal = state.closeReadingListModal;

    sandbox = {
      window,
      document,
      state,
      console,
      escapeHtml: str => String(str || '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])),
      getComicById: jest.fn(id => ({ id, name: `Comic ${id}`, series: 'Batman' })),
      fetch: jest.fn()
    };
    // Ensure `global` is NOT defined in sandbox to simulate browser environment
    delete sandbox.global;
    vm.createContext(sandbox);

    const fullPath = path.resolve(__dirname, '../public/js/reading-list-dag.js');
    const content = fs.readFileSync(fullPath, 'utf8');
    const cleanContent = content
      .replace(/import\s+[\s\S]*?from\s+['"][^'"]+['"];?/g, '')
      .replace(/export\s+const\s+/g, 'const ')
      .replace(/export\s+let\s+/g, 'let ')
      .replace(/export\s+function\s+/g, 'function ')
      .replace(/export\s+async\s+function\s+/g, 'async function ')
      .replace(/export\s+\{[\s\S]*?\};?/g, '')
      .replace(/export\s+default\s+[\s\S]*?;?/g, '');

    vm.runInContext(cleanContent, sandbox);
  });

  const sampleDagData = {
    ok: true,
    totalIssues: 2,
    readCount: 0,
    nodes: [
      {
        id: 'c-batman-1',
        step: 1,
        sortOrder: 0,
        name: 'Absolute Batman #1',
        series: 'Absolute Batman',
        number: '1',
        publisher: 'DC Comics',
        thumbnailPath: 'thumb-1.jpg',
        readStatus: 'unread',
        progressPercent: 0
      },
      {
        id: 'c-batman-2',
        step: 2,
        sortOrder: 1,
        name: 'Absolute Batman #2',
        series: 'Absolute Batman',
        number: '2',
        publisher: 'DC Comics',
        thumbnailPath: 'thumb-2.jpg',
        readStatus: 'unread',
        progressPercent: 0
      }
    ],
    edges: [
      { id: 'edge-0', from: 'c-batman-1', to: 'c-batman-2', type: 'reading-order' }
    ],
    seriesLanes: [
      { series: 'Absolute Batman', lane: 0, count: 2, color: '#f59e0b' }
    ]
  };

  it('clicking the play button (.rl-dag-quick-read-btn) on a DAG node card launches the comic reader and closes modal without global ReferenceError', () => {
    sandbox.renderReadingListDAG(mountContainer, sampleDagData, { listId: 'rl-1', listName: 'Batman Run' });

    const playBtn = mountContainer.querySelector('.rl-dag-quick-read-btn[data-comic-id="c-batman-1"]');
    expect(playBtn).not.toBeNull();

    // Clicking play button should launch reader and close modal
    expect(() => {
      playBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
    }).not.toThrow();

    expect(sandbox.state.openComicViewer).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'c-batman-1' }),
      { readingListId: 'rl-1', readingListName: 'Batman Run' }
    );
    expect(sandbox.state.closeReadingListModal).toHaveBeenCalled();
  });

  it('clicking the Read Issue button (#rl-inspector-read-btn) in the inspector drawer launches the comic reader and closes modal', () => {
    sandbox.renderReadingListDAG(mountContainer, sampleDagData, { listId: 'rl-1', listName: 'Batman Run' });

    // Click on node to open inspector
    const nodeCard = mountContainer.querySelector('.rl-dag-node[data-node-id="c-batman-1"]');
    expect(nodeCard).not.toBeNull();
    nodeCard.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));

    const readIssueBtn = mountContainer.querySelector('#rl-inspector-read-btn');
    expect(readIssueBtn).not.toBeNull();

    expect(() => {
      readIssueBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
    }).not.toThrow();

    expect(sandbox.state.openComicViewer).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'c-batman-1' }),
      { readingListId: 'rl-1', readingListName: 'Batman Run' }
    );
    expect(sandbox.state.closeReadingListModal).toHaveBeenCalled();
  });
});
