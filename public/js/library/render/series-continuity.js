/**
 * Comics Now! - Series Continuity & Story Arcs Strip
 *
 * Renders an inline continuity strip above the series comic issue grid.
 * Displays associated story arcs with direct navigation to the Story Arc Detail / DAG.
 */
import {
  state,
  escapeHtml
} from '../../globals.js';
import { showStoryArcDetail } from '../story-arcs-detail.js';

const safeEscape = typeof escapeHtml === 'function' ? escapeHtml : (str => String(str || '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])));

export async function renderSeriesContinuityStrip(seriesName, publisherName) {
  if (!seriesName || !publisherName) return;

  const targetHost = document.getElementById('series-continuity-container') ||
                     document.getElementById('comic-list-container')?.parentElement;
  if (!targetHost) return;

  let strip = document.getElementById('series-continuity-strip');
  if (!strip) {
    strip = document.createElement('div');
    strip.id = 'series-continuity-strip';
    const container = document.getElementById('comic-list-container');
    if (container && container.parentElement) {
      container.parentElement.insertBefore(strip, container);
    } else {
      targetHost.prepend(strip);
    }
  }

  const baseUrl = state?.API_BASE_URL || (typeof window !== 'undefined' ? window.API_BASE_URL : '') || '';
  try {
    const res = await fetch(`${baseUrl}/api/v1/story-arcs?publisher=${encodeURIComponent(publisherName)}`);
    if (!res.ok) {
      strip.innerHTML = '';
      return;
    }
    const data = await res.json();
    const arcs = (data && data.ok && Array.isArray(data.storyArcs)) ? data.storyArcs : [];

    // Filter arcs relevant to this series
    const sLower = seriesName.toLowerCase().trim();
    const matchingArcs = arcs.filter((arc) => {
      const aLower = (arc.title || '').toLowerCase();
      return aLower.includes(sLower) || sLower.includes(aLower);
    });

    if (matchingArcs.length === 0) {
      strip.innerHTML = '';
      return;
    }

    strip.className = 'w-full mb-4 p-3 bg-gradient-to-r from-amber-950/40 via-gray-900 to-gray-950 rounded-xl border border-amber-500/30 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3';
    strip.innerHTML = `
      <div class="flex items-center gap-2 text-xs font-bold text-amber-300">
        <span>⚡</span>
        <span class="uppercase tracking-wider">Story Arcs in this Series:</span>
      </div>
      <div class="flex items-center gap-2 flex-wrap" id="series-arc-pills-row"></div>
    `;

    const pillsRow = strip.querySelector('#series-arc-pills-row');
    matchingArcs.forEach((arc) => {
      const pill = document.createElement('button');
      pill.type = 'button';
      pill.className = 'series-arc-pill px-3 py-1 rounded-full bg-amber-500/20 hover:bg-amber-500 text-amber-300 hover:text-black font-semibold text-xs border border-amber-400/40 transition-all flex items-center gap-1.5 shadow-xs cursor-pointer';
      pill.innerHTML = `
        <span>⚡</span>
        <span>${safeEscape(arc.title)}</span>
        <span class="text-[10px] opacity-75 font-normal">(${arc.totalIssues} issues)</span>
      `;

      pill.addEventListener('click', () => {
        const fn = state?.showStoryArcDetail || (typeof window !== 'undefined' && window.showStoryArcDetail) || showStoryArcDetail;
        if (typeof fn === 'function') {
          fn(arc.id, arc.title, 'grid');
        }
      });

      pillsRow.appendChild(pill);
    });
  } catch (err) {
    console.warn('[SeriesContinuity] Failed to load continuity strip:', err);
    strip.innerHTML = '';
  }
}
