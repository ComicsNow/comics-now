// Guided View — pan/zoom panel-by-panel navigation in **fullscreen** only.
// Loads the per-comic JSON sidecar of panel rectangles, then on each navigate
// step (next/prev/keyboard) advances `panelIndex`, animating a CSS transform
// on the existing #fullscreen-image so the panel fills the screen.

(function (global) {
  'use strict';

  let active = false;
  // -1 = full-page view (default on each new page);
  //  0..N-1 = zoomed to that panel.
  let panelIndex = -1;

  let bubbleActive = false;
  let bubbleIndex = -1;

  let hotZoomActive = false;
  let hotZoomIndex = -1;

  // Manga Hot Zoom (panels): -1 = no panel zoomed (full page).
  let mangaHotPanelIdx = -1;

  // Manga Bubble Hot Zoom (speech bubbles): independent toggle, click any
  // bubble to zoom (same micro-magnifier UX as Western Hot Zoom).
  let mangaBubbleHotActive = false;
  let mangaBubbleHotIdx = -1;

  // Synthetic target box from a double-click zoom. When set, applyBubbleOverlay
  // uses this instead of the per-mode panel/bubble target. Cleared on second
  // dblclick (toggle off) or when the active mode is disabled.
  let manualOverrideBox = null;

  function isFullscreenOpen() {
    const fv = document.getElementById('fullscreen-viewer');
    return !!(fv && !fv.classList.contains('hidden'));
  }

  function getStage() { return document.getElementById('fullscreen-viewer'); }
  function getImg() { return document.getElementById('fullscreen-image'); }

  /**
   * Internal helper to determine the current target box and zoom style 
   * based on active modes and indices.
   */
  function getRenderState() {
    let targetBox = null;
    let isPanelZoom = false;

    if (manualOverrideBox) {
      targetBox = manualOverrideBox;
    } else if (hotZoomActive && global.GuidedView.isMangaComic()) {
      const panels = global.GuidedView.classifyMangaPage();
      if (mangaHotPanelIdx >= 0 && panels[mangaHotPanelIdx]) {
        targetBox = panels[mangaHotPanelIdx].box;
        isPanelZoom = true;
      }
    } else if (mangaBubbleHotActive) {
      const bubbles = global.GuidedView.mangaPageBubbles();
      if (mangaBubbleHotIdx >= 0 && mangaBubbleHotIdx < bubbles.length) {
        targetBox = bubbles[mangaBubbleHotIdx];
      }
    } else if (active && !global.GuidedView.isMangaComic()) {
      const sequence = global.GuidedView.currentPagePanels();
      if (panelIndex >= 0 && panelIndex < sequence.length) targetBox = sequence[panelIndex];
    } else {
      const bubbles = global.GuidedView.currentPageBubbles();
      const index = bubbleActive ? bubbleIndex : hotZoomIndex;
      if (index >= 0 && index < bubbles.length) targetBox = bubbles[index];
    }

    return { targetBox, isPanelZoom };
  }

  /**
   * Orchestrates the rendering by calling the refactored pure functions 
   * in global.GuidedView (from overlay.js).
   */
  function refreshRender() {
    const { targetBox, isPanelZoom } = getRenderState();
    
    // 1. Classes and CSS
    const isManga = global.GuidedView.isMangaComic();
    const needsMangaLayout = active && isManga;
    global.GuidedView.applyClasses(needsMangaLayout);

    const isAnyActive = active || bubbleActive || hotZoomActive || mangaBubbleHotActive || !!manualOverrideBox;
    global.GuidedView.applyZoomCss(isAnyActive);

    // 2. Main image transform (Manga sequential only)
    if (needsMangaLayout) {
      const panels = global.GuidedView.currentPagePanels();
      const currentTarget = (panelIndex >= 0 && panelIndex < panels.length) ? panels[panelIndex] : null;
      global.GuidedView.applyTransform(currentTarget, isManga);
    } else {
      const img = getImg();
      if (img) img.style.transform = '';
    }

    // 3. Bubble overlay (Western sequential, Bubble Zoom, Hot Zoom)
    const isWesternSequential = active && !isManga;
    if (isWesternSequential || bubbleActive || hotZoomActive || mangaBubbleHotActive || manualOverrideBox) {
      global.GuidedView.applyBubbleOverlay(targetBox, isPanelZoom);
    } else {
      global.GuidedView.applyBubbleOverlay(null);
    }
  }

  function updateAllUI() {
    global.GuidedView.updateToggleUI(active);
    global.GuidedView.updateBubbleToggleUI(bubbleActive);
    global.GuidedView.updateHotZoomToggleUI(hotZoomActive);
    global.GuidedView.updateMangaBubbleHotUI(mangaBubbleHotActive);
  }

  // True if guided/bubble consumed the navigation; false → caller advances page.
  // Index walk: -1 (full page) → 0 → 1 → ... → N-1 → page advance.
  // Reverse:    -1 (full page) → previous page; 0 → -1; 1 → 0; etc.
  function tryAdvance(direction) {
    if (!active && !bubbleActive) return false;
    if (!isFullscreenOpen()) { disable(); disableBubble(); return false; }
    
    if (active) {
      const panels = global.GuidedView.currentPagePanels();
      if (panels.length === 0) return false; // no panel data → fall through to page nav
      if (direction > 0) {
        if (panelIndex >= panels.length - 1) return false; // last panel → next page
        panelIndex += 1;
        refreshRender();
        return true;
      }
      if (direction < 0) {
        if (panelIndex <= -1) return false; // already on full-page → previous page
        panelIndex -= 1;
        refreshRender();
        return true;
      }
      return false;
    }
    
    if (bubbleActive) {
      const bubbles = global.GuidedView.currentPageBubbles();
      if (bubbles.length === 0) return false;
      if (direction > 0) {
        if (bubbleIndex >= bubbles.length - 1) return false;
        bubbleIndex += 1;
        refreshRender();
        return true;
      }
      if (direction < 0) {
        if (bubbleIndex <= -1) return false;
        bubbleIndex -= 1;
        refreshRender();
        return true;
      }
      return false;
    }
  }

  function onPageRendered() {
    if (!active && !bubbleActive && !hotZoomActive && !mangaBubbleHotActive) return;
    if (!isFullscreenOpen()) { disable(); disableBubble(); disableHotZoom(); disableMangaBubbleHot(); return; }
    
    if (active) panelIndex = -1;
    if (bubbleActive) bubbleIndex = -1;
    if (hotZoomActive) { hotZoomIndex = -1; mangaHotPanelIdx = -1; }
    if (mangaBubbleHotActive) mangaBubbleHotIdx = -1;

    requestAnimationFrame(refreshRender);
  }

  // Persist that the *other* modes are off.
  function persistOnlyMode(comic, kept) {
    if (!comic) return;
    if (kept !== 'guided' && comic.guidedMode) {
      comic.guidedMode = false;
      global.updateComicInLibrary?.(comic.id, { guidedMode: false });
      saveGuidedMode(comic.id, false);
    }
    if (kept !== 'bubble' && comic.bubbleMode) {
      comic.bubbleMode = false;
      global.updateComicInLibrary?.(comic.id, { bubbleMode: false });
      saveBubbleMode(comic.id, false);
    }
    if (kept !== 'hotZoom' && comic.hotZoomMode) {
      comic.hotZoomMode = false;
      global.updateComicInLibrary?.(comic.id, { hotZoomMode: false });
      saveHotZoomMode(comic.id, false);
    }
    if (kept !== 'mangaBubbleHot' && comic.mangaBubbleHotMode) {
      comic.mangaBubbleHotMode = false;
      global.updateComicInLibrary?.(comic.id, { mangaBubbleHotMode: false });
      saveMangaBubbleHotMode(comic.id, false);
    }
  }

  async function enable() {
    if (!isFullscreenOpen()) return false;
    const comic = global.currentComic;
    if (!comic) return false;
    if (comic.guidedViewStatus !== 'completed') return false;
    const data = await global.GuidedView.loadGuidedView(comic.id);
    if (!data) return false;

    // Modes are mutually exclusive.
    if (hotZoomActive) disableHotZoom();
    if (bubbleActive) disableBubble();
    if (mangaBubbleHotActive) disableMangaBubbleHot();
    persistOnlyMode(comic, 'guided');

    active = true;
    panelIndex = -1; // start at full-page view
    requestAnimationFrame(refreshRender);
    updateAllUI();
    return true;
  }

  function disable() {
    active = false;
    panelIndex = -1;
    requestAnimationFrame(refreshRender);
    updateAllUI();
  }

  async function toggle() {
    if (active) { disable(); return false; }
    return enable();
  }

  function isActive() { return active; }

  async function saveGuidedMode(comicId, value) {
    try {
      await fetch(global.GuidedView.api(`/api/v1/comics/${encodeURIComponent(comicId)}/guided-mode`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guidedMode: !!value })
      });
    } catch (_) { /* non-fatal */ }
  }
  
  async function saveBubbleMode(comicId, value) {
    try {
      await fetch(global.GuidedView.api(`/api/v1/comics/${encodeURIComponent(comicId)}/bubble-mode`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bubbleMode: !!value })
      });
    } catch (_) { /* non-fatal */ }
  }

  async function enableBubble() {
    if (!isFullscreenOpen()) return false;
    const comic = global.currentComic;
    if (!comic) return false;
    if (comic.guidedViewStatus !== 'completed') return false;
    if (comic.mangaMode) return false;
    const data = await global.GuidedView.loadGuidedView(comic.id);
    if (!data) return false;
    
    if (active) disable();
    if (hotZoomActive) disableHotZoom();
    if (mangaBubbleHotActive) disableMangaBubbleHot();
    persistOnlyMode(comic, 'bubble');

    bubbleActive = true;
    bubbleIndex = -1;
    requestAnimationFrame(refreshRender);
    updateAllUI();
    return true;
  }

  function disableBubble() {
    bubbleActive = false;
    bubbleIndex = -1;
    manualOverrideBox = null;
    requestAnimationFrame(refreshRender);
    updateAllUI();
  }

  async function toggleBubble() {
    if (bubbleActive) { disableBubble(); return false; }
    return enableBubble();
  }

  function isBubbleActive() { return bubbleActive; }

  async function enableHotZoom() {
    if (!isFullscreenOpen()) return false;
    const comic = global.currentComic;
    if (!comic) return false;
    if (comic.guidedViewStatus !== 'completed') return false;
    const data = await global.GuidedView.loadGuidedView(comic.id);
    if (!data) return false;

    if (active) disable();
    if (bubbleActive) disableBubble();
    if (mangaBubbleHotActive) disableMangaBubbleHot();
    persistOnlyMode(comic, 'hotZoom');

    hotZoomActive = true;
    hotZoomIndex = -1;
    mangaHotPanelIdx = -1;
    requestAnimationFrame(refreshRender);
    updateAllUI();
    return true;
  }

  function disableHotZoom() {
    hotZoomActive = false;
    hotZoomIndex = -1;
    mangaHotPanelIdx = -1;
    manualOverrideBox = null;
    requestAnimationFrame(refreshRender);
    updateAllUI();
  }

  async function toggleHotZoom() {
    if (hotZoomActive) { disableHotZoom(); return false; }
    return enableHotZoom();
  }

  function isHotZoomActive() { return hotZoomActive; }

  async function enableMangaBubbleHot() {
    if (!isFullscreenOpen()) return false;
    const comic = global.currentComic;
    if (!comic) return false;
    if (comic.guidedViewStatus !== 'completed') return false;
    if (!comic.mangaMode) return false;
    const data = await global.GuidedView.loadGuidedView(comic.id);
    if (!data) return false;

    if (active) disable();
    if (bubbleActive) disableBubble();
    if (hotZoomActive) disableHotZoom();
    persistOnlyMode(comic, 'mangaBubbleHot');

    mangaBubbleHotActive = true;
    mangaBubbleHotIdx = -1;
    requestAnimationFrame(refreshRender);
    updateAllUI();
    return true;
  }

  function disableMangaBubbleHot() {
    mangaBubbleHotActive = false;
    mangaBubbleHotIdx = -1;
    manualOverrideBox = null;
    requestAnimationFrame(refreshRender);
    updateAllUI();
  }

  async function toggleMangaBubbleHot() {
    if (mangaBubbleHotActive) { disableMangaBubbleHot(); return false; }
    return enableMangaBubbleHot();
  }

  function isMangaBubbleHotActive() { return mangaBubbleHotActive; }

  async function saveMangaBubbleHotMode(comicId, value) {
    try {
      await fetch(global.GuidedView.api(`/api/v1/comics/${encodeURIComponent(comicId)}/manga-bubble-hot-mode`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mangaBubbleHotMode: !!value })
      });
    } catch (_) { /* non-fatal */ }
  }

  async function saveHotZoomMode(comicId, value) {
    try {
      await fetch(global.GuidedView.api(`/api/v1/comics/${encodeURIComponent(comicId)}/hot-zoom-mode`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hotZoomMode: !!value })
      });
    } catch (_) { /* non-fatal */ }
  }

  // Refresh button enabled state and auto-enable per saved preference.
  async function refreshGuidedToggle() {
    const btn = document.getElementById('guided-toggle-btn');
    const bubbleBtn = document.getElementById('bubble-toggle-btn');
    const hotZoomBtn = document.getElementById('hot-zoom-btn');
    const mangaBubbleHotBtn = document.getElementById('manga-bubble-hot-btn');

    const comic = global.currentComic;
    if (!comic) {
      if (btn) btn.style.display = 'none';
      if (bubbleBtn) bubbleBtn.style.display = 'none';
      if (hotZoomBtn) hotZoomBtn.style.display = 'none';
      if (mangaBubbleHotBtn) mangaBubbleHotBtn.style.display = 'none';
      return;
    }

    const isManga = !!(comic && (comic.mangaMode === true || comic.mangaMode == 1));
    const processed = !!(comic && comic.guidedViewStatus === 'completed');
    const isContinuous = !!global.isContinuousMode;

    if (processed && !global.GuidedView.cache.has(comic.id)) {
      await global.GuidedView.loadGuidedView(comic.id);
    }

    const data = global.GuidedView.cache.get(comic.id);

    if (btn) {
      const hasPanels = data && data.pages && Object.values(data.pages).some(p => {
        if (Array.isArray(p)) return p.length > 0;
        return p && p.panels && p.panels.length > 0;
      });
      const ready = isManga && processed && hasPanels && !isContinuous;
      btn.style.display = ready ? 'flex' : 'none';
      btn.disabled = !ready;
    }

    if (bubbleBtn) {
      const hasBubbles = data && data.pages && Object.values(data.pages).some(p => p && p.bubbles && p.bubbles.length > 0);
      const hasSequence = data && data.pages && Object.values(data.pages).some(p => p && p.sequence && p.sequence.length > 0);
      const bubbleReady = !isManga && processed && (hasBubbles || hasSequence) && !isContinuous;
      bubbleBtn.style.display = bubbleReady ? 'flex' : 'none';
      bubbleBtn.disabled = !bubbleReady;
    }

    if (hotZoomBtn) {
      const hasBubbles = data && data.pages && Object.values(data.pages).some(p => p && p.bubbles && p.bubbles.length > 0);
      const hasMangaBoxes = data && data.pages && Object.values(data.pages).some(p => p && Array.isArray(p.panels) && p.panels.length > 0);
      const hotZoomReady = processed && (isManga ? hasMangaBoxes : hasBubbles) && !isContinuous;
      hotZoomBtn.style.display = hotZoomReady ? 'flex' : 'none';
      hotZoomBtn.disabled = !hotZoomReady;
    }

    if (mangaBubbleHotBtn) {
      const hasMangaBoxes = data && data.pages && Object.values(data.pages).some(p => p && Array.isArray(p.panels) && p.panels.length > 0);
      const ready = isManga && processed && hasMangaBoxes;
      mangaBubbleHotBtn.style.display = ready ? 'flex' : 'none';
      mangaBubbleHotBtn.disabled = !ready;
    }

    if (!isFullscreenOpen()) {
      if (active) disable();
      if (bubbleActive) disableBubble();
      if (hotZoomActive) disableHotZoom();
      if (mangaBubbleHotActive) disableMangaBubbleHot();
      updateAllUI();
      return;
    }
    
    const guidedModePref = !!(comic.guidedMode === true || comic.guidedMode == 1);
    const bubbleModePref = !!(comic.bubbleMode === true || comic.bubbleMode == 1);
    const hotZoomModePref = !!(comic.hotZoomMode === true || comic.hotZoomMode == 1);
    const mangaBubbleHotPref = !!(comic.mangaBubbleHotMode === true || comic.mangaBubbleHotMode == 1);

    if (isManga && processed && guidedModePref && !active) {
      await enable();
    } else if (isManga && (!processed || !guidedModePref) && active) {
      disable();
    }
    
    if (!isManga && processed && bubbleModePref && !bubbleActive) {
      await enableBubble();
    } else if (!isManga && (!processed || !bubbleModePref) && bubbleActive) {
      disableBubble();
    }

    if (processed && hotZoomModePref && !hotZoomActive) {
      await enableHotZoom();
    } else if ((!processed || !hotZoomModePref) && hotZoomActive) {
      disableHotZoom();
    }

    if (isManga && processed && mangaBubbleHotPref && !mangaBubbleHotActive) {
      await enableMangaBubbleHot();
    } else if (isManga && (!processed || !mangaBubbleHotPref) && mangaBubbleHotActive) {
      disableMangaBubbleHot();
    }

    updateAllUI();
  }

  function bindToggleButton() {
    const btn = document.getElementById('guided-toggle-btn');
    if (btn && !btn._guidedBound) {
      btn._guidedBound = true;
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const comic = global.currentComic;
        if (!comic || comic.guidedViewStatus !== 'completed' || !isFullscreenOpen()) return;
        const willActivate = !active;
        if (willActivate) await enable(); else disable();
        comic.guidedMode = willActivate;
        if (typeof global.updateComicInLibrary === 'function') global.updateComicInLibrary(comic.id, { guidedMode: willActivate });
        saveGuidedMode(comic.id, willActivate);
      });
    }

    const bubbleBtn = document.getElementById('bubble-toggle-btn');
    if (bubbleBtn && !bubbleBtn._bubbleBound) {
      bubbleBtn._bubbleBound = true;
      bubbleBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const comic = global.currentComic;
        if (!comic || comic.guidedViewStatus !== 'completed' || !!comic.mangaMode || !isFullscreenOpen()) return;
        const willActivate = !bubbleActive;
        if (willActivate) await enableBubble(); else disableBubble();
        comic.bubbleMode = willActivate;
        if (typeof global.updateComicInLibrary === 'function') global.updateComicInLibrary(comic.id, { bubbleMode: willActivate });
        saveBubbleMode(comic.id, willActivate);
      });
    }

    const mangaBubbleHotBtn = document.getElementById('manga-bubble-hot-btn');
    if (mangaBubbleHotBtn && !mangaBubbleHotBtn._mangaBubbleHotBound) {
      mangaBubbleHotBtn._mangaBubbleHotBound = true;
      mangaBubbleHotBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const comic = global.currentComic;
        if (!comic || comic.guidedViewStatus !== 'completed' || !comic.mangaMode || !isFullscreenOpen()) return;
        const willActivate = !mangaBubbleHotActive;
        if (willActivate) await enableMangaBubbleHot(); else disableMangaBubbleHot();
        comic.mangaBubbleHotMode = willActivate;
        if (typeof global.updateComicInLibrary === 'function') global.updateComicInLibrary(comic.id, { mangaBubbleHotMode: willActivate });
        saveMangaBubbleHotMode(comic.id, willActivate);
      });
    }

    const hotZoomBtn = document.getElementById('hot-zoom-btn');
    if (hotZoomBtn && !hotZoomBtn._hotZoomBound) {
      hotZoomBtn._hotZoomBound = true;
      hotZoomBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const comic = global.currentComic;
        if (!comic || comic.guidedViewStatus !== 'completed' || !isFullscreenOpen()) return;
        const willActivate = !hotZoomActive;
        if (willActivate) await enableHotZoom(); else disableHotZoom();
        comic.hotZoomMode = willActivate;
        if (typeof global.updateComicInLibrary === 'function') global.updateComicInLibrary(comic.id, { hotZoomMode: willActivate });
        saveHotZoomMode(comic.id, willActivate);
      });
    }
  }

  function watchFullscreenToggle() {
    const fv = document.getElementById('fullscreen-viewer');
    if (!fv || fv._guidedObserver) return;
    const observer = new MutationObserver(() => {
      const open = isFullscreenOpen();
      if (open) refreshGuidedToggle();
      else {
        if (active) disable();
        if (bubbleActive) disableBubble();
        if (hotZoomActive) disableHotZoom();
        if (mangaBubbleHotActive) disableMangaBubbleHot();
      }
    });
    observer.observe(fv, { attributes: true, attributeFilter: ['class'] });
    fv._guidedObserver = observer;
  }

  function isZoomEngaged() {
    if (manualOverrideBox) return true;
    if (bubbleActive && bubbleIndex >= 0) return true;
    if (hotZoomActive && (hotZoomIndex >= 0 || mangaHotPanelIdx >= 0)) return true;
    if (mangaBubbleHotActive && mangaBubbleHotIdx >= 0) return true;
    return false;
  }

  function isAnyGuidedActive() {
    return active || bubbleActive || hotZoomActive || mangaBubbleHotActive;
  }

  function handleImageClick(e) {
    if (!active && !bubbleActive && !hotZoomActive && !mangaBubbleHotActive) return;

    if (manualOverrideBox) {
      const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
      if (now - lastDblZoomAt < 500) { e.preventDefault(); e.stopPropagation(); return; }
      e.preventDefault(); e.stopPropagation();
      manualOverrideBox = null;
      requestAnimationFrame(refreshRender);
      return;
    }

    const img = getImg();
    if (!img || !img.naturalWidth) return;

    const rect = img.getBoundingClientRect();
    const outsideImage = e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom;
    if (outsideImage) {
      global.showFullscreenControls?.(true);
      return;
    }

    const rx = e.clientX - rect.left;
    const ry = e.clientY - rect.top;
    const nx = rx * (img.naturalWidth / rect.width);
    const ny = ry * (img.naturalHeight / rect.height);

    if (bubbleActive) {
      const bubbles = global.GuidedView.currentPageBubbles();
      for (let i = 0; i < bubbles.length; i++) {
        const [bx, by, bw, bh] = bubbles[i];
        if (nx >= bx && nx <= bx + bw && ny >= by && ny <= by + bh) {
          e.preventDefault(); e.stopPropagation();
          bubbleIndex = i;
          requestAnimationFrame(refreshRender);
          return;
        }
      }
    } else if (mangaBubbleHotActive) {
      const bubbles = global.GuidedView.mangaPageBubbles();
      let bestIdx = -1, minArea = Infinity;
      for (let i = 0; i < bubbles.length; i++) {
        const [bx, by, bw, bh] = bubbles[i];
        if (nx >= bx && nx <= bx + bw && ny >= by && ny <= by + bh) {
          const area = bw * bh;
          if (area < minArea) { minArea = area; bestIdx = i; }
        }
      }
      if (bestIdx !== -1) {
        e.preventDefault(); e.stopPropagation();
        mangaBubbleHotIdx = (mangaBubbleHotIdx === bestIdx) ? -1 : bestIdx;
        requestAnimationFrame(refreshRender);
        return;
      }
      if (mangaBubbleHotIdx !== -1) {
        e.preventDefault(); e.stopPropagation();
        mangaBubbleHotIdx = -1;
        requestAnimationFrame(refreshRender);
      }
      return;
    } else if (hotZoomActive && global.GuidedView.isMangaComic()) {
      const panels = global.GuidedView.classifyMangaPage();
      if (panels.length === 0) return;
      if (mangaHotPanelIdx >= 0) {
        e.preventDefault(); e.stopPropagation();
        mangaHotPanelIdx = -1;
        requestAnimationFrame(refreshRender);
        return;
      }
      let bestIdx = -1, bestArea = Infinity;
      for (let i = 0; i < panels.length; i++) {
        const [px, py, pw, ph] = panels[i].box;
        if (nx >= px && nx <= px + pw && ny >= py && ny <= py + ph) {
          const area = pw * ph;
          if (area < bestArea) { bestArea = area; bestIdx = i; }
        }
      }
      if (bestIdx >= 0) {
        e.preventDefault(); e.stopPropagation();
        mangaHotPanelIdx = bestIdx;
        requestAnimationFrame(refreshRender);
      }
      return;
    } else if (hotZoomActive) {
      const bubbles = global.GuidedView.currentPageBubbles();
      let bestIndex = -1, minArea = Infinity;
      for (let i = 0; i < bubbles.length; i++) {
        const [bx, by, bw, bh] = bubbles[i];
        if (nx >= bx && nx <= bx + bw && ny >= by && ny <= by + bh) {
          const area = bw * bh;
          if (area < minArea) { minArea = area; bestIndex = i; }
        }
      }
      if (bestIndex !== -1) {
        e.preventDefault(); e.stopPropagation();
        hotZoomIndex = (hotZoomIndex === bestIndex) ? -1 : bestIndex;
        requestAnimationFrame(refreshRender);
      } else if (hotZoomIndex !== -1) {
        e.preventDefault(); e.stopPropagation();
        hotZoomIndex = -1;
        requestAnimationFrame(refreshRender);
      }
    }
  }

  function init() {
    bindToggleButton();
    watchFullscreenToggle();
    const stage = getStage();
    if (stage) {
      stage.addEventListener('click', handleImageClick, true);
      stage.addEventListener('contextmenu', (e) => {
        if (active || bubbleActive || hotZoomActive || mangaBubbleHotActive) e.preventDefault();
      });
    }
    if (!document.getElementById('__guided_zoom_style')) {
      const style = document.createElement('style');
      style.id = '__guided_zoom_style';
      style.textContent = `
        .guided-zoom-no-touchmenu, .guided-zoom-no-touchmenu * {
          -webkit-touch-callout: none !important;
          -webkit-user-select: none !important;
          user-select: none !important;
        }
        .guided-zoom-no-touchmenu img { pointer-events: auto; }
      `;
      document.head.appendChild(style);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  function disableAll() {
    const comic = global.currentComic;
    if (active) disable();
    if (bubbleActive) disableBubble();
    if (hotZoomActive) disableHotZoom();
    if (mangaBubbleHotActive) disableMangaBubbleHot();
    if (comic) persistOnlyMode(comic, null);
  }

  Object.assign(global.GuidedView, {
    enable, disable, toggle, tryAdvance, onPageRendered, isActive, refreshGuidedToggle,
    enableBubble, disableBubble, toggleBubble, isBubbleActive,
    enableHotZoom, disableHotZoom, toggleHotZoom, isHotZoomActive,
    enableMangaBubbleHot, disableMangaBubbleHot, toggleMangaBubbleHot, isMangaBubbleHotActive,
    disableAll, isZoomEngaged, isAnyGuidedActive
  });
  global.tryGuidedAdvance = tryAdvance;
  global.onGuidedPageRendered = onPageRendered;
  global.toggleGuidedView = toggle;
  global.toggleBubbleView = toggleBubble;
  global.toggleHotZoomView = toggleHotZoom;
  global.refreshGuidedToggle = refreshGuidedToggle;

  window.addEventListener('resize', () => {
    if (active || bubbleActive || hotZoomActive || mangaBubbleHotActive) {
      requestAnimationFrame(refreshRender);
    }
  });

  let lastDblZoomAt = 0;
  function handleDoubleClickZoom(event) {
    if (global.isFullImageMode) return;
    if (!hotZoomActive && !bubbleActive && !mangaBubbleHotActive) return;
    const img = getImg();
    if (!img || !img.naturalWidth || !img.naturalHeight) return;
    const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    if (now - lastDblZoomAt < 250) return;
    lastDblZoomAt = now;
    if (typeof global.cancelPendingSideNav === 'function') global.cancelPendingSideNav();
    const isPointerEvt = event && (event.type === 'pointerup' || event.type === 'pointerdown');

    if (manualOverrideBox) {
      manualOverrideBox = null;
      if (!isPointerEvt) { event.preventDefault?.(); event.stopPropagation?.(); }
      requestAnimationFrame(refreshRender);
      return;
    }

    const rect = img.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const ratioX = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    const ratioY = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
    const boxW = img.naturalWidth * 0.4;
    const boxH = img.naturalHeight * 0.4;
    const cx = ratioX * img.naturalWidth;
    const cy = ratioY * img.naturalHeight;
    manualOverrideBox = [cx - boxW / 2, cy - boxH / 2, boxW, boxH];
    if (!isPointerEvt) { event.preventDefault?.(); event.stopPropagation?.(); }
    requestAnimationFrame(refreshRender);
  }

  const DOUBLE_TAP_MS = 300;
  const DOUBLE_TAP_MOVE_TOLERANCE = 30;
  let lastTapAt = 0, lastTapX = 0, lastTapY = 0;

  function handlePointerUpForDblTap(event) {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (!hotZoomActive && !bubbleActive && !mangaBubbleHotActive) { lastTapAt = 0; return; }
    const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    const dx = event.clientX - lastTapX, dy = event.clientY - lastTapY;
    if ((now - lastTapAt) <= DOUBLE_TAP_MS && (dx * dx + dy * dy) <= (DOUBLE_TAP_MOVE_TOLERANCE * DOUBLE_TAP_MOVE_TOLERANCE)) {
      lastTapAt = 0; handleDoubleClickZoom(event); return;
    }
    lastTapAt = now; lastTapX = event.clientX; lastTapY = event.clientY;
  }
  document.addEventListener('pointerup', handlePointerUpForDblTap, { capture: true });
  document.addEventListener('dblclick', handleDoubleClickZoom, { capture: true });
})(typeof window !== 'undefined' ? window : globalThis);
