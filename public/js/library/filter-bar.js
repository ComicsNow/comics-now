// filter-bar.js - Consolidated filter bar with expand/collapse toggle

export function initFilterConsolidation() {
  const toggle = document.getElementById('filter-expand-toggle');
  const container = document.getElementById('filters-container');
  if (!toggle || !container) return;

  // Idempotency check: don't attach duplicate listeners
  if (toggle._hasFilterBarListener) return;
  toggle._hasFilterBarListener = true;

  // Initialize state if not set
  if (!container.dataset.expanded) {
    container.dataset.expanded = 'false';
    toggle.setAttribute('aria-expanded', 'false');
  }

  // Handle click toggle
  toggle.addEventListener('click', () => {
    const isExpanded = toggle.getAttribute('aria-expanded') === 'true';
    const nextState = !isExpanded;

    toggle.setAttribute('aria-expanded', String(nextState));
    container.dataset.expanded = String(nextState);
    container.classList.toggle('filters-expanded', nextState);
    container.classList.toggle('filters-collapsed', !nextState);

    // Rotate chevron icon
    const icon = toggle.querySelector('svg');
    if (icon) {
      icon.style.transform = nextState ? 'rotate(180deg)' : 'rotate(0deg)';
    }

    // Toggle smart-filter-host multi-row visibility if applicable
    const smartHost = document.getElementById('smart-filter-host');
    if (smartHost) {
      smartHost.classList.toggle('expanded-in-filter-bar', nextState);
    }
  });
}

if (typeof window !== 'undefined') {
  window.initFilterConsolidation = initFilterConsolidation;
}

// Auto-initialize if DOM is ready
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initFilterConsolidation);
  } else {
    initFilterConsolidation();
  }
}
