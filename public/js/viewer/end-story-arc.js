/**
 * Comics Now! - End of Comic Story Arc Continuity Prompt
 *
 * Checks reading order continuity and renders next-issue or gap prompt.
 */

export async function getNextComicInStoryArc(currentComic) {
  if (!currentComic) return null;
  const series = currentComic.series || currentComic.metadata?.Series || null;
  const issueNum = currentComic.metadata?.Number || currentComic.name?.match(/#?(\d+)/)?.[1] || null;
  if (!series || !issueNum) return null;

  try {
    const baseUrl = typeof window !== 'undefined' && window.getBaseUrl ? window.getBaseUrl() : '';
    const res = await fetch(`${baseUrl}/api/v1/story-arcs/continuity/lookup?series=${encodeURIComponent(series)}&issue=${encodeURIComponent(issueNum)}`);
    if (res.ok) {
      const data = await res.json();
      if (data && data.ok && data.continuity) {
        return data.continuity;
      }
    }
  } catch (e) {
    console.warn('[StoryArcPrompt] Error querying continuity:', e);
  }
  return null;
}

export function renderStoryArcPrompt(nav, arcContinuity, onNavigate) {
  if (!nav) return;
  let arcBanner = document.getElementById('story-arc-end-prompt');

  if (!arcContinuity?.nextIssue) {
    if (arcBanner) arcBanner.classList.add('hidden');
    return;
  }

  const nextIss = arcContinuity.nextIssue;
  const arcTitle = arcContinuity.arcTitle || 'Story Arc';

  if (!arcBanner) {
    arcBanner = document.createElement('div');
    arcBanner.id = 'story-arc-end-prompt';
    arcBanner.className = 'w-full mb-3 p-3 rounded-xl bg-amber-950/80 border border-amber-500/50 text-xs text-amber-200 flex items-center justify-between shadow-lg';
    nav.insertBefore(arcBanner, nav.firstChild);
  }

  arcBanner.classList.remove('hidden');
  if (nextIss.isOwned && nextIss.comicId) {
    arcBanner.innerHTML = `
      <span>⚡ <strong>Up Next in ${arcTitle}:</strong> ${nextIss.seriesName} #${nextIss.issueNumber}</span>
      <button class="px-2.5 py-1 rounded bg-amber-500 hover:bg-amber-400 text-black font-bold text-xs cursor-pointer shadow">Read Now →</button>
    `;
    arcBanner.querySelector('button')?.addEventListener('click', () => {
      if (typeof onNavigate === 'function') onNavigate(nextIss.comicId);
    });
  } else {
    arcBanner.innerHTML = `
      <span>⚠️ <strong>Next in ${arcTitle}:</strong> ${nextIss.seriesName} #${nextIss.issueNumber} <em>(Missing from Library)</em></span>
      <span class="text-amber-400/80 text-[10px]">Continuity Gap</span>
    `;
  }
}
