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

  // DEFAULT-ALLOW: grant every authenticated user access to all libraries.
  // Per-user access control below is temporarily bypassed while the access
  // UI is being reworked. Remove this early return to re-enable per-user
  // permissions (the original logic is left intact below).
  // return true;

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

  // --- FOLDER MODE RESOLUTION ---
  // Folder-mode libraries resolve access by on-disk path, so a per-root foothold
  // is meaningful and still mandatory here.
  if (isFolderMode) {
    const hasRootAccess = accessList.some(a =>
      a.accessType === 'root_folder' &&
      a.accessValue === rootFolder &&
      (a.direct_access === 1 || a.child_access === 1)
    );
    if (!hasRootAccess) return false;

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

  // --- METADATA MODE RESOLUTION ---
  // Permissions are grouped by metadata (root_folder / publisher / series). A
  // publisher legitimately spans multiple root folders on disk (e.g. "DC Comics"
  // files live in several libraries), so publisher- and series-level grants are
  // honored GLOBALLY by metadata, independent of any per-root foothold row: the
  // grant means "this publisher/series, wherever it appears". This keeps grants
  // robust as new root folders are added later. root_folder access continues to
  // mean "this whole library".

  // Whole-library grant: root_folder child_access covers everything under it.
  const rootChildAccess = accessList.some(a =>
    a.accessType === 'root_folder' &&
    a.accessValue === rootFolder &&
    a.child_access === 1
  );
  if (rootChildAccess) return true;

  // Publisher grant: child_access grants every comic for this publisher.
  const publisherChildAccess = accessList.some(a =>
    a.accessType === 'publisher' &&
    a.accessValue === publisher &&
    a.child_access === 1
  );
  if (publisherChildAccess) return true;

  // Series grant: a series is the lowest metadata level, so either child_access
  // or direct_access on the series grants all of its comics. (Save-side
  // normalization collapses series child_access into direct_access.)
  const seriesAccess = accessList.some(a =>
    a.accessType === 'series' &&
    a.accessValue === series &&
    (a.direct_access === 1 || a.child_access === 1)
  );
  if (seriesAccess) return true;

  return false; // No matching metadata grant
}

module.exports = {
    checkComicAccess
};
