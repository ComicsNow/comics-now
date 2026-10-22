// Standalone Interactive Character & Event Graph Client
// Mobile & Tablet Optimized with Touch Drag, Pinch-to-Zoom, and Bottom Sheet

let simulation;
let svg, g, linkElements, nodeElements, textElements;
let currentGraphData = null;
let activeSelectedNode = null;
let zoomBehavior;

document.addEventListener('DOMContentLoaded', () => {
  initUI();
  loadPublishers();
  loadGraph();
});

function initUI() {
  svg = d3.select('#graph-svg');
  g = svg.append('g');

  // D3 Zoom Behavior with native touch pinch-to-zoom
  zoomBehavior = d3.zoom()
    .scaleExtent([0.15, 6])
    .filter((event) => {
      // Allow single touch drag on SVG canvas, allow multi-touch pinch
      return !event.ctrlKey && !event.button;
    })
    .on('zoom', (event) => {
      g.attr('transform', event.transform);
    });

  svg.call(zoomBehavior);

  // Floating Action Buttons (FABs)
  document.getElementById('zoom-in-btn').addEventListener('click', () => {
    svg.transition().duration(300).call(zoomBehavior.scaleBy, 1.35);
  });

  document.getElementById('zoom-out-btn').addEventListener('click', () => {
    svg.transition().duration(300).call(zoomBehavior.scaleBy, 0.75);
  });

  document.getElementById('reset-zoom-btn').addEventListener('click', centerGraph);

  document.getElementById('reload-btn').addEventListener('click', loadGraph);
  document.getElementById('entity-type').addEventListener('change', loadGraph);
  document.getElementById('publisher-filter').addEventListener('change', loadGraph);
  document.getElementById('min-appearances').addEventListener('change', loadGraph);

  // Instant Search with Touch Dismissal
  document.getElementById('search-input').addEventListener('input', (e) => {
    const query = e.target.value.toLowerCase().trim();
    if (!query) {
      clearHighlight();
      return;
    }
    nodeElements.each(function(d) {
      const match = d.id.toLowerCase().includes(query);
      d3.select(this).classed('highlighted', match);
      d3.select(this).style('opacity', match ? 1 : 0.2);
      if (match) {
        d3.select(this).raise();
      }
    });
  });

  // Mobile Bottom Sheet Dismiss
  document.getElementById('close-sheet').addEventListener('click', () => {
    document.getElementById('bottom-sheet').classList.remove('open');
    clearHighlight();
  });

  // Tap anywhere on canvas background closes bottom sheet
  svg.on('click', (event) => {
    if (event.target.tagName === 'svg') {
      document.getElementById('bottom-sheet').classList.remove('open');
      clearHighlight();
    }
  });

  // Window resize handler
  window.addEventListener('resize', () => {
    if (simulation && currentGraphData) {
      const width = window.innerWidth;
      const height = window.innerHeight - 90;
      simulation.force('center', d3.forceCenter(width / 2, height / 2));
      simulation.alpha(0.2).restart();
    }
  });
}

function centerGraph() {
  const width = window.innerWidth;
  const height = window.innerHeight - 90;
  svg.transition().duration(600).call(
    zoomBehavior.transform,
    d3.zoomIdentity.translate(width / 2, height / 2).scale(0.8)
  );
}

async function loadPublishers() {
  try {
    const res = await fetch('/api/publishers');
    const data = await res.json();
    if (data.ok && data.publishers) {
      const select = document.getElementById('publisher-filter');
      data.publishers.forEach(pub => {
        const opt = document.createElement('option');
        opt.value = pub;
        opt.textContent = pub;
        select.appendChild(opt);
      });
    }
  } catch (e) {
    console.error('Failed to load publishers', e);
  }
}

async function loadGraph() {
  const loading = document.getElementById('loading');
  loading.style.display = 'flex';
  document.getElementById('bottom-sheet').classList.remove('open');

  const entityType = document.getElementById('entity-type').value;
  const publisher = document.getElementById('publisher-filter').value;
  const minAppearances = document.getElementById('min-appearances').value;

  // Sized conservatively for mobile/tablet GPU performance (max 120 nodes)
  const isMobile = window.innerWidth < 768;
  const maxNodes = isMobile ? '80' : '150';

  const params = new URLSearchParams({
    entityType,
    minAppearances,
    minWeight: '1',
    maxNodes
  });
  if (publisher) params.append('publisher', publisher);

  try {
    const res = await fetch(`/api/graph?${params.toString()}`);
    const data = await res.json();
    if (data.ok) {
      currentGraphData = data;
      renderGraph(data);
    }
  } catch (err) {
    console.error('Failed to fetch graph data', err);
  } finally {
    loading.style.display = 'none';
  }
}

function renderGraph(data) {
  const width = window.innerWidth;
  const height = window.innerHeight - 90;

  if (simulation) simulation.stop();
  g.selectAll('*').remove();

  const colorScale = d3.scaleOrdinal()
    .domain(['DC Comics', 'Marvel', 'Image Comics', 'Dark Horse Comics'])
    .range(['#0078f2', '#e52421', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899']);

  // Links
  linkElements = g.append('g')
    .attr('class', 'links')
    .selectAll('line')
    .data(data.links)
    .enter()
    .append('line')
    .attr('class', 'link')
    .attr('stroke-width', d => Math.max(1.2, Math.min(6, Math.sqrt(d.weight) * 1.1)));

  // Node Container
  const nodeGroup = g.append('g').attr('class', 'nodes');

  const isMobile = window.innerWidth < 768;

  const nodes = nodeGroup.selectAll('.node')
    .data(data.nodes)
    .enter()
    .append('g')
    .attr('class', 'node')
    .call(d3.drag()
      .on('start', dragstarted)
      .on('drag', dragged)
      .on('end', dragended)
    )
    .on('click', (event, d) => {
      event.stopPropagation();
      selectNode(d);
    });

  nodeElements = nodes;

  // Invisible larger touch hit-area for finger accuracy (min 44px)
  nodes.append('circle')
    .attr('r', d => Math.max(22, Math.sqrt(d.appearances) * 3.4))
    .attr('fill', 'transparent')
    .attr('stroke', 'none');

  // Visible Circle
  nodes.append('circle')
    .attr('r', d => Math.max(8, Math.min(isMobile ? 26 : 32, Math.sqrt(d.appearances) * 3)))
    .attr('fill', d => {
      const pub = d.publishers && d.publishers[0];
      return pub ? colorScale(pub) : '#0078f2';
    });

  // Label text
  textElements = nodes.append('text')
    .attr('dy', d => Math.max(8, Math.min(isMobile ? 26 : 32, Math.sqrt(d.appearances) * 3)) + 13)
    .attr('text-anchor', 'middle')
    .text(d => d.label);

  // Force simulation tuned for mobile physics performance
  simulation = d3.forceSimulation(data.nodes)
    .force('link', d3.forceLink(data.links).id(d => d.id).distance(d => Math.max(70, 110 - d.weight * 2)))
    .force('charge', d3.forceManyBody().strength(isMobile ? -180 : -260))
    .force('center', d3.forceCenter(width / 2, height / 2))
    .force('collision', d3.forceCollide().radius(d => Math.max(16, Math.sqrt(d.appearances) * 3.2) + 8))
    .on('tick', ticked);

  // Set initial viewport center
  svg.call(
    zoomBehavior.transform,
    d3.zoomIdentity.translate(0, 0).scale(isMobile ? 0.75 : 0.9)
  );

  function ticked() {
    linkElements
      .attr('x1', d => d.source.x)
      .attr('y1', d => d.source.y)
      .attr('x2', d => d.target.x)
      .attr('y2', d => d.target.y);

    nodes.attr('transform', d => `translate(${d.x},${d.y})`);
  }
}

function dragstarted(event, d) {
  if (!event.active) simulation.alphaTarget(0.25).restart();
  d.fx = d.x;
  d.fy = d.y;
}

function dragged(event, d) {
  d.fx = event.x;
  d.fy = event.y;
}

function dragended(event, d) {
  if (!event.active) simulation.alphaTarget(0);
  d.fx = null;
  d.fy = null;
}

async function selectNode(node) {
  activeSelectedNode = node;

  const connectedNodeIds = new Set();
  connectedNodeIds.add(node.id);

  linkElements.each(function(l) {
    const isConnected = l.source.id === node.id || l.target.id === node.id;
    d3.select(this).classed('highlighted', isConnected);
    if (isConnected) {
      connectedNodeIds.add(l.source.id);
      connectedNodeIds.add(l.target.id);
      d3.select(this).raise();
    }
  });

  nodeElements.each(function(n) {
    const isConn = connectedNodeIds.has(n.id);
    d3.select(this).classed('highlighted', isConn);
    d3.select(this).style('opacity', isConn ? 1 : 0.2);
    if (isConn) d3.select(this).raise();
  });

  linkElements.style('opacity', function(l) {
    return (l.source.id === node.id || l.target.id === node.id) ? 1 : 0.08;
  });

  // Populate Bottom Sheet / Drawer
  document.getElementById('sb-name').textContent = node.id;
  document.getElementById('sb-type').textContent = document.getElementById('entity-type').options[document.getElementById('entity-type').selectedIndex].text;
  document.getElementById('sb-appearances').textContent = node.appearances;
  document.getElementById('sb-series-count').textContent = node.seriesCount || node.series?.length || 0;

  const seriesBox = document.getElementById('sb-series');
  seriesBox.innerHTML = '';
  (node.series || []).forEach(s => {
    const tag = document.createElement('div');
    tag.className = 'series-tag';
    tag.textContent = s;
    seriesBox.appendChild(tag);
  });

  // Fetch Connected Entities
  try {
    const entityType = document.getElementById('entity-type').value;
    const res = await fetch(`/api/entity/${encodeURIComponent(node.id)}/details?entityType=${entityType}`);
    const data = await res.json();
    if (data.ok) {
      renderConnectedList(data.connectedEntities);
    }
  } catch (e) {
    console.error('Failed to fetch entity details', e);
  }

  document.getElementById('bottom-sheet').classList.add('open');
}

function renderConnectedList(connected) {
  const list = document.getElementById('sb-connected');
  list.innerHTML = '';

  if (!connected || connected.length === 0) {
    list.innerHTML = '<li style="color: var(--text-muted); font-size: 12px; padding: 8px;">No co-occurrences found.</li>';
    return;
  }

  connected.slice(0, 25).forEach(item => {
    const li = document.createElement('li');
    li.className = 'connected-item';
    li.innerHTML = `
      <span style="font-weight: 500;">${item.target}</span>
      <span class="connected-weight">${item.weight} issues</span>
    `;
    li.addEventListener('click', (e) => {
      e.stopPropagation();
      const targetNode = currentGraphData.nodes.find(n => n.id === item.target);
      if (targetNode) {
        selectNode(targetNode);
        // Center view on this target node smoothly
        const width = window.innerWidth;
        const height = window.innerHeight - 90;
        svg.transition().duration(500).call(
          zoomBehavior.transform,
          d3.zoomIdentity.translate(width / 2 - targetNode.x * 0.9, height / 2 - targetNode.y * 0.9).scale(0.9)
        );
      }
    });
    list.appendChild(li);
  });
}

function clearHighlight() {
  if (nodeElements) {
    nodeElements.classed('highlighted', false).style('opacity', 1);
  }
  if (linkElements) {
    linkElements.classed('highlighted', false).style('opacity', 0.6);
  }
}
