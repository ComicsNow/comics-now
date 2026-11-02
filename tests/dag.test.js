/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

describe('Reading List DAG - Layout & State', () => {
  let sandbox;

  function loadClientScript(relPath, customSandbox = sandbox) {
    const fullPath = path.resolve(__dirname, '..', relPath);
    const content = fs.readFileSync(fullPath, 'utf8');
    const cleanContent = content
      .replace(/import\s+[\s\S]*?from\s+['"][^'"]+['"];?/g, '')
      .replace(/export\s+const\s+/g, 'var ')
      .replace(/export\s+let\s+/g, 'var ')
      .replace(/export\s+function\s+/g, 'function ')
      .replace(/export\s+async\s+function\s+/g, 'async function ')
      .replace(/export\s+\{[\s\S]*?\};?/g, '')
      .replace(/export\s+default\s+[\s\S]*?;?/g, '');
    vm.runInContext(cleanContent, customSandbox);
  }

  beforeEach(() => {
    sandbox = {
      window,
      document,
      console,
      state: { API_BASE_URL: 'http://localhost:3000' },
      escapeHtml: str => String(str || '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])),
      getComicById: jest.fn(id => ({ id, name: `Comic ${id}`, series: id === 'c2' ? 'Detective Comics' : 'Batman' })),
      fetch: jest.fn()
    };
    vm.createContext(sandbox);

    loadClientScript('public/js/dag/state.js');
    loadClientScript('public/js/dag/layout.js');
    sandbox.dagState.reset();
  });

  test('dagState initializes with correct default values and resets', () => {
    expect(sandbox.dagState.activeFilterMode).toBe('all');
    expect(sandbox.dagState.graphTransform.scale).toBe(0.85);

    sandbox.dagState.activeFilterMode = 'unread';
    sandbox.dagState.graphTransform.scale = 1.5;
    sandbox.dagState.reset();

    expect(sandbox.dagState.activeFilterMode).toBe('all');
    expect(sandbox.dagState.graphTransform.scale).toBe(0.85);
  });

  test('buildDAGFromDetails constructs nodes, lanes, and edges correctly', () => {
    const details = {
      list: { id: 'list-1', name: 'Batman Epic', description: 'Test List' },
      items: [
        { comicId: 'c1', series: 'Batman', totalPages: 20, lastReadPage: 19 },
        { comicId: 'c2', series: 'Detective Comics', totalPages: 22, lastReadPage: 5 },
        { comicId: 'c3', series: 'Batman', totalPages: 20, lastReadPage: 0 }
      ]
    };

    const dag = sandbox.buildDAGFromDetails(details);
    expect(dag.ok).toBe(true);
    expect(dag.totalIssues).toBe(3);
    expect(dag.readCount).toBe(1);
    expect(dag.inProgressCount).toBe(1);
    expect(dag.nodes.length).toBe(3);

    // Reading order edges (c1 -> c2, c2 -> c3)
    const readingOrderEdges = dag.edges.filter(e => e.type === 'reading-order');
    expect(readingOrderEdges.length).toBe(2);

    // Series track edge (c1 -> c3 because both are Batman and c2 is between them)
    const seriesEdges = dag.edges.filter(e => e.type === 'series-track');
    expect(seriesEdges.length).toBe(1);
    expect(seriesEdges[0].from).toBe('c1');
    expect(seriesEdges[0].to).toBe('c3');
  });

  test('calculateReadingListDAGPositions assigns x and y coordinates', () => {
    const dagData = {
      nodes: [
        { id: 'c1', series: 'Batman' },
        { id: 'c2', series: 'Detective Comics' }
      ],
      seriesLanes: [
        { series: 'Batman', lane: 0, color: '#f59e0b' },
        { series: 'Detective Comics', lane: 1, color: '#3b82f6' }
      ]
    };

    sandbox.calculateReadingListDAGPositions(dagData);
    expect(dagData.nodes[0].x).toBe(0);
    expect(dagData.nodes[0].y).toBe(0); // primary spine
    expect(dagData.nodes[1].x).toBe(280);
    expect(dagData.nodes[1].y).not.toBe(0); // non-zero lane offset
  });

  test('fitDAGToViewport adjusts graphTransform and sets stage transform', () => {
    document.body.innerHTML = `
      <div id="container">
        <div id="rl-dag-viewport" style="width: 800px; height: 500px;">
          <div id="rl-dag-pan-zoom-container"></div>
        </div>
      </div>
    `;
    const container = document.getElementById('container');
    const dagData = {
      nodes: [
        { id: 'c1', x: 0, y: 0, readStatus: 'read' },
        { id: 'c2', x: 280, y: -180, readStatus: 'unread' }
      ]
    };

    sandbox.fitDAGToViewport(container, dagData, true);
    const stage = container.querySelector('#rl-dag-pan-zoom-container');
    expect(stage.style.transform).toContain('scale(0.85)');
  });
});
