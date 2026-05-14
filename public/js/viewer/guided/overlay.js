/**
 * Guided View Overlay & Rendering Engine
 * 
 * Handles all DOM manipulation, CSS transforms, and UI state updates for 
 * Guided View modes. Designed to be "pure" where possible, driven by 
 * parameters rather than reading global state directly.
 */
(function (global) {
  'use strict';

  global.GuidedView = global.GuidedView || {};

  const ZOOM_ICON_HTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line><line x1="11" y1="8" x2="11" y2="14"></line><line x1="8" y1="11" x2="14" y2="11"></line></svg>`;
  const SPEECH_BUBBLE_ICON_HTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>`;
  const GUIDE_ICON_HTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="7" r="2"></circle><path d="M9 9v7"></path><path d="M6 12l3-2 3 2"></path><path d="M7 21l2-5 2 5"></path><line x1="13" y1="3" x2="13" y2="21"></line><path d="M13 4l7 3-7 3"></path></svg>`;

  function getStage() { return document.getElementById('fullscreen-viewer'); }
  function getImg() { return document.getElementById('fullscreen-image'); }

  /**
   * Updates the main image transform for Manga/Sequential pan-zoom.
   * If targetBox is null, resets to "Full-page view" (contain) if isManga is true,
   * otherwise clears the transform.
   */
  function applyTransform(targetBox, isManga) {
    const stage = getStage();
    const img = getImg();
    if (!stage || !img) return;

    if (!img.naturalWidth || !img.naturalHeight) {
      img.addEventListener('load', () => applyTransform(targetBox, isManga), { once: true });
      return;
    }

    const stageW = stage.clientWidth;
    const stageH = stage.clientHeight;
    if (!stageW || !stageH) return;

    if (!targetBox) {
      if (isManga) {
        // Full-page view: contain the whole image inside the stage, centered.
        const s = Math.min(stageW / img.naturalWidth, stageH / img.naturalHeight);
        const tx = (stageW - img.naturalWidth * s) / 2;
        const ty = (stageH - img.naturalHeight * s) / 2;
        img.style.transform = `translate(${tx}px, ${ty}px) scale(${s})`;
      } else {
        img.style.transform = '';
      }
      return;
    }

    let [px, py, pw, ph] = targetBox;
    if (pw <= 0) pw = img.naturalWidth;
    if (ph <= 0) ph = img.naturalHeight;

    const margin = 0.04;
    const targetW = stageW * (1 - margin * 2);
    const targetH = stageH * (1 - margin * 2);
    
    // Cap scale to 4x
    let s = Math.min(targetW / pw, targetH / ph);
    if (s > 4.0) s = 4.0;

    const cx = px + pw / 2;
    const cy = py + ph / 2;
    const tx = stageW / 2 - cx * s;
    const ty = stageH / 2 - cy * s;
    img.style.transform = `translate(${tx}px, ${ty}px) scale(${s})`;
  }

  /**
   * Renders the "magnifier" overlay for Bubble Zoom, Hot Zoom, and Western sequential.
   * targetBox: [x, y, w, h] in natural image coords.
   * isPanelZoom: boolean, if true fits box to overlay (Manga style), else fixed 2.5x magnification.
   */
  function applyBubbleOverlay(targetBox, isPanelZoom) {
    const stage = getStage();
    const img = getImg();
    if (!stage || !img) return;
    
    if (!img.naturalWidth || !img.naturalHeight) {
      img.addEventListener('load', () => applyBubbleOverlay(targetBox, isPanelZoom), { once: true });
      return;
    }
    
    let overlay = document.getElementById('bubble-magnifier-overlay');

    if (!targetBox) {
      if (overlay) {
        overlay.style.opacity = '0';
        clearTimeout(overlay._hideTimer);
        overlay._hideTimer = setTimeout(() => {
          if (overlay.style.opacity === '0') overlay.style.display = 'none';
        }, 520);
      }
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

    const baseScale = Math.min(stageW / img.naturalWidth, stageH / img.naturalHeight);
    const renderedH = img.naturalHeight * baseScale;
    const imgTop = (stageH - renderedH) / 2;
    const bubbleStageCy = imgTop + (cy * baseScale);
    
    let overlayW, overlayH, innerScale, targetX, targetY, overlayScale;
    if (isPanelZoom) {
      overlayW = Math.min(stageW * 0.95, 1100);
      overlayH = Math.min(stageH * 0.85, 1400);
      const padding = 24;
      const fitScale = Math.min(
        (overlayW - padding * 2) / pw,
        (overlayH - padding * 2) / ph
      );
      innerScale = Math.max(baseScale, Math.min(fitScale, baseScale * 4));
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

    const innerTx = (overlayW / 2) - (cx * innerScale);
    const innerTy = (overlayH / 2) - (cy * innerScale);
    
    innerImg.style.width = `${img.naturalWidth}px`;
    innerImg.style.height = `${img.naturalHeight}px`;
    innerImg.style.left = '0px';
    innerImg.style.top = '0px';
    innerImg.style.transform = `translate(${Math.round(innerTx)}px, ${Math.round(innerTy)}px) scale(${innerScale})`;
  }

  function applyClasses(needsGuidedLayout) {
    const stage = getStage();
    const img = getImg();

    if (stage) stage.classList.toggle('guided-stage', !!needsGuidedLayout);
    if (img) {
      img.classList.toggle('guided-img', !!needsGuidedLayout);
      if (needsGuidedLayout) {
        img.classList.remove('orientation-landscape');
      } else {
        img.style.transform = '';
        if (global.isLandscapeOrientation) img.classList.add('orientation-landscape');
      }
    }
  }

  function applyZoomCss(isActive) {
    const stage = getStage();
    if (!stage) return;
    stage.classList.toggle('guided-zoom-no-touchmenu', !!isActive);
  }

  function updateToggleUI(active) {
    const btn = document.getElementById('guided-toggle-btn');
    if (!btn) return;
    btn.classList.toggle('active', !!active);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    
    const isDesktop = typeof global.isDesktopDevice === 'function' && global.isDesktopDevice();
    btn.innerHTML = (isDesktop ? 'Gem ' : '') + GUIDE_ICON_HTML;
  }

  function updateBubbleToggleUI(active) {
    const btn = document.getElementById('bubble-toggle-btn');
    if (!btn) return;
    btn.classList.toggle('active', !!active);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');

    const isDesktop = typeof global.isDesktopDevice === 'function' && global.isDesktopDevice();
    if (isDesktop) {
      btn.innerHTML = 'Bubble ' + ZOOM_ICON_HTML;
    } else {
      btn.innerHTML = ZOOM_ICON_HTML;
    }
  }

  function updateHotZoomToggleUI(active) {
    const btn = document.getElementById('hot-zoom-btn');
    if (!btn) return;
    btn.classList.toggle('active', !!active);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    
    const isDesktop = typeof global.isDesktopDevice === 'function' && global.isDesktopDevice();
    const isManga = global.currentComic && (global.currentComic.mangaMode === true || global.currentComic.mangaMode == 1);
    
    if (isDesktop) {
      btn.innerHTML = (isManga ? 'Panel ' : '') + ZOOM_ICON_HTML;
    } else {
      btn.innerHTML = ZOOM_ICON_HTML;
    }
  }

  function updateMangaBubbleHotUI(active) {
    const btn = document.getElementById('manga-bubble-hot-btn');
    if (!btn) return;
    btn.classList.toggle('active', !!active);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    
    const isDesktop = typeof global.isDesktopDevice === 'function' && global.isDesktopDevice();
    if (isDesktop) {
      btn.innerHTML = 'Bubble ' + SPEECH_BUBBLE_ICON_HTML;
    } else {
      btn.innerHTML = SPEECH_BUBBLE_ICON_HTML;
    }
  }

  // Attach to global namespace
  Object.assign(global.GuidedView, {
    applyTransform,
    applyBubbleOverlay,
    applyClasses,
    applyZoomCss,
    updateToggleUI,
    updateBubbleToggleUI,
    updateHotZoomToggleUI,
    updateMangaBubbleHotUI
  });

})(typeof window !== 'undefined' ? window : globalThis);
