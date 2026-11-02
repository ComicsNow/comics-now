// public/js/utils/admin-ui.js
import { state, global as canonicalGlobal } from '../globals.js';

const global = typeof canonicalGlobal !== 'undefined' ? canonicalGlobal : new Proxy(typeof window !== 'undefined' ? window : globalThis, {
  get: (t, p) => (typeof state !== 'undefined' && p in state) ? state[p] : t[p],
  set: (t, p, v) => { if (typeof state !== 'undefined') state[p] = v; try { t[p] = v; } catch {} return true; }
});

// --- HIDE ADMIN UI FOR NON-ADMINS ---
export function hideAdminUI() {
  if (global.APP_CONFIG && global.APP_CONFIG.hideSupportForAdmin) {
    const ksl = document.getElementById("kofi-settings-link");
    if (ksl) ksl.style.display = "none";
  }

  if (!global.syncManager || !global.syncManager.authEnabled) {
    return;
  }

  if (global.syncManager.userRole === "admin") {
    return;
  }

  // User is NOT admin - hide admin controls

  // Hide CT (Tag Comics Now!) button (admin only)
  const ctButton = document.getElementById('ct-button');
  if (ctButton) {
    ctButton.style.display = 'none';
  }

  // Hide admin-only tabs in settings modal
  const adminTabs = [
    'settings-tab-general',
    'settings-tab-logs',
    'settings-tab-users',
    'settings-tab-guided-reader',
    'metadata-tab'
  ];

  adminTabs.forEach(tabId => {
    const tab = document.getElementById(tabId);
    if (tab) {
      tab.remove();
    }
  });

  // Hide admin-only tab content
  const adminTabContent = [
    'settings-content-general',
    'settings-content-logs',
    'settings-content-users',
    'settings-content-guided-reader',
    'metadata-content'
  ];

  adminTabContent.forEach(contentId => {
    const content = document.getElementById(contentId);
    if (content) {
      content.remove();
    }
  });

  // Hide admin-only sections in the Comics Defaults tab
  const adminDefaultSections = [
    'settings-defaults-formats',
    'settings-defaults-metadata'
  ];

  adminDefaultSections.forEach(sectionId => {
    const section = document.getElementById(sectionId);
    if (section) {
      section.remove();
    }
  });
}

// Register on state/window just like original app.js did
state.hideAdminUI = hideAdminUI;
if (typeof window !== 'undefined') {
  window.hideAdminUI = hideAdminUI;
}
