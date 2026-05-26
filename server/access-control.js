const path = require('path');

async function checkComicAccess(userId, userRole, comicPath, publisher, series, rootFolders, comicId = null, preFetchedAccessList = null, dbAllFunc) {
  // Determine which root folder this comic belongs to
  let rootFolder = 'Unknown';
  for (const folder of rootFolders) {
    if (comicPath === folder || comicPath.startsWith(folder + path.sep)) {
      rootFolder = folder;
      break;
    }
  }

  // Always grant access to files in the inbox / comicsLocation
  const config = require('./config').getConfig();
  if (config.comicsLocation) {
    const normLocation = config.comicsLocation.replace(/\\/g, '/');
    const normPath = comicPath.replace(/\\/g, '/');
    const isInboxPath = normPath === normLocation || normPath.startsWith(normLocation + '/');
    if (isInboxPath) {
      const normRootFolder = rootFolder.replace(/\\/g, '/');
      if (normRootFolder === 'Unknown' || normRootFolder === normLocation) {
        return true;
      }
    }
  }

  // Admins have access to everything
  if (userRole === 'admin') {
    return true;
  }

  // Get user's access permissions (all at once for efficiency)
  const accessList = preFetchedAccessList || await dbAllFunc(
    `SELECT accessType, accessValue, direct_access, child_access
     FROM user_library_access
     WHERE userId = ? AND (direct_access = 1 OR child_access = 1)`,
    [userId]
  );

  // Retrieve library mode from config
  const libraries = require('./config').getLibraries();
  const library = libraries.find(l => l.path === rootFolder);
  const isFolderMode = library?.hierarchyMode === 'folder';

  // Verify Root Folder Access (Mandatory for both modes)
  const hasRootAccess = accessList.some(a =>
    a.accessType === 'root_folder' &&
    a.accessValue === rootFolder &&
    (a.direct_access === 1 || a.child_access === 1)
  );
  if (!hasRootAccess) return false;

  // Folder Mode Access Resolution
  if (isFolderMode) {
    // Check direct comic file permission
    const hasDirectComic = accessList.some(a => 
      a.accessType === 'comic' && 
      a.accessValue === comicId && 
      a.direct_access === 1
    );
    if (hasDirectComic) return true;

    // Check recursive parent directory permission
    const normalizedPath = path.normalize(comicPath);
    for (const perm of accessList) {
      if (perm.accessType === 'folder' && perm.child_access === 1) {
        const normalizedFolder = path.normalize(perm.accessValue);
        if (normalizedPath === normalizedFolder || normalizedPath.startsWith(normalizedFolder + path.sep)) {
          return true; // Inherited recursive access granted
        }
      }
    }

    // Check direct parent directory permission
    const parentFolder = path.dirname(normalizedPath);
    const hasDirectParent = accessList.some(a =>
      a.accessType === 'folder' &&
      path.normalize(a.accessValue) === parentFolder &&
      a.direct_access === 1
    );
    if (hasDirectParent) return true;

    return false; // Access Denied in Folder Mode
  }

  // --- METADATA MODE RESOLUTION (Existing logic kept intact) ---

  // Check root folder child_access
  const rootChildAccess = accessList.find(a =>
    a.accessType === 'root_folder' &&
    a.accessValue === rootFolder &&
    a.child_access === 1
  );

  if (rootChildAccess) {
    return true; // Root folder child_access grants access to everything under it
  }

  // Check publisher child_access
  const publisherChildAccess = accessList.find(a =>
    a.accessType === 'publisher' &&
    publisher &&
    a.accessValue === publisher &&
    a.child_access === 1
  );
  if (publisherChildAccess) {
    // Publisher has child_access, but we still need root folder access
    const rootAccess = accessList.find(a =>
      a.accessType === 'root_folder' &&
      a.accessValue === rootFolder &&
      (a.direct_access === 1 || a.child_access === 1)
    );
    if (rootAccess) {
      return true; // Publisher child_access + root access grants access to all series/comics
    }
  }

  // Check series child_access
  const seriesChildAccess = accessList.find(a =>
    a.accessType === 'series' &&
    series &&
    a.accessValue === series &&
    a.child_access === 1
  );
  if (seriesChildAccess) {
    // Series has child_access, check if we have publisher and root access
    const rootAccess = accessList.find(a =>
      a.accessType === 'root_folder' &&
      a.accessValue === rootFolder &&
      (a.direct_access === 1 || a.child_access === 1)
    );
    const publisherAccess = accessList.find(a =>
      a.accessType === 'publisher' &&
      publisher &&
      a.accessValue === publisher &&
      (a.direct_access === 1 || a.child_access === 1)
    );
    if (rootAccess && publisherAccess) {
      return true; // Series child_access + publisher + root access grants access to all comics
    }
  }

  // No child_access found, check for direct_access at each level
  // Step 1: Check ROOT FOLDER direct access (mandatory)
  const rootDirectAccess = accessList.find(a =>
    a.accessType === 'root_folder' &&
    a.accessValue === rootFolder &&
    a.direct_access === 1
  );
  if (!rootDirectAccess) {
    return false; // No root folder access at all
  }

  // Step 2: Check PUBLISHER direct access
  const publisherDirectAccess = accessList.find(a =>
    a.accessType === 'publisher' &&
    publisher &&
    a.accessValue === publisher &&
    a.direct_access === 1
  );
  if (!publisherDirectAccess) {
    return false; // No publisher access
  }

  // Step 3: Check SERIES access
  // Series is the lowest level - having series access grants access to all comics in that series
  const seriesDirectAccess = accessList.find(a =>
    a.accessType === 'series' &&
    series &&
    a.accessValue === series &&
    a.direct_access === 1
  );
  if (!seriesDirectAccess) {
    return false; // No series access
  }

  // Series access granted - user has access to all comics in this series
  return true;
}

module.exports = {
    checkComicAccess
};
