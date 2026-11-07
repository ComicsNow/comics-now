/**
 * Comics Now! - Continuity Gap Card Builder
 *
 * Renders a visual dashed placeholder in the series comic grid for missing issues
 * that are part of an active Story Arc / Reading Order.
 */
import {
  state,
  escapeHtml
} from '../../../globals.js';
import { showStoryArcDetail } from '../../story-arcs-detail.js';

const safeEscape = typeof escapeHtml === 'function' ? escapeHtml : (str => String(str || '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])));

export function createContinuityGapCard(gap) {
  const card = document.createElement('div');
  card.className = 'comic-card continuity-gap-card bg-gray-950/80 rounded-lg shadow-lg flex flex-col border border-dashed border-amber-500/50 p-3 justify-between transition-all duration-300 hover:border-amber-400 cursor-pointer';

  card.innerHTML = `
    <div>
      <div class="flex items-center justify-between text-[10px] font-bold text-amber-400 uppercase tracking-wider mb-2">
        <span class="flex items-center gap-1"><span>⚠️</span> <span>Continuity Gap</span></span>
        ${gap.position ? `<span>#${gap.position}</span>` : ''}
      </div>
      <div class="w-full aspect-[13/20] bg-black/60 rounded-md flex flex-col items-center justify-center p-3 text-center border border-amber-500/20">
        <span class="text-2xl text-amber-400/80 mb-1">📖</span>
        <span class="text-xs font-extrabold text-white line-clamp-2">${safeEscape(gap.seriesName || '')}</span>
        <span class="text-sm font-bold text-amber-300 mt-0.5">#${safeEscape(gap.issueNumber || '')}</span>
        <span class="text-[9px] text-gray-400 mt-1 italic">Missing from Library</span>
      </div>
    </div>
    <div class="mt-2 text-center">
      <span class="text-[10px] text-amber-400 font-medium line-clamp-1">${safeEscape(gap.storyParts || gap.storyArc || '')}</span>
      <span class="text-[9px] text-gray-500 block mt-0.5">Click to view in Story Arc</span>
    </div>
  `;

  card.addEventListener('click', () => {
    if (gap.arcId) {
      const fn = state?.showStoryArcDetail || (typeof window !== 'undefined' && window.showStoryArcDetail) || showStoryArcDetail;
      if (typeof fn === 'function') {
        fn(gap.arcId, gap.storyArc, 'grid');
      }
    }
  });

  return card;
}
