// Standalone Interactive Character & Event Graph Client
// High-Performance Hybrid Canvas/SVG Architecture
// Features: Force Network, Dual-Axis Bridge, Semicircle Horizon,
// Play Publication History Scrubber, Continuity Friction Spotlight, and Interactive Dossier

let simulation;
let svg, g, linkElements, nodeElements, textElements, extraElementsGroup;
let canvas, ctx;
let currentTransform = d3.zoomIdentity;
let currentGraphData = null;
let activeSelectedNode = null;
let zoomBehavior;

// Mode & Feature State
let currentMode = 'network'; // 'network' | 'dual-axis' | 'horizon'
let isFrictionSpotlight = false;
let isPlayingHistory = false;
let playInterval = null;
let currentScrubberYear = null; // null = all time
let globalYearRange = { min: 1958, max: 2026 };

document.addEventListener('DOMContentLoaded', () => {
  initUI();
  loadPublishers();
  loadGraph();
});

function initUI() {
  canvas = document.getElementById('graph-canvas');
  if (canvas) {
    ctx = canvas.getContext('2d');
    resizeCanvas();
  }

  svg = d3.select('#graph-svg');
  g = svg.append('g').attr('class', 'main-scene');
  extraElementsGroup = g.append('g').attr('class', 'extra-guides');

  // D3 Zoom Behavior with native touch pinch-to-zoom
  zoomBehavior = d3.zoom()
    .scaleExtent([0.15, 6])
    .filter((event) => {
      return !event.ctrlKey && !event.button;
    })
    .on('zoom', (event) => {
      currentTransform = event.transform;
      g.attr('transform', event.transform);
      drawCanvas();
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

  // Filters
  document.getElementById('reload-btn').addEventListener('click', loadGraph);
  document.getElementById('entity-type').addEventListener('change', loadGraph);
  document.getElementById('publisher-filter').addEventListener('change', loadGraph);
  document.getElementById('min-appearances').addEventListener('change', loadGraph);

  const densitySelect = document.getElementById('link-density');
  if (densitySelect) {
    densitySelect.addEventListener('change', loadGraph);
  }

  // Mode Tabs
  document.querySelectorAll('.mode-tab[data-mode]').forEach(tab => {
    tab.addEventListener('click', () => {
      const mode = tab.getAttribute('data-mode');
      setGraphMode(mode);
    });
  });

  // Friction Spotlight Toggle
  document.getElementById('friction-spotlight-btn').addEventListener('click', toggleFrictionSpotlight);

  // Publication History Scrubber
  const slider = document.getElementById('scrubber-slider');
  slider.addEventListener('input', (e) => {
    setScrubberYear(parseInt(e.target.value, 10));
  });

  document.getElementById('scrubber-play-btn').addEventListener('click', togglePlayHistory);
  document.getElementById('scrubber-step-back').addEventListener('click', () => stepScrubberYear(-2));
  document.getElementById('scrubber-step-fwd').addEventListener('click', () => stepScrubberYear(2));
  document.getElementById('scrubber-reset-btn').addEventListener('click', resetScrubber);

  // Instant Search with Touch Dismissal
  document.getElementById('search-input').addEventListener('input', (e) => {
    const query = e.target.value.toLowerCase().trim();
    if (!query) {
      clearHighlight();
      applyFilters();
      return;
    }
    if (nodeElements) {
      nodeElements.each(function(d) {
        const match = d.id.toLowerCase().includes(query);
        d3.select(this).classed('highlighted', match);
        d3.select(this).style('opacity', match ? 1 : 0.15);
        if (match) d3.select(this).raise();
      });
    }
  });

  // Dossier Action Buttons
  document.getElementById('dossier-spotlight-btn').addEventListener('click', () => {
    if (activeSelectedNode) {
      focusOnNode(activeSelectedNode);
    }
  });

  document.getElementById('dossier-play-btn').addEventListener('click', () => {
    if (activeSelectedNode && activeSelectedNode.firstYear) {
      setScrubberYear(activeSelectedNode.firstYear);
      if (!isPlayingHistory) togglePlayHistory();
    }
  });

  document.getElementById('dossier-isolate-btn').addEventListener('click', () => {
    if (activeSelectedNode) {
      isolateNodeArc(activeSelectedNode);
    }
  });

  // Mobile Bottom Sheet Dismiss
  document.getElementById('close-sheet').addEventListener('click', () => {
    document.getElementById('bottom-sheet').classList.remove('open');
    clearHighlight();
  });

  // Tap anywhere on canvas background closes bottom sheet
  svg.on('click', (event) => {
    if (event.target.tagName === 'svg' || event.target.id === 'graph-svg') {
      document.getElementById('bottom-sheet').classList.remove('open');
      clearHighlight();
    }
  });

  // Window resize handler
  window.addEventListener('resize', () => {
    resizeCanvas();
    if (currentGraphData) {
      renderGraph(currentGraphData);
    }
  });
}

function resizeCanvas() {
  if (!canvas || !ctx) return;
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.resetTransform();
  ctx.scale(dpr, dpr);
  drawCanvas();
}

function setGraphMode(mode) {
  if (currentMode === mode) return;
  currentMode = mode;

  // Update tabs
  document.querySelectorAll('.mode-tab[data-mode]').forEach(tab => {
    tab.classList.toggle('active', tab.getAttribute('data-mode') === mode);
  });

  if (currentGraphData) {
    renderGraph(currentGraphData);
  }
}

function toggleFrictionSpotlight() {
  isFrictionSpotlight = !isFrictionSpotlight;
  const btn = document.getElementById('friction-spotlight-btn');
  btn.classList.toggle('active', isFrictionSpotlight);

  const banner = document.getElementById('friction-spotlight-banner');
  const svgEl = document.getElementById('graph-svg');

  if (isFrictionSpotlight) {
    svgEl.classList.add('friction-spotlight-active');
    banner.style.display = 'flex';
    const nexusCount = currentGraphData?.nodes?.filter(n => n.frictionScore >= 70).length || 0;
    document.getElementById('friction-banner-count').textContent = `${nexusCount} Multiverse Nexus Points`;
  } else {
    svgEl.classList.remove('friction-spotlight-active');
    banner.style.display = 'none';
  }

  applyFilters();
  drawCanvas();
}

function centerGraph() {
  const width = window.innerWidth;
  const height = window.innerHeight - 130;
  svg.transition().duration(600).call(
    zoomBehavior.transform,
    d3.zoomIdentity.translate(width / 2, height / 2).scale(0.85)
  );
}

function focusOnNode(node) {
  const width = window.innerWidth;
  const height = window.innerHeight - 130;
  const targetX = node.x || 0;
  const targetY = node.y || 0;

  svg.transition().duration(600).call(
    zoomBehavior.transform,
    d3.zoomIdentity.translate(width / 2 - targetX * 1.2, height / 2 - targetY * 1.2).scale(1.2)
  );
}

function isolateNodeArc(node) {
  if (!currentGraphData || !nodeElements) return;

  const connectedIds = new Set([node.id]);
  (currentGraphData.links || []).forEach(l => {
    const sId = typeof l.source === 'object' ? l.source.id : l.source;
    const tId = typeof l.target === 'object' ? l.target.id : l.target;
    if (sId === node.id || tId === node.id) {
      connectedIds.add(sId);
      connectedIds.add(tId);
    }
  });

  nodeElements.each(function(n) {
    const match = connectedIds.has(n.id);
    d3.select(this).style('opacity', match ? 1 : 0.05);
    d3.select(this).classed('highlighted', match);
  });

  drawCanvas();
}

// Scrubber functions
function setScrubberYear(year) {
  currentScrubberYear = year;
  const slider = document.getElementById('scrubber-slider');
  slider.value = year;

  document.getElementById('scrubber-year-display').textContent = year;
  document.getElementById('scrubber-era-display').textContent = getEraLabel(year);

  applyFilters();
  drawCanvas();
}

function stepScrubberYear(delta) {
  const min = globalYearRange.min;
  const max = globalYearRange.max;
  let target = (currentScrubberYear === null ? min : currentScrubberYear) + delta;
  if (target < min) target = min;
  if (target > max) target = max;
  setScrubberYear(target);
}

function resetScrubber() {
  if (isPlayingHistory) togglePlayHistory();
  currentScrubberYear = null;
  document.getElementById('scrubber-slider').value = globalYearRange.max;
  document.getElementById('scrubber-year-display').textContent = 'ALL';
  document.getElementById('scrubber-era-display').textContent = 'Full Continuity';
  applyFilters();
  drawCanvas();
}

function togglePlayHistory() {
  isPlayingHistory = !isPlayingHistory;
  const playBtn = document.getElementById('scrubber-play-btn');

  if (isPlayingHistory) {
    playBtn.textContent = '⏸';
    playBtn.style.background = 'var(--nexus-red)';

    if (currentScrubberYear === null || currentScrubberYear >= globalYearRange.max) {
      setScrubberYear(globalYearRange.min);
    }

    playInterval = setInterval(() => {
      if (currentScrubberYear >= globalYearRange.max) {
        togglePlayHistory();
        return;
      }
      stepScrubberYear(1);
    }, 600);
  } else {
    playBtn.textContent = '▶';
    playBtn.style.background = 'var(--dc-blue)';
    if (playInterval) {
      clearInterval(playInterval);
      playInterval = null;
    }
  }
}

function getEraLabel(year) {
  if (year < 1970) return 'Silver Age';
  if (year < 1985) return 'Bronze Age';
  if (year < 2000) return 'Modern / Crisis Era';
  if (year < 2016) return 'Millennial Era';
  return 'Infinite Frontier / All In';
}

function applyFilters() {
  if (!nodeElements) return;

  const hasYearFilter = currentScrubberYear !== null;

  nodeElements.each(function(d) {
    let visible = true;
    if (hasYearFilter) {
      visible = !d.firstYear || d.firstYear <= currentScrubberYear;
    }

    const el = d3.select(this);
    if (!visible) {
      el.style('opacity', 0.05);
      el.style('pointer-events', 'none');
    } else {
      el.style('pointer-events', 'all');
      if (isFrictionSpotlight) {
        if (d.frictionScore >= 70) {
          el.style('opacity', 1);
        } else if (d.frictionScore >= 40) {
          el.style('opacity', 0.85);
        } else {
          el.style('opacity', 0.25);
        }
      } else {
        el.style('opacity', 1);
      }
    }
  });

  drawCanvas();
}

// Hardware-Accelerated Canvas Link Drawing
function drawCanvas() {
  if (!canvas || !ctx || !currentGraphData) return;
  const rect = canvas.getBoundingClientRect();
  const width = rect.width;
  const height = rect.height;

  ctx.save();
  ctx.clearRect(0, 0, width, height);
  ctx.translate(currentTransform.x, currentTransform.y);
  ctx.scale(currentTransform.k, currentTransform.k);

  const links = currentGraphData.links || [];
  const nodeMap = currentGraphData.nodeMap;
  const hasYearFilter = currentScrubberYear !== null;

  for (let i = 0; i < links.length; i++) {
    const l = links[i];
    if (hasYearFilter && l.firstYear && l.firstYear > currentScrubberYear) continue;

    const src = typeof l.source === 'object' ? l.source : nodeMap?.get(l.source);
    const tgt = typeof l.target === 'object' ? l.target : nodeMap?.get(l.target);
    if (!src || !tgt || src.x == null || tgt.x == null) continue;

    const isConnected = activeSelectedNode && (src.id === activeSelectedNode.id || tgt.id === activeSelectedNode.id);
    const isFriction = l.friction;

    ctx.beginPath();
    ctx.lineWidth = isConnected ? 3.5 : Math.max(1, Math.min(4.5, Math.sqrt(l.weight) * 1.1));

    if (currentMode === 'horizon') {
      const midX = (src.x + tgt.x) / 2;
      const midY = Math.min(src.y, tgt.y) - Math.abs(src.x - tgt.x) * 0.35;
      ctx.moveTo(src.x, src.y);
      ctx.quadraticCurveTo(midX, midY, tgt.x, tgt.y);
    } else {
      ctx.moveTo(src.x, src.y);
      ctx.lineTo(tgt.x, tgt.y);
    }

    if (isConnected) {
      ctx.strokeStyle = '#ffcc00';
    } else if (isFrictionSpotlight) {
      ctx.strokeStyle = isFriction ? 'rgba(239, 68, 68, 0.95)' : 'rgba(148, 163, 184, 0.08)';
    } else {
      ctx.strokeStyle = isFriction ? 'rgba(239, 68, 68, 0.55)' : 'rgba(148, 163, 184, 0.22)';
    }

    ctx.stroke();
  }

  ctx.restore();
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
  const densitySelect = document.getElementById('link-density');
  const maxLinks = densitySelect ? densitySelect.value : '400';

  const isMobile = window.innerWidth < 768;
  const maxNodes = isMobile ? '80' : '150';

  const params = new URLSearchParams({
    entityType,
    minAppearances,
    minWeight: '1',
    maxNodes,
    maxLinks
  });
  if (publisher) params.append('publisher', publisher);

  try {
    const res = await fetch(`/api/graph?${params.toString()}`);
    const data = await res.json();
    if (data.ok) {
      // Map nodes for O(1) link lookup
      data.nodeMap = new Map(data.nodes.map(n => [n.id, n]));
      currentGraphData = data;

      // Update Year Range for Scrubber
      if (data.meta && data.meta.yearRange) {
        globalYearRange = data.meta.yearRange;
        const slider = document.getElementById('scrubber-slider');
        slider.min = globalYearRange.min;
        slider.max = globalYearRange.max;
        if (currentScrubberYear === null) {
          slider.value = globalYearRange.max;
        }
      }

      renderGraph(data);
    }
  } catch (err) {
    console.error('Failed to fetch graph data', err);
  } finally {
    loading.style.display = 'none';
  }
}

function renderGraph(data) {
  if (simulation) simulation.stop();
  g.selectAll('*').remove();
  extraElementsGroup = g.append('g').attr('class', 'extra-guides');

  if (currentMode === 'network') {
    renderNetworkLayout(data);
  } else if (currentMode === 'dual-axis') {
    renderDualAxisLayout(data);
  } else if (currentMode === 'horizon') {
    renderHorizonLayout(data);
  }

  applyFilters();
  drawCanvas();
}

function renderNetworkLayout(data) {
  const width = window.innerWidth;
  const height = window.innerHeight - 130;
  const isMobile = window.innerWidth < 768;

  const colorScale = d3.scaleOrdinal()
    .domain(['DC Comics', 'Marvel', 'Image Comics', 'Dark Horse Comics'])
    .range(['#0078f2', '#e52421', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899']);

  // Create D3 Force Simulation
  simulation = d3.forceSimulation(data.nodes)
    .force('link', d3.forceLink(data.links).id(d => d.id).distance(d => Math.max(70, 110 - d.weight * 2)))
    .force('charge', d3.forceManyBody().strength(isMobile ? -160 : -240))
    .force('center', d3.forceCenter(width / 2, height / 2))
    .force('collision', d3.forceCollide().radius(d => Math.max(16, Math.sqrt(d.appearances) * 3.2) + 8))
    .on('tick', ticked);

  // Simulation Pre-Warming: Pre-compute 80 ticks in memory so initial frame renders stabilized instantly
  for (let i = 0; i < 80; i++) {
    simulation.tick();
  }

  // Nodes (SVG Layer)
  const nodeGroup = g.append('g').attr('class', 'nodes');

  const nodes = nodeGroup.selectAll('.node')
    .data(data.nodes)
    .enter()
    .append('g')
    .attr('class', d => {
      let fClass = 'anchor-node';
      if (d.frictionScore >= 70) fClass = 'nexus-node';
      else if (d.frictionScore >= 40) fClass = 'bridge-node';
      return `node ${fClass}`;
    })
    .attr('transform', d => `translate(${d.x},${d.y})`)
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

  // Invisible larger touch hit-area
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

  svg.call(
    zoomBehavior.transform,
    d3.zoomIdentity.translate(0, 0).scale(isMobile ? 0.75 : 0.9)
  );

  function ticked() {
    nodes.attr('transform', d => `translate(${d.x},${d.y})`);
    drawCanvas();
  }
}

// Dual-Axis Bridge Mode
function renderDualAxisLayout(data) {
  const width = window.innerWidth;
  const height = window.innerHeight - 130;
  const isMobile = window.innerWidth < 768;

  const pubCounts = {};
  data.nodes.forEach(n => {
    (n.publishers || []).forEach(p => {
      pubCounts[p] = (pubCounts[p] || 0) + 1;
    });
  });

  const sortedPubs = Object.keys(pubCounts).sort((a, b) => pubCounts[b] - pubCounts[a]);
  const primaryPub = sortedPubs[0] || 'DC Comics';
  const secondaryPub = sortedPubs[1];

  const leftAxisNodes = [];
  const rightAxisNodes = [];

  let axisALabel = `AXIS A: ${primaryPub.toUpperCase()}`;
  let axisBLabel = `AXIS B: ${secondaryPub ? secondaryPub.toUpperCase() : 'MULTIVERSE NEXUS'}`;

  // If there are multiple distinct imprints with >= 15% representation, split by imprint
  const totalNodes = data.nodes.length;
  const secondaryCount = secondaryPub ? (pubCounts[secondaryPub] || 0) : 0;
  const hasDistinctImprints = secondaryCount / Math.max(1, totalNodes) >= 0.15;

  if (hasDistinctImprints) {
    data.nodes.forEach(n => {
      if (n.publishers && n.publishers.includes(primaryPub)) {
        leftAxisNodes.push(n);
      } else {
        rightAxisNodes.push(n);
      }
    });
  } else {
    // DC Universe Continuity Split: Canon Anchors & Bridges vs Multiverse Nexus Hubs
    axisALabel = 'AXIS A: CANON ANCHORS & BRIDGES';
    axisBLabel = 'AXIS B: MULTIVERSE NEXUS (CRISIS HUBS)';

    data.nodes.forEach(n => {
      if (n.frictionScore >= 70 || n.frictionLevel === 'Multiverse Nexus') {
        rightAxisNodes.push(n);
      } else {
        leftAxisNodes.push(n);
      }
    });

    // If lopsided, balance around median friction score
    if (leftAxisNodes.length < totalNodes * 0.2 || rightAxisNodes.length < totalNodes * 0.2) {
      leftAxisNodes.length = 0;
      rightAxisNodes.length = 0;
      const sortedByScore = [...data.nodes].sort((a, b) => a.frictionScore - b.frictionScore);
      const mid = Math.floor(sortedByScore.length / 2);
      sortedByScore.forEach((n, idx) => {
        if (idx < mid) leftAxisNodes.push(n);
        else rightAxisNodes.push(n);
      });
      axisALabel = 'AXIS A: CANON ANCHORS';
      axisBLabel = 'AXIS B: MULTIVERSE & EVENT BRIDGES';
    }
  }

  leftAxisNodes.sort((a, b) => b.appearances - a.appearances);
  rightAxisNodes.sort((a, b) => b.appearances - a.appearances);

  const leftX = width * (isMobile ? 0.22 : 0.28);
  const rightX = width * (isMobile ? 0.78 : 0.72);
  const startY = 80;
  const availableHeight = Math.max(height - 140, Math.max(leftAxisNodes.length, rightAxisNodes.length) * 38);

  const leftStep = availableHeight / Math.max(1, leftAxisNodes.length);
  const rightStep = availableHeight / Math.max(1, rightAxisNodes.length);

  leftAxisNodes.forEach((n, i) => {
    n.x = leftX;
    n.y = startY + i * leftStep;
    n.axis = 'left';
  });

  rightAxisNodes.forEach((n, i) => {
    n.x = rightX;
    n.y = startY + i * rightStep;
    n.axis = 'right';
  });

  // Guides & Headers
  extraElementsGroup.append('line')
    .attr('class', 'axis-divider')
    .attr('x1', width / 2)
    .attr('y1', 40)
    .attr('x2', width / 2)
    .attr('y2', availableHeight + 100);

  extraElementsGroup.append('text')
    .attr('class', 'axis-label')
    .attr('x', leftX)
    .attr('y', 45)
    .attr('text-anchor', 'middle')
    .text(axisALabel);

  extraElementsGroup.append('text')
    .attr('class', 'axis-label')
    .attr('x', rightX)
    .attr('y', 45)
    .attr('text-anchor', 'middle')
    .text(axisBLabel);

  // Nodes (SVG Layer)
  const nodesG = g.append('g').attr('class', 'nodes');
  const nodes = nodesG.selectAll('.node')
    .data(data.nodes)
    .enter()
    .append('g')
    .attr('class', d => `node ${d.frictionScore >= 70 ? 'nexus-node' : (d.frictionScore >= 40 ? 'bridge-node' : 'anchor-node')}`)
    .attr('transform', d => `translate(${d.x},${d.y})`)
    .on('click', (event, d) => {
      event.stopPropagation();
      selectNode(d);
    });

  nodeElements = nodes;

  nodes.append('circle')
    .attr('r', 22)
    .attr('fill', 'transparent');

  nodes.append('circle')
    .attr('r', d => Math.max(8, Math.min(18, Math.sqrt(d.appearances) * 2.5)))
    .attr('fill', d => d.axis === 'left' ? '#0078f2' : '#e52421');

  textElements = nodes.append('text')
    .attr('dx', d => d.axis === 'left' ? -22 : 22)
    .attr('dy', 4)
    .attr('text-anchor', d => d.axis === 'left' ? 'end' : 'start')
    .text(d => d.label);

  svg.call(
    zoomBehavior.transform,
    d3.zoomIdentity.translate(0, 0).scale(0.85)
  );

  drawCanvas();
}

// Semicircle Horizon Mode
function renderHorizonLayout(data) {
  const width = window.innerWidth;
  const height = window.innerHeight - 130;
  const isMobile = window.innerWidth < 768;

  const cx = width / 2;
  const cy = height * 0.88;
  const radius = Math.min(width * 0.48, height * 0.72);

  const sortedNodes = [...data.nodes].sort((a, b) => {
    const ya = a.firstYear || 2000;
    const yb = b.firstYear || 2000;
    if (ya !== yb) return ya - yb;
    return b.appearances - a.appearances;
  });

  const count = sortedNodes.length;
  sortedNodes.forEach((n, i) => {
    const angle = Math.PI + (i / Math.max(1, count - 1)) * Math.PI;
    n.x = cx + radius * Math.cos(angle);
    n.y = cy + radius * Math.sin(angle);
    n.angle = angle;
  });

  // Horizon Arc Guide & Celestial Star
  extraElementsGroup.append('path')
    .attr('class', 'horizon-arc-guide')
    .attr('d', `M ${cx - radius} ${cy} A ${radius} ${radius} 0 0 1 ${cx + radius} ${cy}`);

  extraElementsGroup.append('circle')
    .attr('class', 'horizon-center-star')
    .attr('cx', cx)
    .attr('cy', cy - radius * 0.5)
    .attr('r', 5);

  extraElementsGroup.append('text')
    .attr('class', 'axis-label')
    .attr('x', cx)
    .attr('y', cy - radius - 20)
    .attr('text-anchor', 'middle')
    .text('HORIZON CONTINUITY DOME');

  // Nodes (SVG Layer)
  const nodesG = g.append('g').attr('class', 'nodes');
  const nodes = nodesG.selectAll('.node')
    .data(sortedNodes)
    .enter()
    .append('g')
    .attr('class', d => `node ${d.frictionScore >= 70 ? 'nexus-node' : (d.frictionScore >= 40 ? 'bridge-node' : 'anchor-node')}`)
    .attr('transform', d => `translate(${d.x},${d.y})`)
    .on('click', (event, d) => {
      event.stopPropagation();
      selectNode(d);
    });

  nodeElements = nodes;

  nodes.append('circle')
    .attr('r', 22)
    .attr('fill', 'transparent');

  nodes.append('circle')
    .attr('r', d => Math.max(7, Math.min(22, Math.sqrt(d.appearances) * 2.8)))
    .attr('fill', d => {
      if (d.frictionScore >= 70) return '#ef4444';
      if (d.frictionScore >= 40) return '#f59e0b';
      return '#0078f2';
    });

  textElements = nodes.append('text')
    .attr('dy', d => {
      return (d.y < cy - radius * 0.6) ? -16 : 18;
    })
    .attr('text-anchor', 'middle')
    .text(d => d.label);

  svg.call(
    zoomBehavior.transform,
    d3.zoomIdentity.translate(0, 0).scale(isMobile ? 0.75 : 0.88)
  );

  drawCanvas();
}

function dragstarted(event, d) {
  if (currentMode !== 'network') return;
  if (!event.active && simulation) simulation.alphaTarget(0.25).restart();
  d.fx = d.x;
  d.fy = d.y;
}

function dragged(event, d) {
  if (currentMode !== 'network') return;
  d.fx = event.x;
  d.fy = event.y;
  drawCanvas();
}

function dragended(event, d) {
  if (currentMode !== 'network') return;
  if (!event.active && simulation) simulation.alphaTarget(0);
  d.fx = null;
  d.fy = null;
  drawCanvas();
}

async function selectNode(node) {
  activeSelectedNode = node;

  const connectedNodeIds = new Set([node.id]);

  (currentGraphData.links || []).forEach(l => {
    const sId = typeof l.source === 'object' ? l.source.id : l.source;
    const tId = typeof l.target === 'object' ? l.target.id : l.target;
    if (sId === node.id || tId === node.id) {
      connectedNodeIds.add(sId);
      connectedNodeIds.add(tId);
    }
  });

  if (nodeElements) {
    nodeElements.each(function(n) {
      const isConn = connectedNodeIds.has(n.id);
      d3.select(this).classed('highlighted', isConn);
      d3.select(this).style('opacity', isConn ? 1 : 0.15);
      if (isConn) d3.select(this).raise();
    });
  }

  drawCanvas();

  // Populate Interactive Dossier
  document.getElementById('sb-name').textContent = node.id;
  document.getElementById('sb-type').textContent = document.getElementById('entity-type').options[document.getElementById('entity-type').selectedIndex].text;

  // Friction Badge
  const fBadge = document.getElementById('sb-friction-badge');
  fBadge.textContent = node.frictionLevel || 'Canon Anchor';
  fBadge.className = 'badge';
  if (node.frictionScore >= 70) {
    fBadge.classList.add('dossier-badge-nexus');
  } else if (node.frictionScore >= 40) {
    fBadge.classList.add('dossier-badge-bridge');
  } else {
    fBadge.classList.add('dossier-badge-anchor');
  }

  // Friction Meter
  const score = node.frictionScore || 10;
  document.getElementById('sb-friction-score').textContent = `${score} / 100`;
  document.getElementById('sb-friction-fill').style.width = `${score}%`;

  const reasonsList = document.getElementById('sb-friction-reasons');
  reasonsList.innerHTML = '';
  (node.frictionReasons || []).forEach(r => {
    const div = document.createElement('div');
    div.className = 'friction-reason-item';
    div.textContent = r;
    reasonsList.appendChild(div);
  });

  // Stats
  document.getElementById('sb-appearances').textContent = node.appearances;
  document.getElementById('sb-series-count').textContent = node.seriesCount || node.series?.length || 0;
  document.getElementById('sb-debut-year').textContent = node.firstYear || 'Unknown';
  document.getElementById('sb-latest-year').textContent = node.lastYear || 'Unknown';

  // Series Timeline
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
      <div style="display: flex; flex-direction: column;">
        <span style="font-weight: 500;">${item.target}</span>
      </div>
      <span class="connected-weight">${item.weight} issues</span>
    `;
    li.addEventListener('click', (e) => {
      e.stopPropagation();
      const targetNode = currentGraphData?.nodes?.find(n => n.id === item.target);
      if (targetNode) {
        selectNode(targetNode);
        focusOnNode(targetNode);
      }
    });
    list.appendChild(li);
  });
}

function clearHighlight() {
  if (nodeElements) {
    nodeElements.classed('highlighted', false);
  }
  drawCanvas();
}
