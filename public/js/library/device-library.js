import { state } from '../globals.js';
import {
  DEVICE_LIBRARIES_STORE,
  DEVICE_COMICS_STORE,
  saveLegacyDeviceLibrary,
  saveDeviceLibrary,
  scanDeviceLibrary,
  getDeviceLibraries,
  getDeviceComics,
  removeDeviceLibrary
} from './device/storage.js';
import {
  appendDeviceLibraryCards,
  reattachLegacyLibrary,
  showDeviceLibraryComics,
  renderLocalComicList
} from './device/ui.js';

export {
  DEVICE_LIBRARIES_STORE,
  DEVICE_COMICS_STORE,
  saveLegacyDeviceLibrary,
  saveDeviceLibrary,
  scanDeviceLibrary,
  getDeviceLibraries,
  getDeviceComics,
  removeDeviceLibrary,
  appendDeviceLibraryCards,
  reattachLegacyLibrary,
  showDeviceLibraryComics,
  renderLocalComicList
};

/**
 * Request access to a local directory or files (Cross-Platform)
 */
export async function requestDeviceLibrary() {
  const showRootFolderList = state.showRootFolderList || (typeof window !== 'undefined' ? window.showRootFolderList : null);
  const applyFilterAndRender = state.applyFilterAndRender || (typeof window !== 'undefined' ? window.applyFilterAndRender : null);

  // Check if the modern File System Access API is available
  if (typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function') {
    try {
      const handle = await window.showDirectoryPicker({
        mode: 'read'
      });
      
      if (!handle) return;

      const libraryId = 'device-' + Date.now();
      await saveDeviceLibrary(libraryId, handle);
      
      // Start initial scan
      await scanDeviceLibrary(libraryId, handle);
      
      // Refresh UI
      if (typeof showRootFolderList === 'function') {
        showRootFolderList({ force: true });
      } else if (typeof applyFilterAndRender === 'function') {
        applyFilterAndRender();
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.error('Error selecting directory:', err);
        alert('Failed to access local directory: ' + err.message);
      }
    }
  } else {
    // Fallback for Android, iOS, Firefox, and older browsers
    console.log('showDirectoryPicker not available, using file input fallback');
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.webkitdirectory = true; // For desktop Firefox/Safari
    
    input.onchange = async (e) => {
      const files = Array.from(e.target.files).filter(f => 
        f.name.toLowerCase().endsWith('.cbz') || f.name.toLowerCase().endsWith('.cbr')
      );
      
      if (files.length === 0) {
        alert('No .cbz or .cbr files found in the selection.');
        return;
      }

      const libraryId = 'device-legacy-' + Date.now();
      const libraryName = files[0].webkitRelativePath 
        ? files[0].webkitRelativePath.split('/')[0] 
        : 'Local Files';

      await saveLegacyDeviceLibrary(libraryId, libraryName, files);
      
      // Refresh UI
      if (typeof showRootFolderList === 'function') {
        showRootFolderList({ force: true });
      } else if (typeof applyFilterAndRender === 'function') {
        applyFilterAndRender();
      }
    };
    
    input.click();
  }
}

export const DeviceLibrary = {
  requestDeviceLibrary,
  saveLegacyDeviceLibrary,
  saveDeviceLibrary,
  scanDeviceLibrary,
  getDeviceLibraries,
  getDeviceComics,
  removeDeviceLibrary,
  appendDeviceLibraryCards,
  reattachLegacyLibrary,
  showDeviceLibraryComics,
  renderLocalComicList
};

// Expose on state & window for transitional compatibility
state.DeviceLibrary = DeviceLibrary;
Object.assign(state, DeviceLibrary);

if (typeof window !== 'undefined') {
  window.DeviceLibrary = DeviceLibrary;
  Object.assign(window, DeviceLibrary);
}
