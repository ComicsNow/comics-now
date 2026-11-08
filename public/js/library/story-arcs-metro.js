/**
 * Comics Now! - Story Arc Continuity Metro & Proportional Progression Visualizer
 *
 * Renders an interactive sequential metro line and proportional page-share bar
 * synchronized with an active station continuity inspector card.
 */
import { escapeHtml } from '../globals.js';
import { getReadStatusBadge } from './story-arcs-collections.js';

const SEGMENT_COLORS = [
  '#475569', // Slate
  '#6b6b80', // Purple Slate
  '#4a6378', // Steel
  '#52525b', // Zinc
  '#2563eb', // Cobalt
  '#059669', // Emerald
  '#d97706', // Amber
  '#dc2626'  // Crimson
];

let activeMetroIndex = 0;

export function renderStoryArcMetroView(container, items, format = 'issues', onComicSelect = null) {
  if (!container) return;
  container.innerHTML = '';

  if (!items || items.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'py-16 text-center text-gray-500 text-sm font-semibold';
    empty.textContent = `No items found for this story arc in ${format === 'collections' ? 'collected volumes' : 'single issues'} mode.`;
    container.appendChild(empty);
    return;
  }

  // Ensure activeMetroIndex is within bounds
  if (activeMetroIndex >= items.length) {
    activeMetroIndex = Math.max(0, items.length - 1);
  }

  // Pre-calculate page counts and total pages
  const normalizedItems = items.map((item, idx) => {
    const isOwned = Boolean(item.owned !== undefined ? item.owned : item.isOwned);
    const pages = Number(item.pageCount) > 0 ? Number(item.pageCount) : (format === 'issues' ? 32 : 160);
    const readStatus = item.readStatus || (isOwned ? (item.lastReadPage > 0 ? 'reading' : 'unread') : 'missing');
    return {
      ...item,
      rawItem: item,
      normalizedIndex: idx,
      isOwned,
      pages,
      readStatus
    };
  });

  const totalPages = normalizedItems.reduce((acc, curr) => acc + curr.pages, 0) || 1;

  // Make container focusable for keyboard navigation
  container.tabIndex = 0;
  container.className = 'story-arc-metro-wrapper flex flex-col gap-5 w-full outline-none focus:ring-1 focus:ring-amber-500/30 rounded-xl p-1';

  // 1. Inspector Card
  const inspectorCard = createInspectorCard(normalizedItems, totalPages, format, onComicSelect);
  container.appendChild(inspectorCard);

  // 2. Sequential Metro Line Container
  const metroSection = document.createElement('div');
  metroSection.className = 'flex flex-col gap-2';

  const metroHeader = document.createElement('div');
  metroHeader.className = 'text-[11px] font-extrabold uppercase tracking-wider text-amber-400 flex flex-col sm:flex-row sm:items-center justify-between gap-1 px-1';
  metroHeader.innerHTML = `
    <span>1. Sequential Continuity Metro Line</span>
    <span class="text-gray-500 text-[10px] font-normal lowercase tracking-normal">← scroll horizontally / use arrow keys →</span>
  `;
  metroSection.appendChild(metroHeader);

  const metroLineScroller = document.createElement('div');
  metroLineScroller.id = 'story-arc-metro-line';
  metroLineScroller.className = 'metro-container relative flex items-center gap-3 overflow-x-auto py-5 px-3 bg-gray-900/60 rounded-xl border border-gray-800 scroll-smooth';
  metroLineScroller.setAttribute('role', 'list');
  metroSection.appendChild(metroLineScroller);
  container.appendChild(metroSection);

  // 3. Proportional Page-Count Bar Container
  const propSection = document.createElement('div');
  propSection.className = 'flex flex-col gap-2';

  const propHeader = document.createElement('div');
  propHeader.className = 'text-[11px] font-extrabold uppercase tracking-wider text-amber-400 flex flex-col sm:flex-row sm:items-center justify-between gap-1 px-1';
  propHeader.innerHTML = `
    <span>2. Proportional ${format === 'collections' ? 'Volume Page Share' : 'Storyline Issue Weight'}</span>
    <span class="text-gray-400 font-mono text-[10px] tracking-normal">${totalPages.toLocaleString()} total pages</span>
  `;
  propSection.appendChild(propHeader);

  const propBar = document.createElement('div');
  propBar.id = 'story-arc-metro-prop-bar';
  propBar.className = 'prop-bar flex items-center gap-1 w-full h-11 bg-gray-900/80 p-1 rounded-xl border border-gray-800 overflow-hidden';
  propSection.appendChild(propBar);
  container.appendChild(propSection);

  // State sync function across all 3 visualizer panes
  function updateSync(newIndex) {
    if (newIndex < 0 || newIndex >= normalizedItems.length) return;
    activeMetroIndex = newIndex;

    // A. Update Inspector Card
    updateInspectorContent(inspectorCard, normalizedItems[activeMetroIndex], normalizedItems.length, totalPages, format, onComicSelect);

    // B. Update Metro Nodes
    const nodes = metroLineScroller.querySelectorAll('.metro-node');
    nodes.forEach((n, idx) => {
      if (idx === activeMetroIndex) {
        n.classList.add('active', 'border-amber-400', 'bg-gray-800', 'scale-[1.03]');
        n.classList.remove('border-transparent', 'bg-gray-900/90');
        n.setAttribute('aria-selected', 'true');
        if (typeof n.scrollIntoView === 'function') {
          n.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
        }
      } else {
        n.classList.remove('active', 'border-amber-400', 'bg-gray-800', 'scale-[1.03]');
        n.classList.add('border-transparent', 'bg-gray-900/90');
        n.setAttribute('aria-selected', 'false');
      }
    });

    // C. Update Proportional Segments
    const segments = propBar.querySelectorAll('.prop-segment');
    segments.forEach((seg, idx) => {
      if (idx === activeMetroIndex) {
        seg.classList.add('active', 'ring-2', 'ring-amber-400', 'scale-y-105');
        seg.style.filter = 'brightness(1.25)';
      } else {
        seg.classList.remove('active', 'ring-2', 'ring-amber-400', 'scale-y-105');
        seg.style.filter = 'brightness(1)';
      }
    });
  }

  // Populate Metro Nodes
  normalizedItems.forEach((item, idx) => {
    const node = createMetroNode(item, idx, () => updateSync(idx));
    metroLineScroller.appendChild(node);
  });

  // Populate Proportional Segments
  normalizedItems.forEach((item, idx) => {
    const seg = createPropSegment(item, idx, totalPages, () => updateSync(idx));
    propBar.appendChild(seg);
  });

  // Setup Keyboard Navigation
  container.onkeydown = (e) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      if (activeMetroIndex < normalizedItems.length - 1) {
        updateSync(activeMetroIndex + 1);
      }
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (activeMetroIndex > 0) {
        updateSync(activeMetroIndex - 1);
      }
    }
  };

  // Wire Prev/Next buttons on inspector
  const prevBtn = inspectorCard.querySelector('#metro-inspector-prev-btn');
  const nextBtn = inspectorCard.querySelector('#metro-inspector-next-btn');
  if (prevBtn) {
    prevBtn.onclick = () => {
      if (activeMetroIndex > 0) updateSync(activeMetroIndex - 1);
    };
  }
  if (nextBtn) {
    nextBtn.onclick = () => {
      if (activeMetroIndex < normalizedItems.length - 1) updateSync(activeMetroIndex + 1);
    };
  }

  // Initial Sync
  updateSync(activeMetroIndex);
}

function createInspectorCard(items, totalPages, format, onComicSelect) {
  const card = document.createElement('div');
  card.id = 'story-arc-metro-inspector';
  card.className = 'relative bg-gradient-to-br from-gray-900 via-gray-900/95 to-gray-950 border border-amber-500/40 rounded-2xl p-4 sm:p-5 shadow-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 overflow-hidden w-full';

  card.innerHTML = `
    <div class="flex items-center gap-4 min-w-0 w-full flex-1 overflow-hidden">
      <div id="metro-inspector-cover-container" class="relative w-14 sm:w-16 aspect-[13/20] bg-black rounded-lg overflow-hidden border border-amber-500/30 shrink-0 shadow-md">
        <img id="metro-inspector-cover" src="" alt="Cover" class="w-full h-full object-cover hidden">
        <div id="metro-inspector-placeholder" class="w-full h-full flex items-center justify-center text-amber-400 font-extrabold text-sm">#1</div>
      </div>
      <div class="min-w-0 flex-1 overflow-hidden">
        <div class="flex items-center gap-2 flex-wrap mb-1 text-[11px] font-bold">
          <span id="metro-inspector-meta" class="px-2 py-0.5 rounded bg-amber-500 text-black font-extrabold uppercase shrink-0">Volume 1 of 1</span>
          <span id="metro-inspector-status" class="shrink-0"></span>
        </div>
        <h3 id="metro-inspector-title" class="text-base sm:text-xl font-extrabold text-white truncate w-full">Title</h3>
        <p id="metro-inspector-subtitle" class="text-xs text-gray-400 line-clamp-2 break-words mt-0.5 w-full"></p>
      </div>
    </div>

    <div class="flex items-center gap-4 sm:gap-6 w-full sm:w-auto justify-between sm:justify-end border-t sm:border-t-0 border-gray-800 pt-3 sm:pt-0 shrink-0">
      <div class="flex items-center gap-5 text-center">
        <div>
          <div id="metro-inspector-pages" class="text-lg sm:text-2xl font-black text-white font-mono">0</div>
          <div class="text-[10px] uppercase font-bold text-gray-400 tracking-wider">Pages</div>
        </div>
        <div class="w-px h-8 bg-gray-800"></div>
        <div>
          <div id="metro-inspector-percent" class="text-lg sm:text-2xl font-black text-amber-400 font-mono">0%</div>
          <div class="text-[10px] uppercase font-bold text-gray-400 tracking-wider">Storyline Share</div>
        </div>
      </div>

      <div class="flex items-center gap-2">
        <button id="metro-inspector-prev-btn" class="p-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white transition-colors cursor-pointer" title="Previous Station">
          ‹
        </button>
        <button id="metro-inspector-next-btn" class="p-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white transition-colors cursor-pointer" title="Next Station">
          ›
        </button>
        <div id="metro-inspector-cta-slot"></div>
      </div>
    </div>
  `;

  return card;
}

function updateInspectorContent(card, item, totalCount, totalPages, format, onComicSelect) {
  if (!card || !item) return;

  const metaEl = card.querySelector('#metro-inspector-meta');
  const titleEl = card.querySelector('#metro-inspector-title');
  const subEl = card.querySelector('#metro-inspector-subtitle');
  const statusEl = card.querySelector('#metro-inspector-status');
  const pagesEl = card.querySelector('#metro-inspector-pages');
  const pctEl = card.querySelector('#metro-inspector-percent');
  const coverImg = card.querySelector('#metro-inspector-cover');
  const placeholder = card.querySelector('#metro-inspector-placeholder');
  const ctaSlot = card.querySelector('#metro-inspector-cta-slot');

  const isCol = format === 'collections';
  const displayTitle = isCol ? (item.title || 'Volume') : `${item.seriesName || 'Series'} #${item.issueNumber || item.position}`;
  const displaySubtitle = isCol ? (item.subtitle || item.contentsRaw || '') : (item.storyParts || item.publicationDate || '');
  const pct = ((item.pages / totalPages) * 100).toFixed(1);

  if (metaEl) {
    metaEl.textContent = `${isCol ? 'Volume' : 'Issue'} ${item.position || (item.normalizedIndex + 1)} of ${totalCount}`;
  }
  if (titleEl) titleEl.textContent = displayTitle;
  if (subEl) subEl.textContent = displaySubtitle;
  if (pagesEl) pagesEl.textContent = item.pages.toString();
  if (pctEl) pctEl.textContent = `${pct}%`;

  // Cover image
  if (coverImg && placeholder) {
    if (item.coverImageUrl) {
      coverImg.src = item.coverImageUrl;
      coverImg.classList.remove('hidden');
      placeholder.classList.add('hidden');
    } else {
      coverImg.classList.add('hidden');
      placeholder.classList.remove('hidden');
      placeholder.textContent = `#${item.position || (item.normalizedIndex + 1)}`;
    }
  }

  // Status badge
  if (statusEl) {
    statusEl.innerHTML = getReadStatusBadge(item.readStatus, item.lastReadPage, item.pageCount);
  }

  // CTA button
  if (ctaSlot) {
    ctaSlot.innerHTML = '';
    if (item.isOwned) {
      const readBtn = document.createElement('button');
      readBtn.id = 'metro-inspector-read-btn';
      readBtn.className = 'px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-black font-extrabold text-xs shadow-md transition-all flex items-center gap-1.5 cursor-pointer';
      readBtn.innerHTML = `<span>▷</span> <span>Read ${isCol ? 'Volume' : 'Issue'}</span>`;
      readBtn.onclick = () => {
        if (typeof onComicSelect === 'function') onComicSelect(item.rawItem || item);
      };
      ctaSlot.appendChild(readBtn);
    } else {
      const missingTag = document.createElement('span');
      missingTag.className = 'px-2.5 py-1 rounded-lg bg-gray-800 text-gray-500 text-xs font-bold border border-gray-700/60';
      missingTag.textContent = 'Missing';
      ctaSlot.appendChild(missingTag);
    }
  }
}

function createMetroNode(item, idx, onClick) {
  const node = document.createElement('div');
  node.className = 'metro-node flex-shrink-0 flex flex-col items-center p-3 rounded-xl border border-transparent transition-all duration-200 cursor-pointer min-w-[124px] max-w-[140px] text-center select-none bg-gray-900/90 hover:bg-gray-800 overflow-hidden';
  node.onclick = onClick;

  // Station bullet styling
  let bulletBg = 'bg-gray-700 text-gray-300';
  let bulletBorder = 'border-gray-600';
  if (item.readStatus === 'read') {
    bulletBg = 'bg-emerald-500 text-black';
    bulletBorder = 'border-emerald-300 shadow-emerald-500/30';
  } else if (item.readStatus === 'reading') {
    bulletBg = 'bg-sky-500 text-black';
    bulletBorder = 'border-sky-300 shadow-sky-500/30';
  } else if (item.isOwned) {
    bulletBg = 'bg-amber-500 text-black';
    bulletBorder = 'border-amber-300 shadow-amber-500/30';
  }

  const title = item.title || item.seriesName || `Part ${idx + 1}`;
  const sub = item.subtitle || (item.issueNumber ? `#${item.issueNumber}` : `${item.pages} pp`);

  node.innerHTML = `
    <div class="node-circle relative w-8 h-8 rounded-full border-2 ${bulletBorder} ${bulletBg} flex items-center justify-center font-black text-xs shadow-md mb-2">
      ${item.position || (idx + 1)}
    </div>
    <div class="node-title text-xs font-bold text-white truncate w-full" title="${escapeHtml(title)}">
      ${escapeHtml(title)}
    </div>
    <div class="node-subtitle text-[10px] text-gray-400 font-mono truncate w-full mt-0.5">
      ${escapeHtml(sub)}
    </div>
  `;

  return node;
}

function createPropSegment(item, idx, totalPages, onClick) {
  const pct = (item.pages / totalPages) * 100;
  const seg = document.createElement('div');
  seg.className = 'prop-segment h-full rounded-lg flex items-center justify-center text-[10px] font-black text-white/80 cursor-pointer transition-all duration-200 overflow-hidden min-w-[28px]';
  seg.style.width = `${pct}%`;
  seg.style.backgroundColor = SEGMENT_COLORS[idx % SEGMENT_COLORS.length];
  seg.textContent = `${Math.round(pct)}%`;
  seg.title = `${item.title || item.seriesName} (${item.pages} pages, ${pct.toFixed(1)}%)`;
  seg.onclick = onClick;
  return seg;
}

if (typeof window !== 'undefined') {
  window.renderStoryArcMetroView = renderStoryArcMetroView;
}
