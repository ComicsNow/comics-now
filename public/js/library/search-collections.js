import { state, clearElement } from '../globals.js';
import { createReadingListCard } from './render/reading-lists.js';
import { createStoryArcCard } from './render/story-arcs.js';

const clearContainer = typeof clearElement === 'function'
  ? clearElement
  : (el) => { if (el) { if (typeof el.replaceChildren === 'function') el.replaceChildren(); else el.innerHTML = ''; } };

export function filterReadingListsByQuery(lists, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q || !Array.isArray(lists)) return [];
  return lists.filter((list) => {
    const name = String(list?.name || '').toLowerCase();
    const desc = String(list?.description || '').toLowerCase();
    const pubs = Array.isArray(list?.publishers) ? list.publishers.join(' ').toLowerCase() : '';
    return name.includes(q) || desc.includes(q) || pubs.includes(q);
  });
}

export function filterStoryArcsByQuery(arcs, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q || !Array.isArray(arcs)) return [];
  const seen = new Set();
  return arcs.filter((arc) => {
    const id = String(arc?.id || '');
    if (id.endsWith('__collections')) return false;
    const dedupKey = String(arc?.arcId || id || arc?.title || '').toLowerCase();
    if (!dedupKey || seen.has(dedupKey)) return false;
    const title = String(arc?.title || '').toLowerCase();
    const desc = String(arc?.description || '').toLowerCase();
    const pub = String(arc?.publisher || '').toLowerCase();
    if (!title.includes(q) && !desc.includes(q) && !pub.includes(q)) return false;
    seen.add(dedupKey);
    return true;
  });
}

export async function fetchMatchingReadingLists(query, baseUrl = '') {
  try {
    const res = await fetch(`${baseUrl}/api/v1/reading-lists`);
    if (!res.ok) return [];
    const lists = await res.json();
    if (state) state.cachedReadingLists = Array.isArray(lists) ? lists : [];
    return filterReadingListsByQuery(lists, query);
  } catch (err) {
    console.warn('[search] Failed to fetch reading lists:', err);
    return [];
  }
}

export async function fetchMatchingStoryArcs(query, baseUrl = '') {
  try {
    const res = await fetch(`${baseUrl}/api/v1/story-arcs`);
    if (!res.ok) return [];
    const data = await res.json();
    const arcs = (data && data.ok && Array.isArray(data.storyArcs)) ? data.storyArcs : [];
    if (state) state.cachedStoryArcs = arcs;
    return filterStoryArcsByQuery(arcs, query);
  } catch (err) {
    console.warn('[search] Failed to fetch story arcs:', err);
    return [];
  }
}

function appendCollectionSection(container, headingText, headingClass, cards) {
  const section = document.createElement('div');
  section.className = 'col-span-full space-y-3';

  const heading = document.createElement('h3');
  heading.className = `text-sm font-bold uppercase tracking-wider ${headingClass}`;
  heading.textContent = headingText;
  section.appendChild(heading);

  const grid = document.createElement('div');
  grid.className = 'grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4';
  cards.forEach((card) => grid.appendChild(card));
  section.appendChild(grid);

  container.appendChild(section);
}

export function renderCollectionSearchResults(container, { readingLists = [], storyArcs = [], comics = [], renderComicsFn }) {
  if (!container) return;
  clearContainer(container);

  const makeReadingListCard = state?.createReadingListCard || (typeof window !== 'undefined' && window.createReadingListCard) || createReadingListCard;
  const makeStoryArcCard = state?.createStoryArcCard || (typeof window !== 'undefined' && window.createStoryArcCard) || createStoryArcCard;
  const showHeadings = [readingLists.length > 0, storyArcs.length > 0, comics.length > 0].filter(Boolean).length > 1;

  if (readingLists.length > 0) {
    const cards = readingLists.map((list) => makeReadingListCard(list));
    appendCollectionSection(
      container,
      showHeadings ? `Reading Lists (${readingLists.length})` : `Reading Lists (${readingLists.length})`,
      'text-purple-300',
      cards
    );
  }

  if (storyArcs.length > 0) {
    const cards = storyArcs.map((arc) => makeStoryArcCard(arc, arc.publisher || ''));
    appendCollectionSection(
      container,
      `Story Arcs (${storyArcs.length})`,
      'text-amber-300',
      cards
    );
  }

  if (comics.length > 0 && typeof renderComicsFn === 'function') {
    const comicsSection = document.createElement('div');
    comicsSection.className = 'col-span-full space-y-3';
    if (showHeadings) {
      const heading = document.createElement('h3');
      heading.className = 'text-sm font-bold uppercase tracking-wider text-gray-300';
      heading.textContent = `Comics (${comics.length})`;
      comicsSection.appendChild(heading);
    }
    const comicsGrid = document.createElement('div');
    comicsGrid.className = 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-6';
    comicsSection.appendChild(comicsGrid);
    container.appendChild(comicsSection);
    renderComicsFn(comics, comicsGrid);
  }
}
