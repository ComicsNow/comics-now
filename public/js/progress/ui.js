import { state, ICONS } from '../globals.js';
import { raw, render } from '../ui/template.js';
import { updateOfflineProgressForComic, updateOfflineProgressForSeries } from './db.js';
import { updateLazyLoadingCounts } from './library-sync.js';

const renderContent = (typeof render === 'function' && render.length >= 2) ? render : (el, content) => {
  if (!el) return;
  const toStr = (c) => {
    if (c === null || c === undefined) return '';
    if (Array.isArray(c)) return c.map(toStr).join('');
    if (typeof c === 'object' && typeof c.toHTML === 'function') return c.toHTML();
    if (typeof c === 'object' && c.__isRawHtml) return c.html;
    return String(c);
  };
  el.innerHTML = toStr(content);
};

const safeRaw = (typeof raw !== 'undefined' && typeof raw === 'function' && raw.length > 0) ? raw : (v) => ({ __isRawHtml: true, html: String(v ?? '') });

function callUpdateLibraryReadStatus(payload) {
  const fn = state?.updateLibraryReadStatus || (typeof window !== 'undefined' ? window.updateLibraryReadStatus : null);
  if (typeof fn === 'function') fn(payload);
}

function callApplyFilterAndRender() {
  const fn = state?.applyFilterAndRender || (typeof window !== 'undefined' ? window.applyFilterAndRender : null);
  if (typeof fn === 'function') fn();
}

function callScheduleOfflineProgressSync(immediate = false) {
  const fn = state?.scheduleOfflineProgressSync || (typeof window !== 'undefined' ? window.scheduleOfflineProgressSync : null);
  if (typeof fn === 'function') fn(immediate);
}

async function callSaveLibraryCacheToDB(libraryData) {
  const fn = state?.saveLibraryCacheToDB || (typeof window !== 'undefined' ? window.saveLibraryCacheToDB : null);
  if (typeof fn === 'function') return await fn(libraryData);
}

async function callSaveStatusToDB(statusItem) {
  const fn = state?.saveStatusToDB || (typeof window !== 'undefined' ? window.saveStatusToDB : null);
  if (typeof fn === 'function') return await fn(statusItem);
}

// Helper function to update card banner optimistically
export function updateCardBanner(comicId, newStatus) {
  if (typeof document === 'undefined') return;
  const cards = document.querySelectorAll('.comic-card');
  cards.forEach(card => {
    const cardButton = card.querySelector(`[data-comic-id="${comicId}"]`);
    if (!cardButton) return;

    const imageContainer = card.querySelector('.relative');
    if (!imageContainer) return;

    const oldBanner = imageContainer.querySelector('.status-banner');

    if (oldBanner) {
      oldBanner.classList.add('fade-out');
      setTimeout(() => oldBanner.remove(), 300);
    }

    if (newStatus === 'read') {
      setTimeout(() => {
        const newBanner = document.createElement('div');
        newBanner.className = 'status-banner status-read';
        newBanner.textContent = 'Read';
        newBanner.style.opacity = '0';
        imageContainer.insertBefore(newBanner, imageContainer.firstChild);
        setTimeout(() => { newBanner.style.opacity = '1'; }, 10);
      }, 300);
    }
  });
}

// Helper function to update series card banner optimistically
export function updateSeriesBanner(seriesName, newStatus) {
  if (typeof document === 'undefined') return;
  const cards = document.querySelectorAll('.series-card');
  cards.forEach(card => {
    const cardButton = card.querySelector(`[data-series-name="${seriesName}"]`);
    if (!cardButton) return;

    const imageContainer = card.querySelector('.relative');
    if (!imageContainer) return;

    const oldBanner = imageContainer.querySelector('.status-banner');

    if (oldBanner) {
      oldBanner.classList.add('fade-out');
      setTimeout(() => oldBanner.remove(), 300);
    }

    if (newStatus === 'read') {
      setTimeout(() => {
        const newBanner = document.createElement('div');
        newBanner.className = 'status-banner status-read';
        newBanner.textContent = 'Read';
        newBanner.style.opacity = '0';
        imageContainer.insertBefore(newBanner, imageContainer.firstChild);
        setTimeout(() => { newBanner.style.opacity = '1'; }, 10);
      }, 300);
    }
  });
}

// Toggle read/unread status for a comic or entire series
export async function toggleReadStatus(button) {
  const comicId = button.dataset.comicId;
  const seriesName = button.dataset.seriesName;
  const rootFolder = button.dataset.rootFolder;
  const publisher = button.dataset.publisher;
  const currentStatus = button.dataset.currentStatus;

  let newStatus;
  if (comicId && !seriesName) {
    newStatus = currentStatus === 'read' ? 'unread' : 'read';
  } else {
    newStatus = currentStatus === 'read' ? 'unread' : 'read';
  }

  const originalIcon = button.innerHTML;
  const originalColor = button.className;

  button.classList.add('loading');
  button.disabled = true;

  const iconRead = ICONS?.READ || 'read';
  const iconUnread = ICONS?.UNREAD || 'unread';

  renderContent(button, safeRaw(newStatus === 'read' ? iconRead : iconUnread));
  button.dataset.currentStatus = newStatus;
  if (newStatus === 'read') {
    button.classList.add('text-green-400');
    button.classList.remove('text-gray-400');
  } else {
    button.classList.add('text-gray-400');
    button.classList.remove('text-green-400');
  }

  try {
    const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
    if (!isOnline) throw new Error('Offline');

    let response;
    const baseUrl = state?.API_BASE_URL || '';
    if (seriesName) {
      response = await fetch(`${baseUrl}/api/v1/series/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rootFolder, publisher, series: seriesName, status: newStatus })
      });
    } else {
      response = await fetch(`${baseUrl}/api/v1/comics/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comicId, status: newStatus })
      });
    }

    if (!response.ok) throw new Error('Failed to update status');

    if (seriesName && !comicId) {
      await updateOfflineProgressForSeries(rootFolder, publisher, seriesName, newStatus);
    } else if (comicId) {
      await updateOfflineProgressForComic(comicId, newStatus);
    }

    callUpdateLibraryReadStatus({
      rootFolder,
      publisher,
      seriesName,
      comicId,
      status: newStatus,
    });

    updateLazyLoadingCounts(rootFolder, publisher, seriesName, currentStatus, newStatus);
    callApplyFilterAndRender();

    requestAnimationFrame(() => {
      if (comicId && !seriesName) {
        updateCardBanner(comicId, newStatus);
      } else if (seriesName) {
        updateSeriesBanner(seriesName, newStatus);
      }
    });

    callScheduleOfflineProgressSync(true);

    if (typeof state?.library !== 'undefined') {
      callSaveLibraryCacheToDB(state.library).catch(() => {});
    }

  } catch (error) {
    renderContent(button, safeRaw(originalIcon));
    button.className = originalColor;
    button.dataset.currentStatus = currentStatus;

    if (comicId && !seriesName) {
      updateCardBanner(comicId, currentStatus);
    } else if (seriesName) {
      updateSeriesBanner(seriesName, currentStatus);
    }

    const statusItem = seriesName
      ? {
          key: `series:${rootFolder}|${publisher}|${seriesName}`,
          type: 'series',
          rootFolder,
          publisher,
          seriesName,
          status: newStatus
        }
      : {
          key: `comic:${comicId}`,
          type: 'comic',
          comicId,
          status: newStatus
        };
    await callSaveStatusToDB(statusItem);

    if (seriesName) {
      await updateOfflineProgressForSeries(rootFolder, publisher, seriesName, newStatus);
    } else {
      await updateOfflineProgressForComic(comicId, newStatus);
    }

    callUpdateLibraryReadStatus({
      rootFolder,
      publisher,
      seriesName,
      comicId,
      status: newStatus,
    });

    renderContent(button, safeRaw(newStatus === 'read' ? iconRead : iconUnread));
    button.dataset.currentStatus = newStatus;
    if (newStatus === 'read') {
      button.classList.add('text-green-400');
      button.classList.remove('text-gray-400');
    } else {
      button.classList.add('text-gray-400');
      button.classList.remove('text-green-400');
    }

    updateLazyLoadingCounts(rootFolder, publisher, seriesName, currentStatus, newStatus);
    callApplyFilterAndRender();

    requestAnimationFrame(() => {
      if (comicId && !seriesName) {
        updateCardBanner(comicId, newStatus);
      } else if (seriesName) {
        updateSeriesBanner(seriesName, newStatus);
      }
    });
  } finally {
    button.classList.remove('loading');
    button.disabled = false;
  }
}
