(function (global) {
  'use strict';

  if (!global.GuidedView) global.GuidedView = {};

  let isPanning = false;
  let startX = 0, startY = 0;
  let initialBox = null;
  let justPanned = false;
  let rafId = null;
  const activePointers = new Map();

  // Current calculated box to be rendered
  let targetBox = null;

  function getOverlay() { return document.getElementById('bubble-magnifier-overlay'); }
  function getImg() { return document.getElementById('bubble-magnifier-img'); }

  function getMidpoint() {
    if (activePointers.size === 0) return { x: 0, y: 0 };
    let sumX = 0, sumY = 0;
    activePointers.forEach(p => {
      sumX += p.x;
      sumY += p.y;
    });
    return { x: sumX / activePointers.size, y: sumY / activePointers.size };
  }

  function update() {
    if (!isPanning) {
      rafId = null;
      if (global.GuidedView) global.GuidedView.isPanning = false;
      return;
    }

    if (global.GuidedView) global.GuidedView.isPanning = true;

    if (targetBox) {
      const registry = global.GuidedView.ModeRegistry;
      registry.setManualOverrideBox(targetBox);
      if (typeof global.GuidedView.refreshRender === 'function') {
        global.GuidedView.refreshRender();
      }
    }

    rafId = requestAnimationFrame(update);
  }

  function handlePointerDown(e) {
    const overlay = getOverlay();
    if (!overlay || overlay.style.display === 'none' || overlay.style.opacity === '0') return;
    
    const isRightClick = e.pointerType === 'mouse' && e.button === 2;
    const isTouch = e.pointerType === 'touch';
    
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    const isTwoFingerPan = isTouch && activePointers.size === 2;

    if (isRightClick || isTwoFingerPan) {
      isPanning = true;
      if (global.GuidedView) global.GuidedView.isPanning = true;
      justPanned = false;
      const registry = global.GuidedView.ModeRegistry;
      const currentBox = registry.getManualOverrideBox();
      if (!currentBox) {
        isPanning = false;
        return;
      }
      
      initialBox = [...currentBox];
      targetBox = [...currentBox];
      
      const mid = getMidpoint();
      startX = mid.x;
      startY = mid.y;
      
      overlay.setPointerCapture(e.pointerId);
      e.preventDefault();
      e.stopPropagation();

      if (!rafId) rafId = requestAnimationFrame(update);
    }
  }

  function handlePointerMove(e) {
    if (activePointers.has(e.pointerId)) {
      activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }

    if (!isPanning) return;
    
    e.stopPropagation();

    const mid = getMidpoint();
    const dx = mid.x - startX;
    const dy = mid.y - startY;

    if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
      justPanned = true;
    }

    const innerImg = getImg();
    if (!innerImg) return;
    
    const transform = innerImg.style.transform;
    const match = transform.match(/scale\(([^)]+)\)/);
    const scale = match ? parseFloat(match[1]) : 1;

    // Update targetBox for the next RAF frame
    targetBox = [
      initialBox[0] - (dx / scale),
      initialBox[1] - (dy / scale),
      initialBox[2],
      initialBox[3]
    ];
  }

  function handlePointerUp(e) {
    if (isPanning) {
      e.stopPropagation();
      const isRightClick = e.pointerType === 'mouse' && e.button === 2;
      const isTouch = e.pointerType === 'touch';
      
      if (isRightClick || (isTouch && activePointers.size <= 2)) {
        isPanning = false;
        const overlay = getOverlay();
        if (overlay && typeof overlay.releasePointerCapture === 'function') {
          try { overlay.releasePointerCapture(e.pointerId); } catch (_) {}
        }
        
        if (justPanned) {
          setTimeout(() => { justPanned = false; }, 50);
        }
      }
    }
    activePointers.delete(e.pointerId);
  }

  function handleStageClick(e) {
    if (justPanned) {
      e.preventDefault();
      e.stopPropagation();
      justPanned = false;
    }
  }

  function init() {
    const stage = document.getElementById('fullscreen-viewer');
    if (stage) {
      // Use capture phase to ensure we get events before other handlers
      stage.addEventListener('pointerdown', handlePointerDown, true);
      stage.addEventListener('pointermove', handlePointerMove, true);
      stage.addEventListener('pointerup', handlePointerUp, true);
      stage.addEventListener('pointercancel', handlePointerUp, true);
      stage.addEventListener('click', handleStageClick, true);
      
      // Prevent context menu on the stage when a guided mode is active
      stage.addEventListener('contextmenu', (e) => {
        const overlay = getOverlay();
        if (overlay && overlay.style.display !== 'none' && overlay.style.opacity !== '0') {
          e.preventDefault();
        }
      }, true);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

})(typeof window !== 'undefined' ? window : globalThis);
