import { state, actions, seriesAlphaFilter } from '../../globals.js';
import { filterSeriesByActiveFilter } from '../status.js';
import { renderAlphaFilter } from '../alpha-list.js';

const actionsRef = (typeof actions !== 'undefined' && actions?.navigation) ? actions : (typeof globalThis !== 'undefined' ? globalThis.__COMICS_STORE__?.actions : null);

export function isOrderBySeriesDate(order = state.seriesSortOrder) {
  if (!order) return false;
  const o = String(order).toLowerCase();
  return o === 'date' || o === 'date-asc' || o === 'date-desc' || o === 'published-date' || o.includes('date');
}

export function getComicIssueNumber(comic) {
  if (!comic) return null;
  const m = comic.metadata || {};
  const raw = m.Number ?? m.Issue ?? m.IssueNumber ?? m.SortNumber ?? m.AlternateNumber;
  if (raw !== undefined && raw !== null && raw !== '') {
    const parsed = parseFloat(String(raw).replace(/^[^\d.]*/, ''));
    if (!isNaN(parsed)) return parsed;
  }
  const name = comic.name || '';
  const matchHash = name.match(/#(\d+(?:\.\d+)?)/);
  if (matchHash) {
    const parsed = parseFloat(matchHash[1]);
    if (!isNaN(parsed)) return parsed;
  }
  const matchLead = name.match(/^0*(\d+(?:\.\d+)?)\b/);
  if (matchLead) {
    const parsed = parseFloat(matchLead[1]);
    if (!isNaN(parsed)) return parsed;
  }
  return null;
}

export function getComicPublishedDate(comic) {
  if (!comic) return { year: null, month: null, day: null, sortKey: null };
  let m = comic.metadata || {};
  if (typeof m === 'string') {
    try { m = JSON.parse(m); } catch (_) { m = {}; }
  }

  let year = m.Year || m.year || null;
  let month = m.Month || m.month || null;
  let day = m.Day || m.day || null;

  const rawDate = m.CoverDate || m['Cover Date'] || m.StoreDate || m['Store Date'] || m.Date || m.date;

  if (rawDate && (!year || !month || !day)) {
    const str = String(rawDate).trim();
    const isoMatch = str.match(/^(\d{4})(?:-(\d{1,2}))?(?:-(\d{1,2}))?/);
    if (isoMatch) {
      if (!year) year = isoMatch[1];
      if (!month && isoMatch[2]) month = isoMatch[2];
      if (!day && isoMatch[3]) day = isoMatch[3];
    } else {
      const parsed = Date.parse(str);
      if (!isNaN(parsed)) {
        const d = new Date(parsed);
        if (!year) year = d.getUTCFullYear();
        if (!month) month = d.getUTCMonth() + 1;
        if (!day) day = d.getUTCDate();
      } else {
        const yMatch = str.match(/\b(19\d\d|20\d\d)\b/);
        if (yMatch && !year) year = yMatch[1];
      }
    }
  }

  if (!year) {
    const nameStr = (comic.name || '') + ' ' + (comic.displayName || '');
    const nameMatch = nameStr.match(/\b(19\d\d|20\d\d)\b/);
    if (nameMatch) year = nameMatch[1];
  }

  const yNum = year ? parseInt(year, 10) : null;
  const mNum = month ? parseInt(month, 10) : null;
  const dNum = day ? parseInt(day, 10) : null;

  let sortKey = null;
  if (yNum && !isNaN(yNum) && yNum >= 1800 && yNum <= 2100) {
    const safeM = (mNum && !isNaN(mNum) && mNum >= 1 && mNum <= 12) ? mNum : 1;
    const safeD = (dNum && !isNaN(dNum) && dNum >= 1 && dNum <= 31) ? dNum : 1;
    sortKey = yNum * 10000 + safeM * 100 + safeD;
  }

  return {
    year: (yNum && !isNaN(yNum) && yNum >= 1800 && yNum <= 2100) ? String(yNum) : null,
    month: mNum,
    day: dNum,
    sortKey
  };
}

export function getFirstComicInSeries(comicsInSeries) {
  if (!Array.isArray(comicsInSeries) || comicsInSeries.length === 0) return null;
  if (comicsInSeries.length === 1) return comicsInSeries[0];

  const issueOne = comicsInSeries.find(c => {
    const num = getComicIssueNumber(c);
    return num === 1;
  });

  const sorted = [...comicsInSeries].sort((a, b) => {
    const numA = getComicIssueNumber(a);
    const numB = getComicIssueNumber(b);
    if (numA !== null && numB !== null) {
      if (numA !== numB) return numA - numB;
    } else if (numA !== null) {
      return -1;
    } else if (numB !== null) {
      return 1;
    }
    const applyDisplay = state.applyDisplayInfoToComic || window.applyDisplayInfoToComic;
    const aInfo = typeof applyDisplay === 'function' ? applyDisplay(a) : {};
    const bInfo = typeof applyDisplay === 'function' ? applyDisplay(b) : {};
    const aTitle = aInfo.displayTitle || a.name || '';
    const bTitle = bInfo.displayTitle || b.name || '';
    return aTitle.localeCompare(bTitle, undefined, { numeric: true, sensitivity: 'base' });
  });

  return issueOne || sorted[0];
}

export function getSeriesPublishedInfo(comicsInSeries) {
  if (!Array.isArray(comicsInSeries) || comicsInSeries.length === 0) {
    return { firstComic: null, year: null, month: null, day: null, sortKey: null };
  }

  const firstComic = getFirstComicInSeries(comicsInSeries);
  let dateInfo = getComicPublishedDate(firstComic);

  if (!dateInfo.sortKey) {
    for (const c of comicsInSeries) {
      const alt = getComicPublishedDate(c);
      if (alt.sortKey !== null) {
        if (dateInfo.sortKey === null || alt.sortKey < dateInfo.sortKey) {
          dateInfo = alt;
        }
      }
    }
  }

  return {
    firstComic,
    year: dateInfo.year,
    month: dateInfo.month,
    day: dateInfo.day,
    sortKey: dateInfo.sortKey
  };
}

export function initSeriesSortControls() {
  const select = document.getElementById('series-sort-select');
  if (!select) return;

  const pubKey = state.currentPublisher ? `publisher_series_sort_${state.currentPublisher}` : null;
  const saved = (pubKey && typeof localStorage !== 'undefined') ? localStorage.getItem(pubKey) : null;
  const currentOrder = saved || 'name';
  state.seriesSortOrder = currentOrder;
  if (typeof window !== 'undefined') window.seriesSortOrder = currentOrder;

  if (select.querySelector(`option[value="${currentOrder}"]`)) {
    select.value = currentOrder;
  } else if (currentOrder === 'date' && select.querySelector('option[value="date-asc"]')) {
    select.value = 'date-asc';
  } else if (currentOrder === 'date-asc' && select.querySelector('option[value="date"]')) {
    select.value = 'date';
  }

  if (!select._seriesSortWired) {
    select._seriesSortWired = true;
    select.addEventListener('change', (e) => {
      setSeriesSortOrder(e.target.value);
    });
  }
}

export function setSeriesSortOrder(order) {
  if (actionsRef?.navigation?.setSeriesSortOrder) {
    actionsRef.navigation.setSeriesSortOrder(order);
  } else {
    state.seriesSortOrder = order;
  }
  if (typeof window !== 'undefined') {
    window.seriesSortOrder = order;
  }
  if (typeof localStorage !== 'undefined') {
    if (state.currentPublisher) {
      localStorage.setItem(`publisher_series_sort_${state.currentPublisher}`, order);
    }
    localStorage.setItem('publisher_series_sort', order);
  }
  const select = document.getElementById('series-sort-select');
  if (select) {
    if (select.querySelector(`option[value="${order}"]`)) {
      select.value = order;
    } else if (order === 'date' && select.querySelector('option[value="date-asc"]')) {
      select.value = 'date-asc';
    } else if (order === 'date-asc' && select.querySelector('option[value="date"]')) {
      select.value = 'date';
    }
  }

  if (state.currentView === 'series' && state.currentPublisher) {
    const normalizedPath = state.currentRootFolder ? state.currentRootFolder.replace(/[\\\/]+$/, '') : '';
    const rootData = state.library?.[state.currentRootFolder] || state.library?.[normalizedPath] || state.library?.[normalizedPath + '/'];
    const publisherData = rootData?.publishers?.[state.currentPublisher];
    if (publisherData?.series) {
      const filteredSeries = filterSeriesByActiveFilter(publisherData.series);
      const renderCards = (typeof renderSeriesCards === 'function' ? renderSeriesCards : null) ||
        state.renderSeriesCards ||
        (typeof window !== 'undefined' && window.renderSeriesCards) ||
        (typeof globalThis !== 'undefined' && globalThis.renderSeriesCards);
      renderAlphaFilter(seriesAlphaFilter, filteredSeries, renderCards, 'series');
      return;
    }
    const showSeries = state.showSeriesList || window.showSeriesList;
    if (typeof showSeries === 'function') {
      showSeries(state.currentPublisher, { force: true });
    }
  }
}
