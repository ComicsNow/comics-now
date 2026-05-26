const { rateLimiter } = require('../../middleware/rate-limiter');

module.exports = function attach(router, deps) {
  const adminUsersLimiter = rateLimiter({
    windowMs: 15 * 60 * 1000,
    max: 200
  });
  router.use(adminUsersLimiter);

  const { dbGet, dbRun, dbAll, log, formatErrorMessage, getComicsDirectories } = deps;

  router.get('/api/v1/users', async (req, res) => {
    try {
      const users = await dbAll(
        'SELECT userId, email, role, created, lastSeen FROM users ORDER BY email ASC'
      );
      res.json({ ok: true, users });
    } catch (error) {
      log('ERROR', 'USER', `Failed to fetch users: ${error.message}`);
      res.status(500).json({ ok: false, message: formatErrorMessage(error, req, 'Failed to fetch users') });
    }
  });

  // Get user's access permissions
  router.get('/api/v1/users/:userId/access', async (req, res) => {
    try {
      const { userId } = req.params;

      // Check if user exists
      const user = await dbGet('SELECT userId, email, role FROM users WHERE userId = ?', [userId]);
      if (!user) {
        return res.status(404).json({ ok: false, message: 'User not found' });
      }

      // Admins have access to everything (no need to query database)
      if (user.role === 'admin') {
        return res.json({
          ok: true,
          userId,
          role: 'admin',
          hasFullAccess: true,
          access: []
        });
      }

      // Get user's access permissions
      const access = await dbAll(
        'SELECT accessType, accessValue, direct_access, child_access FROM user_library_access WHERE userId = ? AND (direct_access = 1 OR child_access = 1)',
        [userId]
      );

      res.json({
        ok: true,
        userId,
        role: user.role,
        hasFullAccess: false,
        access
      });
    } catch (error) {
      log('ERROR', 'ACCESS', `Failed to fetch user access: ${error.message}`);
      res.status(500).json({ ok: false, message: formatErrorMessage(error, req, 'Failed to fetch user access') });
    }
  });

  // Update user's access permissions
  router.post('/api/v1/users/:userId/access', async (req, res) => {
    try {
      const { userId } = req.params;
      const { access } = req.body; // access is an array of { accessType, accessValue, direct_access, child_access }

      if (!Array.isArray(access)) {
        return res.status(400).json({ ok: false, message: 'Invalid access data: expected array' });
      }

      // Check if user exists
      const user = await dbGet('SELECT userId, role FROM users WHERE userId = ?', [userId]);
      if (!user) {
        return res.status(404).json({ ok: false, message: 'User not found' });
      }

      // Cannot modify admin access through this endpoint
      if (user.role === 'admin') {
        return res.status(400).json({ ok: false, message: 'Cannot modify admin user access (admins have full access)' });
      }

      // Clear existing access for this user
      await dbRun('DELETE FROM user_library_access WHERE userId = ?', [userId]);

      // Separate folder-mode access from metadata-mode access
      const folderComicAccess = access.filter(item => item.accessType === 'folder' || item.accessType === 'comic');
      const metadataAccess = access.filter(item => item.accessType === 'root_folder' || item.accessType === 'publisher' || item.accessType === 'series');

      let normalizedAccess = [];

      if (metadataAccess.length > 0) {
        // Build hierarchy map from comics database
        const comics = await dbAll('SELECT MIN(path) as path, publisher, series FROM comics GROUP BY publisher, series');
        const rootFolders = getComicsDirectories();

        // Map: root_folder -> Set of publishers
        // Map: publisher -> Set of series
        const rootToPublishers = new Map();
        const publisherToSeries = new Map();

        for (const comic of comics) {
          // Determine root folder
          let rootFolder = 'Unknown';
          for (const folder of rootFolders) {
            if (comic.path.startsWith(folder)) {
              rootFolder = folder;
              break;
            }
          }

          // Map root -> publishers
          if (!rootToPublishers.has(rootFolder)) {
            rootToPublishers.set(rootFolder, new Set());
          }
          if (comic.publisher) {
            rootToPublishers.get(rootFolder).add(comic.publisher);
          }

          // Map publisher -> series
          if (comic.publisher) {
            if (!publisherToSeries.has(comic.publisher)) {
              publisherToSeries.set(comic.publisher, new Set());
            }
            if (comic.series) {
              publisherToSeries.get(comic.publisher).add(comic.series);
            }
          }
        }

        // Build set of what children are present in access list
        const accessSet = new Map();
        for (const item of metadataAccess) {
          const key = `${item.accessType}:${item.accessValue}`;
          accessSet.set(key, item);
        }

        // Process each access item
        for (const item of metadataAccess) {
          let shouldNormalize = false;
          let allChildren = [];

          // If parent has child_access, check how many children are present
          if (item.child_access) {
            if (item.accessType === 'root_folder') {
              // Get all publishers under this root folder
              allChildren = Array.from(rootToPublishers.get(item.accessValue) || []);
              const presentChildren = allChildren.filter(pub =>
                accessSet.has(`publisher:${pub}`)
              );

              // Only normalize if SOME (but not all) children are present
              if (presentChildren.length === allChildren.length && allChildren.length > 0) {
                shouldNormalize = false;
              } else if (presentChildren.length > 0) {
                shouldNormalize = true;
              } else {
                shouldNormalize = false;
              }

            } else if (item.accessType === 'publisher') {
              // Get all series under this publisher
              allChildren = Array.from(publisherToSeries.get(item.accessValue) || []);
              const presentChildren = allChildren.filter(series =>
                accessSet.has(`series:${series}`)
              );
              if (presentChildren.length === allChildren.length && allChildren.length > 0) {
                shouldNormalize = false;
              } else if (presentChildren.length > 0) {
                shouldNormalize = true;
              } else {
                shouldNormalize = false;
              }

            } else if (item.accessType === 'series') {
              if (item.child_access) {
                shouldNormalize = true;
              } else {
                shouldNormalize = false;
              }
            }
          }

          if (shouldNormalize && (item.accessType === 'series' || allChildren.length > 0)) {
            // Convert: remove child_access, add direct_access to parent
            normalizedAccess.push({
              accessType: item.accessType,
              accessValue: item.accessValue,
              direct_access: true,
              child_access: false
            });

            log('INFO', 'ACCESS', `Normalized ${item.accessType}:${item.accessValue} - removed child_access${item.accessType === 'series' ? ' (series is lowest level)' : ' due to selective child access'}`);
          } else {
            // Keep as-is
            normalizedAccess.push(item);
          }
        }

        // Remove redundant child entries when parent has child_access
        const finalAccess = [];
        const rootFoldersWithChildAccess = new Set();
        const publishersWithChildAccess = new Set();

        // Build maps for hierarchy
        const publisherToRootFolder = new Map();
        const seriesToPublisher = new Map();
        for (const comic of comics) {
          // Determine root folder for this comic
          let rootFolder = 'Unknown';
          for (const folder of rootFolders) {
            if (comic.path.startsWith(folder)) {
              rootFolder = folder;
              break;
            }
          }
          if (comic.publisher) {
            publisherToRootFolder.set(comic.publisher, rootFolder);
          }
          if (comic.series && comic.publisher) {
            seriesToPublisher.set(comic.series, comic.publisher);
          }
        }

        // First pass: identify parents with child_access
        for (const item of normalizedAccess) {
          if (item.child_access) {
            if (item.accessType === 'root_folder') {
              rootFoldersWithChildAccess.add(item.accessValue);
            } else if (item.accessType === 'publisher') {
              publishersWithChildAccess.add(item.accessValue);
            }
          }
        }

        // Second pass: filter out redundant entries
        for (const item of normalizedAccess) {
          // Always keep root_folder entries
          if (item.accessType === 'root_folder') {
            finalAccess.push(item);
            continue;
          }

          // Skip publishers if their root folder has child_access
          if (item.accessType === 'publisher') {
            const rootFolder = publisherToRootFolder.get(item.accessValue);
            if (rootFolder && rootFoldersWithChildAccess.has(rootFolder)) {
              continue;
            }
          }

          // Skip series if their publisher has child_access OR their root folder has child_access
          if (item.accessType === 'series') {
            const publisher = seriesToPublisher.get(item.accessValue);
            if (publisher) {
              if (publishersWithChildAccess.has(publisher)) {
                continue;
              }
              const rootFolder = publisherToRootFolder.get(publisher);
              if (rootFolder && rootFoldersWithChildAccess.has(rootFolder)) {
                continue;
              }
            }
          }

          finalAccess.push(item);
        }

        normalizedAccess = finalAccess;
      }

      // Combine back with folder mode access
      const allFinalAccess = [...normalizedAccess, ...folderComicAccess];

      // Insert access permissions
      if (allFinalAccess.length > 0) {
        for (const item of allFinalAccess) {
          if (!item.accessType || !item.accessValue) continue;

          // For folder and comic types, save them directly
          if (item.accessType === 'comic') {
            const directAccess = item.direct_access === true || item.direct_access === 1 ? 1 : 0;
            if (directAccess) {
              await dbRun(
                'INSERT INTO user_library_access (userId, accessType, accessValue, direct_access, child_access) VALUES (?, ?, ?, ?, 0)',
                [userId, 'comic', item.accessValue, directAccess]
              );
            }
            continue;
          }

          if (item.accessType === 'folder') {
            const directAccess = item.direct_access === true || item.direct_access === 1 ? 1 : 0;
            const childAccess = item.child_access === true || item.child_access === 1 ? 1 : 0;
            if (directAccess || childAccess) {
              await dbRun(
                'INSERT INTO user_library_access (userId, accessType, accessValue, direct_access, child_access) VALUES (?, ?, ?, ?, ?)',
                [userId, 'folder', item.accessValue, directAccess, childAccess]
              );
            }
            continue;
          }

          // Metadata mode entries (root_folder, publisher, series)
          const directAccess = item.direct_access === true ? 1 : 0;
          let childAccess = (item.accessType === 'series') ? 0 : (item.child_access === true ? 1 : 0);

          // Can't have child_access without direct_access
          if (!directAccess) {
            childAccess = 0;
          }

          // Only insert if at least one access type is enabled
          if (directAccess || childAccess) {
            await dbRun(
              'INSERT INTO user_library_access (userId, accessType, accessValue, direct_access, child_access) VALUES (?, ?, ?, ?, ?)',
              [userId, item.accessType, item.accessValue, directAccess, childAccess]
            );
          }
        }
      }

      log('INFO', 'ACCESS', `Updated access permissions for user ${userId}: ${allFinalAccess.length} entries`);
      res.json({ ok: true, message: 'Access permissions updated successfully' });
    } catch (error) {
      log('ERROR', 'ACCESS', `Failed to update user access: ${error.message}`);
      res.status(500).json({ ok: false, message: formatErrorMessage(error, req, 'Failed to update user access') });
    }
  });
};
