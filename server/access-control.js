async function checkComicAccess(userId, userRole, comicPath, publisher, series, rootFolders, comicId = null, preFetchedAccessList = null, dbAllFunc) {
  // Admins have access to everything
  if (userRole === 'admin') {
    return true;
  }

  // Determine which root folder this comic belongs to
  let rootFolder = 'Unknown';
  for (const folder of rootFolders) {
    if (comicPath.startsWith(folder)) {
      rootFolder = folder;
      break;
    }
  }

  // Get user's access permissions (all at once for efficiency)
  const accessList = preFetchedAccessList || await dbAllFunc(
    `SELECT accessType, accessValue, direct_access, child_access
     FROM user_library_access
     WHERE userId = ? AND (direct_access = 1 OR child_access = 1)`,
    [userId]
  );

  // Hierarchical access control: Check from top to bottom
  // User MUST have access at root folder level first, then publisher, then series
  // Child access at any parent level grants access to all descendants

  // Check if any parent has child_access that would grant access to this comic
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
