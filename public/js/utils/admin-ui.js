// public/js/utils/admin-ui.js
import { state } from '../globals.js';

const global = new Proxy(typeof window !== 'undefined' ? window : globalThis, {
  get(target, prop) {
    if (prop === 'state') return state;
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

// --- HIDE ADMIN UI FOR NON-ADMINS ---
export function hideAdminUI() {
  if (!global.syncManager || !global.syncManager.authEnabled) {
    return;
  }

  if (global.syncManager.userRole === "admin") {
    if (global.APP_CONFIG && global.APP_CONFIG.hideSupportForAdmin) {
      const sl = document.getElementById("support-link");
      if (sl) sl.style.display = "none";
    }
    return;
  }

  // User is NOT admin - hide admin controls

  // Hide CT (ComicTagger) button (admin only)
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
