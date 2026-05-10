// Guided View — pan/zoom panel-by-panel navigation in **fullscreen** only.
// Loads the per-comic JSON sidecar of panel rectangles, then on each navigate
// step (next/prev/keyboard) advances `panelIndex`, animating a CSS transform
// on the existing #fullscreen-image so the panel fills the screen.

(function (global) {
  'use strict';

  const cache = new Map(); // comicId -> data | null
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

  const ZOOM_ICON_HTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line><line x1="11" y1="8" x2="11" y2="14"></line><line x1="8" y1="11" x2="14" y2="11"></line></svg>`;
  const SPEECH_BUBBLE_ICON_HTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>`;
  const GUIDE_ICON_HTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="7" r="2"></circle><path d="M9 9v7"></path><path d="M6 12l3-2 3 2"></path><path d="M7 21l2-5 2 5"></path><line x1="13" y1="3" x2="13" y2="21"></line><path d="M13 4l7 3-7 3"></path></svg>`;

  // Synthetic target box from a double-click zoom. When set, applyBubbleOverlay
  // uses this instead of the per-mode panel/bubble target. Cleared on second
  // dblclick (toggle off) or when the active mode is disabled.
  let manualOverrideBox = null;

  function api(p) {
    const base = (typeof API_BASE_URL !== 'undefined' ? API_BASE_URL : '') || '';
    return `${base}${p}`;
  }

  function isFullscreenOpen() {
    const fv = document.getElementById('fullscreen-viewer');
    return !!(fv && !fv.classList.contains('hidden'));
  }

  function getStage() { return document.getElementById('fullscreen-viewer'); }
  function getImg() { return document.getElementById('fullscreen-image'); }

  async function loadGuidedView(comicId) {
    if (!comicId) return null;
    if (cache.has(comicId)) return cache.get(comicId);
    try {
      const res = await fetch(api(`/api/v1/comics/${encodeURIComponent(comicId)}/guided-view`));
      if (!res.ok) { cache.set(comicId, null); return null; }
      const data = await res.json();
      cache.set(comicId, data);
      return data;
    } catch {
      cache.set(comicId, null);
      return null;
    }
  }

  function currentPagePanels() {
    const comic = global.currentComic;
    if (!comic) return [];
    const data = cache.get(comic.id);
    if (!data || !data.pages) return [];
    const pages = global.getViewerPages?.() || [];
    const fname = pages[global.currentPageIndex];
    if (!fname) return [];
    
    // Handle multiple schema versions
    const pageData = data.pages[fname];
    if (Array.isArray(pageData)) return pageData;
    if (pageData) {
      // Prioritize granular sequence if available
      if (Array.isArray(pageData.sequence) && pageData.sequence.length > 0) return pageData.sequence;
      if (Array.isArray(pageData.panels)) return pageData.panels;
    }
    return [];
  }

  function currentPageBubbles() {
    const comic = global.currentComic;
    if (!comic) return [];
    const data = cache.get(comic.id);
    if (!data || !data.pages) return [];
    const pages = global.getViewerPages?.() || [];
    const fname = pages[global.currentPageIndex];
    if (!fname) return [];
    
    const pageData = data.pages[fname];
    if (pageData && Array.isArray(pageData.bubbles)) return pageData.bubbles;
    return [];
  }

  // Raw boxes from the manga model (panels + bubbles mixed, pre-sequencing).
  // For manga sidecars, `panels` field holds the full unfiltered detection set.
  function currentPageRawBoxes() {
    const comic = global.currentComic;
    if (!comic) return [];
    const data = cache.get(comic.id);
    if (!data || !data.pages) return [];
    const pages = global.getViewerPages?.() || [];
    const fname = pages[global.currentPageIndex];
    if (!fname) return [];
    const pd = data.pages[fname];
    if (pd && Array.isArray(pd.panels)) return pd.panels;
    return [];
  }

  function isMangaComic() {
    const c = global.currentComic;
    return !!(c && (c.mangaMode === true || c.mangaMode == 1));
  }

  // Fraction of box A's area that lies inside box B.
  function intersectionOverArea(a, b) {
    const [ax, ay, aw, ah] = a;
    const [bx, by, bw, bh] = b;
    const x1 = Math.max(ax, bx), y1 = Math.max(ay, by);
    const x2 = Math.min(ax + aw, bx + bw), y2 = Math.min(ay + ah, by + bh);
    const iw = Math.max(0, x2 - x1), ih = Math.max(0, y2 - y1);
    const inter = iw * ih;
    const area = aw * ah;
    return area > 0 ? inter / area : 0;
  }

  // Classify the manga raw boxes into panels with their child bubbles.
  // Returns [{ box, bubbles: [box, ...] }, ...].
  function classifyMangaPage() {
    const boxes = currentPageRawBoxes();
    if (boxes.length === 0) return [];
    const isChild = boxes.map((b, i) =>
      boxes.some((other, j) => i !== j && intersectionOverArea(b, other) >= 0.7)
    );
    const panels = [];
    const panelOriginalIdx = [];
    for (let i = 0; i < boxes.length; i++) {
      if (!isChild[i]) {
        panelOriginalIdx.push(i);
        panels.push({ box: boxes[i], bubbles: [] });
      }
    }
    for (let i = 0; i < boxes.length; i++) {
      if (!isChild[i]) continue;
      let bestParent = -1, bestRatio = 0.6;
      for (let p = 0; p < panels.length; p++) {
        const r = intersectionOverArea(boxes[i], panels[p].box);
        if (r > bestRatio) { bestRatio = r; bestParent = p; }
      }
      if (bestParent >= 0) panels[bestParent].bubbles.push(boxes[i]);
    }
    return panels;
  }

  // Flat list of speech-bubble boxes for the current manga page.
  function mangaPageBubbles() {
    const out = [];
    const panels = classifyMangaPage();
    for (const p of panels) for (const b of p.bubbles) out.push(b);
    return out;
  }

  function applyTransform() {
    const stage = getStage();
    const img = getImg();
    if (!stage || !img) return;

    // For Western comics in sequential Guided mode, we use the magnifier overlay.
    // The main image stays centered/contained.
    if (active && !isMangaComic()) {
      img.style.transform = '';
      applyBubbleOverlay();
      return;
    }

    if (!img.naturalWidth || !img.naturalHeight) {
      img.addEventListener('load', applyTransform, { once: true });
      return;
    }
    const stageW = stage.clientWidth;
    const stageH = stage.clientHeight;
    if (!stageW || !stageH) return;

    const panels = currentPagePanels();
    const inPanel = panelIndex >= 0 && panelIndex < panels.length;

    if (!inPanel) {
      // Full-page view: contain the whole image inside the stage, centered.
      const s = Math.min(stageW / img.naturalWidth, stageH / img.naturalHeight);
      const tx = (stageW - img.naturalWidth * s) / 2;
      const ty = (stageH - img.naturalHeight * s) / 2;
      img.style.transform = `translate(${tx}px, ${ty}px) scale(${s})`;
      return;
    }

    let [px, py, pw, ph] = panels[panelIndex];
    if (pw <= 0) pw = img.naturalWidth;
    if (ph <= 0) ph = img.naturalHeight;

    const margin = 0.04;
    const targetW = stageW * (1 - margin * 2);
    const targetH = stageH * (1 - margin * 2);
    
    // Cap scale to 4x — high enough to read small speech bubbles, low enough to avoid disorientation
    let s = Math.min(targetW / pw, targetH / ph);
    if (s > 4.0) s = 4.0;

    const cx = px + pw / 2;
    const cy = py + ph / 2;
    const tx = stageW / 2 - cx * s;
    const ty = stageH / 2 - cy * s;
    img.style.transform = `translate(${tx}px, ${ty}px) scale(${s})`;
  }

  function applyClasses() {
    const stage = getStage();
    const img = getImg();
    const needsGuidedLayout = active; // Only Manga mode transforms the main image

    // guided-stage changes flex→block layout; only needed for manga pan/zoom.
    // Bubble/hot-zoom use an absolute overlay and must not break image centering.
    if (stage) stage.classList.toggle('guided-stage', needsGuidedLayout);
    if (img) {
      img.classList.toggle('guided-img', needsGuidedLayout);
      if (needsGuidedLayout) {
        img.classList.remove('orientation-landscape');
      } else {
        img.style.transform = '';
        if (global.isLandscapeOrientation) img.classList.add('orientation-landscape');
      }
    }
    if (typeof applyZoomCss === 'function') applyZoomCss();
  }

  function updateToggleUI() {
    const btn = document.getElementById('guided-toggle-btn');
    if (!btn) return;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');

    const isMobile = typeof global.isMobileDevice === 'function' && global.isMobileDevice();
    if (isMobile) {
      btn.innerHTML = GUIDE_ICON_HTML;
    } else {
      btn.innerHTML = GUIDE_ICON_HTML;
    }
  }

  // True if guided/bubble consumed the navigation; false → caller advances page.
  // Index walk: -1 (full page) → 0 → 1 → ... → N-1 → page advance.
  // Reverse:    -1 (full page) → previous page; 0 → -1; 1 → 0; etc.
  function tryAdvance(direction) {
    if (!active && !bubbleActive) return false;
    if (!isFullscreenOpen()) { disable(); disableBubble(); return false; }
    
    if (active) {
      const panels = currentPagePanels();
      if (panels.length === 0) return false; // no panel data → fall through to page nav
      if (direction > 0) {
        if (panelIndex >= panels.length - 1) return false; // last panel → next page
        panelIndex += 1;
        applyTransform();
        return true;
      }
      if (direction < 0) {
        if (panelIndex <= -1) return false; // already on full-page → previous page
        panelIndex -= 1;
        applyTransform();
        return true;
      }
      return false;
    }
    
    if (bubbleActive) {
      const bubbles = currentPageBubbles();
      if (bubbles.length === 0) return false;
      if (direction > 0) {
        if (bubbleIndex >= bubbles.length - 1) return false;
        bubbleIndex += 1;
        applyBubbleOverlay();
        return true;
      }
      if (direction < 0) {
        if (bubbleIndex <= -1) return false;
        bubbleIndex -= 1;
        applyBubbleOverlay();
        return true;
      }
      return false;
    }
  }

  function onPageRendered() {
    if (!active && !bubbleActive && !hotZoomActive) return;
    if (!isFullscreenOpen()) { disable(); disableBubble(); disableHotZoom(); return; }
    
    applyClasses();

    if (active) {
      panelIndex = -1;
      requestAnimationFrame(applyTransform);
    }
    if (bubbleActive) {
      bubbleIndex = -1;
      requestAnimationFrame(applyBubbleOverlay);
    }
    if (hotZoomActive) {
      hotZoomIndex = -1;
      mangaHotPanelIdx = -1;
      requestAnimationFrame(applyBubbleOverlay);
    }
    if (mangaBubbleHotActive) {
      mangaBubbleHotIdx = -1;
      requestAnimationFrame(applyBubbleOverlay);
    }
  }

  // Persist that the *other* two modes are off. Without this, the auto-enable
  // logic in refreshGuidedToggle keeps flipping the most recently saved mode
  // back on after a page render.
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
    const data = await loadGuidedView(comic.id);
    if (!data) return false;

    // Guided View, Bubble Zoom, and Hot Zoom modes are mutually exclusive.
    if (hotZoomActive) disableHotZoom();
    if (bubbleActive) disableBubble();
    if (mangaBubbleHotActive) disableMangaBubbleHot();
    persistOnlyMode(comic, 'guided');

    active = true;
    panelIndex = -1; // start at full-page view
    applyClasses();
    requestAnimationFrame(applyTransform);
    updateToggleUI();
    return true;
  }

  function disable() {
    active = false;
    panelIndex = -1;
    applyClasses();
    updateToggleUI();
  }

  async function toggle() {
    if (active) { disable(); return false; }
    return enable();
  }

  function isActive() { return active; }

  async function saveGuidedMode(comicId, value) {
    try {
      await fetch(api(`/api/v1/comics/${encodeURIComponent(comicId)}/guided-mode`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guidedMode: !!value })
      });
    } catch (_) { /* non-fatal */ }
  }
  
  async function saveBubbleMode(comicId, value) {
    try {
      await fetch(api(`/api/v1/comics/${encodeURIComponent(comicId)}/bubble-mode`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bubbleMode: !!value })
      });
    } catch (_) { /* non-fatal */ }
  }

  function applyBubbleOverlay() {
    const stage = getStage();
    const img = getImg();
    if (!stage || !img) return;
    if (!img.naturalWidth || !img.naturalHeight) {
      img.addEventListener('load', applyBubbleOverlay, { once: true });
      return;
    }
    
    // Ensure standard fullscreen image is visible and centered if not in manga mode
    if (!active) {
      img.style.transform = '';
      img.classList.remove('guided-img');
    }
    
    let overlay = document.getElementById('bubble-magnifier-overlay');

    // Determine which box to magnify based on active mode.
    let targetBox = null;
    let isPanelZoom = false; // true = manga panel-level zoom (fit-to-overlay)
    if (manualOverrideBox) {
      // Double-click zoom is in effect — render at the synthetic box rather than
      // the per-mode panel/bubble.
      targetBox = manualOverrideBox;
    } else if (hotZoomActive && isMangaComic()) {
      const panels = classifyMangaPage();
      if (mangaHotPanelIdx >= 0 && panels[mangaHotPanelIdx]) {
        targetBox = panels[mangaHotPanelIdx].box;
        isPanelZoom = true;
      }
    } else if (mangaBubbleHotActive) {
      const bubbles = mangaPageBubbles();
      if (mangaBubbleHotIdx >= 0 && mangaBubbleHotIdx < bubbles.length) {
        targetBox = bubbles[mangaBubbleHotIdx];
      }
    } else if (active && !isMangaComic()) {
      const sequence = currentPagePanels();
      if (panelIndex >= 0 && panelIndex < sequence.length) targetBox = sequence[panelIndex];
    } else {
      const bubbles = currentPageBubbles();
      const index = bubbleActive ? bubbleIndex : hotZoomIndex;
      if (index >= 0 && index < bubbles.length) targetBox = bubbles[index];
    }

    if (!targetBox) {
      if (overlay) {
        // Fade out, then hide once the opacity transition completes — keeps
        // the closing animation smooth instead of snapping to display:none.
        overlay.style.opacity = '0';
        clearTimeout(overlay._hideTimer);
        overlay._hideTimer = setTimeout(() => {
          if (overlay.style.opacity === '0') overlay.style.display = 'none';
        }, 520);
      }
      img.style.filter = '';
      return;
    }

    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'bubble-magnifier-overlay';
      overlay.style.position = 'absolute';
      overlay.style.pointerEvents = 'none';
      overlay.style.zIndex = '10';
      overlay.style.borderRadius = '16px';
      overlay.style.boxShadow = '0 15px 50px rgba(0,0,0,0.9), 0 0 0 2px rgba(255,255,255,0.1)';
      overlay.style.overflow = 'hidden';
      // Chocolate-smooth easing (ease-out-quint) on every animatable property —
      // overlay slides + resizes + fades in concert with the inner image scale.
      overlay.style.willChange = 'transform, width, height, opacity';
      overlay.style.transition =
        'transform 950ms cubic-bezier(0.22, 1, 0.36, 1), ' +
        'width 700ms cubic-bezier(0.22, 1, 0.36, 1), ' +
        'height 700ms cubic-bezier(0.22, 1, 0.36, 1), ' +
        'opacity 500ms ease';
      overlay.style.backgroundColor = '#000';

      const innerImg = document.createElement('img');
      innerImg.id = 'bubble-magnifier-img';
      innerImg.style.position = 'absolute';
      innerImg.style.transformOrigin = '0 0';
      innerImg.style.maxWidth = 'none';
      innerImg.style.maxHeight = 'none';
      innerImg.style.willChange = 'transform';
      innerImg.style.transition = 'transform 950ms cubic-bezier(0.22, 1, 0.36, 1)';
      overlay.appendChild(innerImg);
      stage.appendChild(overlay);
    }

    clearTimeout(overlay._hideTimer);
    overlay.style.display = 'block';
    overlay.style.opacity = '1';

    const innerImg = document.getElementById('bubble-magnifier-img');
    innerImg.src = img.src;

    const [px, py, pw, ph] = targetBox;
    const cx = px + pw / 2;
    const cy = py + ph / 2;

    const stageW = stage.clientWidth;
    const stageH = stage.clientHeight;

    // Calculate the base scale of the background image (how it fits in the stage)
    const baseScale = Math.min(stageW / img.naturalWidth, stageH / img.naturalHeight);
    
    // The rendered dimensions and top offset of the image
    const renderedH = img.naturalHeight * baseScale;
    const imgTop = (stageH - renderedH) / 2;
    
    // Bubble center in absolute screen/stage pixels
    const bubbleStageCy = imgTop + (cy * baseScale);
    
    // Compute overlay size and zoom scale.
    //  - Panel zoom (manga, level 1): fit the whole panel inside a large overlay.
    //  - Bubble zoom (everything else): fixed 2.5x magnification with smart placement.
    let overlayW, overlayH, innerScale, targetX, targetY, overlayScale;
    if (isPanelZoom) {
      // Large overlay — close to fullscreen so the panel reads at proper size.
      overlayW = Math.min(stageW * 0.95, 1100);
      overlayH = Math.min(stageH * 0.85, 1400);
      const padding = 24;
      // Choose the scale that fits the panel inside the overlay (with padding).
      const fitScale = Math.min(
        (overlayW - padding * 2) / pw,
        (overlayH - padding * 2) / ph
      );
      // Don't shrink below 1:1 of the displayed page; cap a bit so very small
      // panels don't blow up to pixel mush.
      innerScale = Math.max(baseScale, Math.min(fitScale, baseScale * 4));
      // Center the overlay on the stage.
      targetX = (stageW - overlayW) / 2;
      targetY = (stageH - overlayH) / 2;
      overlayScale = 1;
    } else {
      const magScale = 2.5;
      const bubbleDisplayW = pw * baseScale * magScale;
      const bubbleDisplayH = ph * baseScale * magScale;

      overlayW = bubbleDisplayW + 60;
      overlayH = bubbleDisplayH + 60;

      const maxW = Math.min(stageW * 0.85, 550);
      const maxH = Math.min(stageH * 0.45, 350);
      const minW = 280;
      const minH = 160;
      overlayW = Math.min(Math.max(overlayW, minW), maxW);
      overlayH = Math.min(Math.max(overlayH, minH), maxH);

      targetX = (stageW - overlayW) / 2;
      const isTopHalf = bubbleStageCy < (stageH / 2);
      if (isTopHalf) {
        targetY = stageH - overlayH - 100;
      } else {
        targetY = 60;
      }
      innerScale = baseScale * magScale;
      overlayScale = 1.1;
    }

    overlay.style.width = `${Math.round(overlayW)}px`;
    overlay.style.height = `${Math.round(overlayH)}px`;
    overlay.style.left = '0px';
    overlay.style.top = '0px';
    overlay.style.transform = `translate(${Math.round(targetX)}px, ${Math.round(targetY)}px) scale(${overlayScale})`;

    // Transform the inner image so the target box is centered in the overlay.
    const innerTx = (overlayW / 2) - (cx * innerScale);
    const innerTy = (overlayH / 2) - (cy * innerScale);
    
    innerImg.style.width = `${img.naturalWidth}px`;
    innerImg.style.height = `${img.naturalHeight}px`;
    innerImg.style.left = '0px';
    innerImg.style.top = '0px';
    innerImg.style.transform = `translate(${Math.round(innerTx)}px, ${Math.round(innerTy)}px) scale(${innerScale})`;
  }

  function updateBubbleToggleUI() {
    const btn = document.getElementById('bubble-toggle-btn');
    if (!btn) return;
    btn.classList.toggle('active', bubbleActive);
    btn.setAttribute('aria-pressed', bubbleActive ? 'true' : 'false');

    const isMobile = typeof global.isMobileDevice === 'function' && global.isMobileDevice();
    if (isMobile) {
      btn.innerHTML = GUIDE_ICON_HTML;
    } else {
      btn.innerHTML = 'Bubble ' + ZOOM_ICON_HTML;
    }
  }

  function updateHotZoomToggleUI() {
    const btn = document.getElementById('hot-zoom-btn');
    if (!btn) return;
    btn.classList.toggle('active', hotZoomActive);
    btn.setAttribute('aria-pressed', hotZoomActive ? 'true' : 'false');

    const isMobile = typeof global.isMobileDevice === 'function' && global.isMobileDevice();
    if (isMobile) {
      btn.innerHTML = ZOOM_ICON_HTML;
    } else {
      btn.innerHTML = ZOOM_ICON_HTML;
    }
  }

  async function enableBubble() {
    if (!isFullscreenOpen()) return false;
    const comic = global.currentComic;
    if (!comic) return false;
    if (comic.guidedViewStatus !== 'completed') return false;
    if (comic.mangaMode) return false;
    const data = await loadGuidedView(comic.id);
    if (!data) return false;
    
    if (active) disable();
    if (hotZoomActive) disableHotZoom();
    if (mangaBubbleHotActive) disableMangaBubbleHot();
    persistOnlyMode(comic, 'bubble');

    bubbleActive = true;
    bubbleIndex = -1;
    updateBubbleToggleUI();
    applyZoomCss();
    requestAnimationFrame(applyBubbleOverlay);
    return true;
  }

  function disableBubble() {
    bubbleActive = false;
    bubbleIndex = -1;
    manualOverrideBox = null;
    updateBubbleToggleUI();
    applyZoomCss();
    applyBubbleOverlay();
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
    const data = await loadGuidedView(comic.id);
    if (!data) return false;

    if (active) disable();
    if (bubbleActive) disableBubble();
    if (mangaBubbleHotActive) disableMangaBubbleHot();
    persistOnlyMode(comic, 'hotZoom');

    hotZoomActive = true;
    hotZoomIndex = -1;
    mangaHotPanelIdx = -1;
    updateHotZoomToggleUI();
    applyClasses();
    requestAnimationFrame(applyBubbleOverlay);
    return true;
  }

  function disableHotZoom() {
    hotZoomActive = false;
    hotZoomIndex = -1;
    mangaHotPanelIdx = -1;
    manualOverrideBox = null;
    updateHotZoomToggleUI();
    applyClasses();
    applyBubbleOverlay();
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
    const data = await loadGuidedView(comic.id);
    if (!data) return false;

    if (active) disable();
    if (bubbleActive) disableBubble();
    if (hotZoomActive) disableHotZoom();
    persistOnlyMode(comic, 'mangaBubbleHot');

    mangaBubbleHotActive = true;
    mangaBubbleHotIdx = -1;
    updateMangaBubbleHotUI();
    applyClasses();
    requestAnimationFrame(applyBubbleOverlay);
    return true;
  }

  function disableMangaBubbleHot() {
    mangaBubbleHotActive = false;
    mangaBubbleHotIdx = -1;
    manualOverrideBox = null;
    updateMangaBubbleHotUI();
    applyClasses();
    applyBubbleOverlay();
  }

  async function toggleMangaBubbleHot() {
    if (mangaBubbleHotActive) { disableMangaBubbleHot(); return false; }
    return enableMangaBubbleHot();
  }

  function isMangaBubbleHotActive() { return mangaBubbleHotActive; }

  function updateMangaBubbleHotUI() {
    const btn = document.getElementById('manga-bubble-hot-btn');
    if (!btn) return;
    btn.classList.toggle('active', mangaBubbleHotActive);
    btn.setAttribute('aria-pressed', mangaBubbleHotActive ? 'true' : 'false');
    const isMobile = typeof global.isMobileDevice === 'function' && global.isMobileDevice();
    if (isMobile) {
      btn.innerHTML = SPEECH_BUBBLE_ICON_HTML;
    } else {
      btn.innerHTML = 'Bubble ' + SPEECH_BUBBLE_ICON_HTML;
    }
  }

  async function saveMangaBubbleHotMode(comicId, value) {
    try {
      await fetch(api(`/api/v1/comics/${encodeURIComponent(comicId)}/manga-bubble-hot-mode`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mangaBubbleHotMode: !!value })
      });
    } catch (_) { /* non-fatal */ }
  }

  async function saveHotZoomMode(comicId, value) {
    try {
      await fetch(api(`/api/v1/comics/${encodeURIComponent(comicId)}/hot-zoom-mode`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hotZoomMode: !!value })
      });
    } catch (_) { /* non-fatal */ }
  }

  function applyHotZoomTransform() {
    // Legacy stub - Western Zoom now uses applyBubbleOverlay
  }


  // Refresh button enabled state and auto-enable per saved preference.
  // Called after page renders + when fullscreen opens.
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

    // Use loose truthy check for mangaMode (database returns 0/1)
    const isManga = !!(comic && (comic.mangaMode === true || comic.mangaMode == 1));
    const processed = !!(comic && comic.guidedViewStatus === 'completed');
    const isContinuous = !!global.isContinuousMode;

    // Pre-load data if missing so we can check for bubbles/panels
    if (processed && !cache.has(comic.id)) {
      await loadGuidedView(comic.id);
    }

    const isDesktop = typeof global.isDesktopDevice === 'function' && global.isDesktopDevice();
    const data = cache.get(comic.id);

    if (btn) {
      const hasPanels = data && data.pages && Object.values(data.pages).some(p => {
        if (Array.isArray(p)) return p.length > 0;
        return p && p.panels && p.panels.length > 0;
      });
      // Sequential pan/zoom (btn) — "Manga Guide". Hidden in continuous mode.
      const ready = isManga && processed && hasPanels && !isContinuous;

      btn.style.display = ready ? 'flex' : 'none';
      btn.disabled = !ready;
      
      if (isDesktop) btn.innerHTML = 'Gem ' + GUIDE_ICON_HTML;
      else btn.innerHTML = GUIDE_ICON_HTML;
      
    }

    if (bubbleBtn) {
      const hasBubbles = data && data.pages && Object.values(data.pages).some(p => p && p.bubbles && p.bubbles.length > 0);
      const hasSequence = data && data.pages && Object.values(data.pages).some(p => p && p.sequence && p.sequence.length > 0);
      // Bubble Zoom (Western Guide). Hidden in continuous and manga.
      const bubbleReady = !isManga && processed && (hasBubbles || hasSequence) && !isContinuous;
      
      bubbleBtn.style.display = bubbleReady ? 'flex' : 'none';
      bubbleBtn.disabled = !bubbleReady;
      
      if (isDesktop) bubbleBtn.innerHTML = 'Bubble ' + ZOOM_ICON_HTML;
      else bubbleBtn.innerHTML = GUIDE_ICON_HTML;
      
    }

    if (hotZoomBtn) {
      const hasBubbles = data && data.pages && Object.values(data.pages).some(p => p && p.bubbles && p.bubbles.length > 0);
      const hasMangaBoxes = data && data.pages && Object.values(data.pages).some(p => p && Array.isArray(p.panels) && p.panels.length > 0);
      // Hot Zoom — Western: click bubble to zoom; Manga: click panel to zoom.
      // Both modes are wired in handleImageClick / applyBubbleOverlay below.
      const hotZoomReady = processed && (isManga ? hasMangaBoxes : hasBubbles)
        && !isContinuous;

      hotZoomBtn.style.display = hotZoomReady ? 'flex' : 'none';
      hotZoomBtn.disabled = !hotZoomReady;

      if (isDesktop) hotZoomBtn.innerHTML = isManga ? 'Panel ' + ZOOM_ICON_HTML : ZOOM_ICON_HTML;
      else hotZoomBtn.innerHTML = isManga ? 'Panel' : ZOOM_ICON_HTML;

    }

    if (mangaBubbleHotBtn) {
      const hasMangaBoxes = data && data.pages && Object.values(data.pages).some(p => p && Array.isArray(p.panels) && p.panels.length > 0);
      // Manga Bubbles is exclusive to Manga
      const ready = isManga && processed && hasMangaBoxes;
      mangaBubbleHotBtn.style.display = ready ? 'flex' : 'none';
      mangaBubbleHotBtn.disabled = !ready;
      const isMobile = typeof global.isMobileDevice === 'function' && global.isMobileDevice();
      if (isMobile) {
        mangaBubbleHotBtn.innerHTML = SPEECH_BUBBLE_ICON_HTML;
      } else {
        mangaBubbleHotBtn.innerHTML = 'Bubble ' + SPEECH_BUBBLE_ICON_HTML;
      }
    }

    if (!isFullscreenOpen()) {
      if (active) disable();
      if (bubbleActive) disableBubble();
      if (hotZoomActive) disableHotZoom();
      if (mangaBubbleHotActive) disableMangaBubbleHot();
      updateToggleUI();
      updateBubbleToggleUI();
      updateHotZoomToggleUI();
      updateMangaBubbleHotUI();
      return;
    }
    
    // Auto-enable based on saved preference (loose truthy check)
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

    updateToggleUI();
    updateBubbleToggleUI();
    updateHotZoomToggleUI();
    updateMangaBubbleHotUI();
  }

  function bindToggleButton() {
    const btn = document.getElementById('guided-toggle-btn');
    if (btn && !btn._guidedBound) {
      btn._guidedBound = true;
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const comic = global.currentComic;
        const fsOpen = isFullscreenOpen();
        if (!comic || comic.guidedViewStatus !== 'completed' || !fsOpen) {
          return;
        }
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
        const fsOpen = isFullscreenOpen();
        if (!comic || comic.guidedViewStatus !== 'completed' || !!comic.mangaMode || !fsOpen) {
          return;
        }
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
        const fsOpen = isFullscreenOpen();
        if (!comic || comic.guidedViewStatus !== 'completed' || !comic.mangaMode || !fsOpen) return;
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
        const fsOpen = isFullscreenOpen();
        if (!comic || comic.guidedViewStatus !== 'completed' || !fsOpen) {
          return;
        }
        const willActivate = !hotZoomActive;
        if (willActivate) await enableHotZoom(); else disableHotZoom();
        comic.hotZoomMode = willActivate;
        if (typeof global.updateComicInLibrary === 'function') global.updateComicInLibrary(comic.id, { hotZoomMode: willActivate });
        saveHotZoomMode(comic.id, willActivate);
      });
    }
  }

  // Watch for fullscreen open/close — when it opens, refresh; when it closes,
  // disable so leftover transforms don't leak into other UI.
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
      }
    });
    observer.observe(fv, { attributes: true, attributeFilter: ['class'] });
    fv._guidedObserver = observer;
  }

  // True when a guided zoom mode is currently *engaged* on a target (a panel/bubble
  // is selected, or a synthetic dbl-click box is showing). Used by fullscreen side-nav
  // to suppress page navigation while the user is reading a zoom — they expect a tap
  // to exit zoom, not flip pages.
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

    // A double-click set a synthetic zoom box. Any single click while it's showing
    // exits the zoom — regardless of whether the click landed on the image or in
    // the letterbox. BUT: skip the click that's the second-half of the very
    // dblclick that just set the box (mobile fires click2 right after pointerup2,
    // which would otherwise immediately clear the zoom we just engaged).
    if (manualOverrideBox) {
      const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
      if (now - lastDblZoomAt < 500) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      manualOverrideBox = null;
      requestAnimationFrame(applyBubbleOverlay);
      return;
    }

    const img = getImg();
    if (!img || !img.naturalWidth) return;

    const rect = img.getBoundingClientRect();
    // Click outside the image (the black letterbox area on top/bottom/sides)
    // shouldn't be intercepted by guided modes — surface the fullscreen
    // controls instead so the user can still reach landscape, continuous, etc.
    const outsideImage =
      e.clientX < rect.left || e.clientX > rect.right ||
      e.clientY < rect.top || e.clientY > rect.bottom;
    if (outsideImage) {
      global.showFullscreenControls?.(true);
      return;
    }

    // rx, ry are relative to the image's top-left on screen
    const rx = e.clientX - rect.left;
    const ry = e.clientY - rect.top;

    // Convert to natural image coordinates (0..naturalWidth, 0..naturalHeight)
    const nx = rx * (img.naturalWidth / rect.width);
    const ny = ry * (img.naturalHeight / rect.height);

    // Check hit against current page's sequence or bubbles
    if (bubbleActive) {
      // Western mode: Jump to specific bubble in sequence
      const bubbles = currentPageBubbles();
      for (let i = 0; i < bubbles.length; i++) {
        const [bx, by, bw, bh] = bubbles[i];
        if (nx >= bx && nx <= bx + bw && ny >= by && ny <= by + bh) {
          e.preventDefault();
          e.stopPropagation();
          bubbleIndex = i;
          applyBubbleOverlay();
          return;
        }
      }
    } else if (mangaBubbleHotActive) {
      // Manga Bubble Hot Zoom: click any speech bubble to zoom; click empty
      // space (while zoomed) to zoom out. Same micro-magnifier UX as Western.
      const bubbles = mangaPageBubbles();
      let bestIdx = -1, minArea = Infinity;
      for (let i = 0; i < bubbles.length; i++) {
        const [bx, by, bw, bh] = bubbles[i];
        if (nx >= bx && nx <= bx + bw && ny >= by && ny <= by + bh) {
          const area = bw * bh;
          if (area < minArea) { minArea = area; bestIdx = i; }
        }
      }
      if (bestIdx !== -1) {
        e.preventDefault();
        e.stopPropagation();
        mangaBubbleHotIdx = (mangaBubbleHotIdx === bestIdx) ? -1 : bestIdx;
        applyBubbleOverlay();
        return;
      }
      if (mangaBubbleHotIdx !== -1) {
        e.preventDefault();
        e.stopPropagation();
        mangaBubbleHotIdx = -1;
        applyBubbleOverlay();
      }
      return;
    } else if (hotZoomActive && isMangaComic()) {
      // Manga Hot Zoom: single-level zoom (page → panel). Click a panel to
      // zoom in; click anywhere while zoomed to zoom back out.
      const panels = classifyMangaPage();
      if (panels.length === 0) return;

      if (mangaHotPanelIdx >= 0) {
        e.preventDefault();
        e.stopPropagation();
        mangaHotPanelIdx = -1;
        applyBubbleOverlay();
        return;
      }

      // Page level: pick the smallest panel containing the click. Clicking on
      // a child bubble naturally falls inside its parent panel and resolves
      // to that panel.
      let bestIdx = -1, bestArea = Infinity;
      for (let i = 0; i < panels.length; i++) {
        const [px, py, pw, ph] = panels[i].box;
        if (nx >= px && nx <= px + pw && ny >= py && ny <= py + ph) {
          const area = pw * ph;
          if (area < bestArea) { bestArea = area; bestIdx = i; }
        }
      }
      if (bestIdx >= 0) {
        e.preventDefault();
        e.stopPropagation();
        mangaHotPanelIdx = bestIdx;
        applyBubbleOverlay();
      }
      return;
    } else if (hotZoomActive) {
      // Western mode: Hot Zoom (Interactive click)
      const bubbles = currentPageBubbles();
      let bestIndex = -1;
      let minArea = Infinity;

      for (let i = 0; i < bubbles.length; i++) {
        const [bx, by, bw, bh] = bubbles[i];
        if (nx >= bx && nx <= bx + bw && ny >= by && ny <= by + bh) {
          const area = bw * bh;
          if (area < minArea) {
            minArea = area;
            bestIndex = i;
          }
        }
      }

      if (bestIndex !== -1) {
        e.preventDefault();
        e.stopPropagation();
        // If already zoomed to this bubble, zoom out to full page
        if (hotZoomIndex === bestIndex) {
          hotZoomIndex = -1;
        } else {
          hotZoomIndex = bestIndex;
        }
        applyBubbleOverlay();
        return;
      } else {
        // Clicked empty space while in Hot Zoom - zoom out
        if (hotZoomIndex !== -1) {
          e.preventDefault();
          e.stopPropagation();
          hotZoomIndex = -1;
          applyBubbleOverlay();
        }
      }
    }
    // Manga guided mode: no hotspot click. Next/Prev (button, keyboard, tap-zones)
    // walks the panel/bubble sequence and falls through to page nav at the boundary.
  }

  function init() {
    bindToggleButton();
    watchFullscreenToggle();

    // Add hot-zoom listener to the stage (parent of image)
    const stage = getStage();
    if (stage) {
      stage.addEventListener('click', handleImageClick, true);
      // While any zoom mode is active, suppress the touch-and-hold context menu
      // / iOS callout. Long-press is wired to page navigation; the OS's own
      // long-press shouldn't pop up "Save image" or selection handles over the
      // comic.
      stage.addEventListener('contextmenu', (e) => {
        if (active || bubbleActive || hotZoomActive || mangaBubbleHotActive) {
          e.preventDefault();
        }
      });
    }

    // CSS toggles to disable the iOS callout, image selection and the
    // browser's native "selectstart" while in any zoom mode. Class is added
    // by enable*/disable* via applyZoomCss below.
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
  function applyZoomCss() {
    const stage = getStage();
    if (!stage) return;
    const on = active || bubbleActive || hotZoomActive || mangaBubbleHotActive;
    stage.classList.toggle('guided-zoom-no-touchmenu', on);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  // Turn off all guided modes (memory + persistence). Used by continuous and
  // landscape toggles which are incompatible with any guided overlay.
  function disableAll() {
    const comic = global.currentComic;
    if (active) disable();
    if (bubbleActive) disableBubble();
    if (hotZoomActive) disableHotZoom();
    if (mangaBubbleHotActive) disableMangaBubbleHot();
    if (comic) persistOnlyMode(comic, null);
  }

  global.GuidedView = {
    loadGuidedView, enable, disable, toggle, tryAdvance, onPageRendered,
    applyTransform, isActive, refreshGuidedToggle,
    enableBubble, disableBubble, toggleBubble, isBubbleActive, applyBubbleOverlay,
    enableHotZoom, disableHotZoom, toggleHotZoom, isHotZoomActive, applyHotZoomTransform,
    enableMangaBubbleHot, disableMangaBubbleHot, toggleMangaBubbleHot, isMangaBubbleHotActive,
    disableAll, isZoomEngaged, isAnyGuidedActive
  };
  global.tryGuidedAdvance = tryAdvance;
  global.onGuidedPageRendered = onPageRendered;
  global.toggleGuidedView = toggle;
  global.toggleBubbleView = toggleBubble;
  global.toggleHotZoomView = toggleHotZoom;
  global.refreshGuidedToggle = refreshGuidedToggle;

  window.addEventListener('resize', () => {
    if (active) requestAnimationFrame(applyTransform);
    if (bubbleActive) requestAnimationFrame(applyBubbleOverlay);
    if (hotZoomActive) requestAnimationFrame(applyHotZoomTransform);
  });

  // Double-click anywhere on the page to trigger a synthetic zoom in HotZoom /
  // Bubble / MangaBubbleHot modes. Renders via the existing bubble-magnifier-overlay
  // path (same CSS as the normal per-bubble zoom in those modes), centered on
  // the click point. A second dblclick clears it.
  let lastDblZoomAt = 0;
  function handleDoubleClickZoom(event) {
    if (global.isFullImageMode) return;
    if (!hotZoomActive && !bubbleActive && !mangaBubbleHotActive) return;
    const img = getImg();
    if (!img || !img.naturalWidth || !img.naturalHeight) return;

    // Dedupe: the manual pointerup-based dbltap detector and the native
    // `dblclick` both fire on desktop, which would otherwise toggle off then
    // immediately back on. Swallow anything <250ms after the previous run.
    const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    if (now - lastDblZoomAt < 250) return;
    lastDblZoomAt = now;

    // Cancel a pending side-tap page navigation queued by fullscreen.js for the
    // first click of this double-click pair.
    if (typeof global.cancelPendingSideNav === 'function') global.cancelPendingSideNav();

    // For pointerup (the manual touch dbltap path) we MUST NOT stop propagation —
    // doing so prevents `handleFullscreenPointerUp` from running, leaving stale
    // entries in `fullscreenTouchPointers`, which makes the next long-press
    // abort with `size > 1`. preventDefault is fine on a real click/dblclick.
    const isPointerEvt = event && (event.type === 'pointerup' || event.type === 'pointerdown');

    if (manualOverrideBox) {
      manualOverrideBox = null;
      if (!isPointerEvt) { event.preventDefault?.(); event.stopPropagation?.(); }
      requestAnimationFrame(applyBubbleOverlay);
      return;
    }

    const rect = img.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    // Click position as a 0..1 ratio inside the displayed image bounds.
    const ratioX = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    const ratioY = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));

    // Roughly 2.5x zoom — box is 40% of natural dimensions, centered on the
    // click. Intentionally NOT clamped to the image bounds so the user can
    // zoom on the very top/bottom/edges of the page; the overlay's black
    // background covers any portion of the box that falls off the image.
    const boxW = img.naturalWidth * 0.4;
    const boxH = img.naturalHeight * 0.4;
    const cx = ratioX * img.naturalWidth;
    const cy = ratioY * img.naturalHeight;
    const x = cx - boxW / 2;
    const y = cy - boxH / 2;

    manualOverrideBox = [x, y, boxW, boxH];
    if (!isPointerEvt) { event.preventDefault?.(); event.stopPropagation?.(); }
    requestAnimationFrame(applyBubbleOverlay);
  }

  // Manual double-tap detection at a 300 ms threshold. We don't trust the
  // browser's native dblclick — on touch, the threshold varies by device and
  // sometimes the event never fires after long-press wins. By owning the
  // timing we get the same behavior on desktop and mobile.
  const DOUBLE_TAP_MS = 300;
  const DOUBLE_TAP_MOVE_TOLERANCE = 30; // px between two taps to still pair them
  let lastTapAt = 0;
  let lastTapX = 0;
  let lastTapY = 0;

  function handlePointerUpForDblTap(event) {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (!hotZoomActive && !bubbleActive && !mangaBubbleHotActive) {
      lastTapAt = 0;
      return;
    }
    const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    const dx = event.clientX - lastTapX;
    const dy = event.clientY - lastTapY;
    const within = (now - lastTapAt) <= DOUBLE_TAP_MS &&
                   (dx * dx + dy * dy) <= (DOUBLE_TAP_MOVE_TOLERANCE * DOUBLE_TAP_MOVE_TOLERANCE);
    if (within) {
      lastTapAt = 0;
      handleDoubleClickZoom(event);
      return;
    }
    lastTapAt = now;
    lastTapX = event.clientX;
    lastTapY = event.clientY;
  }
  document.addEventListener('pointerup', handlePointerUpForDblTap, { capture: true });
  // Keep native dblclick wired for desktop fallback (e.g. trackpad gestures
  // that synthesize dblclick without distinct pointerup pairs).
  document.addEventListener('dblclick', handleDoubleClickZoom, { capture: true });
})(typeof window !== 'undefined' ? window : globalThis);
