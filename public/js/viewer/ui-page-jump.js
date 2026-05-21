import { state } from '../globals.js';

const global = new Proxy(typeof window !== 'undefined' ? window : globalThis, {
  get(target, prop) {
    if (prop in state) {
      return state[prop];
    }
    const val = target[prop];
    if (typeof val === 'function') {
      return val.bind(target);
    }
    return val;
  },
  set(target, prop, value) {
    state[prop] = value;
    try {
      target[prop] = value;
    } catch (e) {}
    return true;
  }
});

  const PAGE_COUNTER_PLACEHOLDER = '\u2014 / \u2014';
  let isPageJumpInputOpen = false;

  function showPageJumpInput() {
    const counter = global.pageCounterSpan;
    const input = global.pageJumpInput;
    if (!counter || !input || counter.disabled) return;

    const totalPages = global.getPageCounterTotal();
    if (totalPages <= 0) return;

    isPageJumpInputOpen = true;
    const currentPage = Math.min(totalPages, Math.max(1, global.currentPageIndex + 1));
    input.setAttribute('min', '1');
    input.setAttribute('max', String(totalPages));
    input.value = String(currentPage);
    input.classList.remove('hidden');
    counter.classList.add('page-counter-hidden');
    counter.setAttribute('aria-expanded', 'true');

    requestAnimationFrame(() => {
      input.focus();
      input.select();
    });
  }

  function hidePageJumpInput({ focusButton = true, resetValue = true } = {}) {
    const counter = global.pageCounterSpan;
    const input = global.pageJumpInput;
    if (!counter || !input) return;

    if (resetValue) {
      input.value = '';
    }

    if (!isPageJumpInputOpen && input.classList.contains('hidden')) {
      return;
    }

    isPageJumpInputOpen = false;
    input.classList.add('hidden');
    counter.classList.remove('page-counter-hidden');
    counter.setAttribute('aria-expanded', 'false');

    if (focusButton && !counter.disabled) {
      counter.focus();
    }
  }

  async function commitPageJump() {
    const counter = global.pageCounterSpan;
    const input = global.pageJumpInput;
    if (!counter || !input) return;

    const totalPages = global.getPageCounterTotal();
    if (totalPages <= 0) {
      hidePageJumpInput({ focusButton: false });
      return;
    }

    const rawValue = input.value.trim();
    if (rawValue === '') {
      hidePageJumpInput({ focusButton: true });
      return;
    }

    const targetPage = Number.parseInt(rawValue, 10);
    if (Number.isNaN(targetPage)) {
      const currentPage = Math.min(totalPages, Math.max(1, global.currentPageIndex + 1));
      input.value = String(currentPage);
      input.select();
      return;
    }

    const clampedPage = Math.min(totalPages, Math.max(1, targetPage));
    hidePageJumpInput({ focusButton: false });

    if (clampedPage - 1 === global.currentPageIndex) {
      global.updateViewerPageCounter(totalPages);
      if (!counter.disabled) {
        counter.focus();
      }
      return;
    }

    const previousIndex = global.currentPageIndex;
    global.currentPageIndex = clampedPage - 1;

    try {
      // Save progress before rendering
      if (global.currentComic) {
        const comicFromDB = await global.getComicFromDB?.(global.currentComic.id);
        const isDownloaded = global.downloadedComicIds?.has(global.currentComic.id) || !!comicFromDB;

        if (isDownloaded) {
          // Save to IndexedDB for offline access
          try {
            if (typeof global.saveProgressToDB === 'function') {
              global.saveProgressToDB(
                global.currentComic.id,
                global.currentPageIndex,
                global.currentComic.progress?.totalPages,
                global.currentComic.path,
              );
            }
          } catch (error) {

          }

          // Update local progress
          if (!global.currentComic.progress) {
            global.currentComic.progress = { totalPages: 0, lastReadPage: 0 };
          }
          global.currentComic.progress.lastReadPage = global.currentPageIndex;
          global.downloadedComicIds?.add(global.currentComic.id);
          global.updateLibraryProgress?.(global.currentComic.id, global.currentPageIndex, global.currentComic.progress.totalPages);

          // ALSO sync to server with per-device progress (same as online comics)
          if (navigator.onLine && typeof global.saveProgress === 'function') {
            global.saveProgress(global.currentPageIndex);
          }
        } else {
          try {
            if (typeof global.saveProgress === 'function') {
              global.saveProgress(global.currentPageIndex);
            }
            // Also update the library data so it has the latest progress
            if (global.updateLibraryProgress) {
              global.updateLibraryProgress(global.currentComic.id, global.currentPageIndex, global.currentComic.progress?.totalPages);
            }
          } catch (error) {

          }
        }
      }

      const rendered = await global.renderPage?.();
      if (rendered === false) {
        global.currentPageIndex = previousIndex;
        global.updateViewerPageCounter(totalPages);
      }
    } catch (error) {
      global.currentPageIndex = previousIndex;

      global.updateViewerPageCounter(totalPages);
    } finally {
      if (!counter.disabled) {
        counter.focus();
      }
    }
  }

  function showPageJumpInputBottom() {
    const counter = global.pageCounterSpanBottom;
    const input = global.pageJumpInputBottom;
    if (!counter || !input || counter.disabled) return;

    const totalPages = global.getPageCounterTotal();
    if (totalPages <= 0) return;

    const currentPage = Math.min(totalPages, Math.max(1, global.currentPageIndex + 1));
    input.setAttribute('min', '1');
    input.setAttribute('max', String(totalPages));
    input.value = String(currentPage);
    input.classList.remove('hidden');
    counter.classList.add('page-counter-hidden');
    counter.setAttribute('aria-expanded', 'true');

    requestAnimationFrame(() => {
      input.focus();
      input.select();
    });
  }

  function hidePageJumpInputBottom({ focusButton = true, resetValue = true } = {}) {
    const counter = global.pageCounterSpanBottom;
    const input = global.pageJumpInputBottom;
    if (!counter || !input) return;

    if (resetValue) {
      input.value = '';
    }

    if (input.classList.contains('hidden')) {
      return;
    }

    input.classList.add('hidden');
    counter.classList.remove('page-counter-hidden');
    counter.setAttribute('aria-expanded', 'false');

    if (focusButton && !counter.disabled) {
      counter.focus();
    }
  }

  async function commitPageJumpBottom() {
    const counter = global.pageCounterSpanBottom;
    const input = global.pageJumpInputBottom;
    if (!counter || !input) return;

    const totalPages = global.getPageCounterTotal();
    if (totalPages <= 0) {
      hidePageJumpInputBottom({ focusButton: false });
      return;
    }

    const rawValue = input.value.trim();
    if (rawValue === '') {
      hidePageJumpInputBottom({ focusButton: true });
      return;
    }

    const targetPage = Number.parseInt(rawValue, 10);
    if (Number.isNaN(targetPage)) {
      const currentPage = Math.min(totalPages, Math.max(1, global.currentPageIndex + 1));
      input.value = String(currentPage);
      input.select();
      return;
    }

    const clampedPage = Math.min(totalPages, Math.max(1, targetPage));
    hidePageJumpInputBottom({ focusButton: false });

    if (clampedPage - 1 === global.currentPageIndex) {
      global.updateViewerPageCounter(totalPages);
      if (!counter.disabled) {
        counter.focus();
      }
      return;
    }

    const previousIndex = global.currentPageIndex;
    global.currentPageIndex = clampedPage - 1;

    try {
      // Save progress before rendering
      if (global.currentComic) {
        const comicFromDB = await global.getComicFromDB?.(global.currentComic.id);
        const isDownloaded = global.downloadedComicIds?.has(global.currentComic.id) || !!comicFromDB;

        if (isDownloaded) {
          // Save to IndexedDB for offline access
          try {
            if (typeof global.saveProgressToDB === 'function') {
              global.saveProgressToDB(
                global.currentComic.id,
                global.currentPageIndex,
                global.currentComic.progress?.totalPages,
                global.currentComic.path,
              );
            }
          } catch (error) {

          }

          // Update local progress
          if (!global.currentComic.progress) {
            global.currentComic.progress = { totalPages: 0, lastReadPage: 0 };
          }
          global.currentComic.progress.lastReadPage = global.currentPageIndex;
          global.downloadedComicIds?.add(global.currentComic.id);
          global.updateLibraryProgress?.(global.currentComic.id, global.currentPageIndex, global.currentComic.progress.totalPages);

          // ALSO sync to server with per-device progress (same as online comics)
          if (navigator.onLine && typeof global.saveProgress === 'function') {
            global.saveProgress(global.currentPageIndex);
          }
        } else {
          try {
            if (typeof global.saveProgress === 'function') {
              global.saveProgress(global.currentPageIndex);
            }
            // Also update the library data so it has the latest progress
            if (global.updateLibraryProgress) {
              global.updateLibraryProgress(global.currentComic.id, global.currentPageIndex, global.currentComic.progress?.totalPages);
            }
          } catch (error) {

          }
        }
      }

      const rendered = await global.renderPage?.();
      if (rendered === false) {
        global.currentPageIndex = previousIndex;
        global.updateViewerPageCounter(totalPages);
      }
    } catch (error) {
      global.currentPageIndex = previousIndex;

      global.updateViewerPageCounter(totalPages);
    } finally {
      if (!counter.disabled) {
        counter.focus();
      }
    }
  }

  global.isPageJumpInputOpenGetter = () => isPageJumpInputOpen;
  global.PAGE_COUNTER_PLACEHOLDER = PAGE_COUNTER_PLACEHOLDER;
  global.showPageJumpInput = showPageJumpInput;
  global.hidePageJumpInput = hidePageJumpInput;
  global.commitPageJump = commitPageJump;
  global.showPageJumpInputBottom = showPageJumpInputBottom;
  global.hidePageJumpInputBottom = hidePageJumpInputBottom;
  global.commitPageJumpBottom = commitPageJumpBottom;

const isPageJumpInputOpenGetter = () => isPageJumpInputOpen;

export {
  PAGE_COUNTER_PLACEHOLDER,
  isPageJumpInputOpenGetter,
  showPageJumpInput,
  hidePageJumpInput,
  commitPageJump,
  showPageJumpInputBottom,
  hidePageJumpInputBottom,
  commitPageJumpBottom
};

state.isPageJumpInputOpenGetter = isPageJumpInputOpenGetter;
state.PAGE_COUNTER_PLACEHOLDER = PAGE_COUNTER_PLACEHOLDER;
state.showPageJumpInput = showPageJumpInput;
state.hidePageJumpInput = hidePageJumpInput;
state.commitPageJump = commitPageJump;
state.showPageJumpInputBottom = showPageJumpInputBottom;
state.hidePageJumpInputBottom = hidePageJumpInputBottom;
state.commitPageJumpBottom = commitPageJumpBottom;

if (typeof window !== 'undefined') {
  window.isPageJumpInputOpenGetter = isPageJumpInputOpenGetter;
  window.PAGE_COUNTER_PLACEHOLDER = PAGE_COUNTER_PLACEHOLDER;
  window.showPageJumpInput = showPageJumpInput;
  window.hidePageJumpInput = hidePageJumpInput;
  window.commitPageJump = commitPageJump;
  window.showPageJumpInputBottom = showPageJumpInputBottom;
  window.hidePageJumpInputBottom = hidePageJumpInputBottom;
  window.commitPageJumpBottom = commitPageJumpBottom;
}
