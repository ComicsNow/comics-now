const { dbRun, dbAll } = require('./connection');
const { log } = require('../logger');

/**
 * Set reading preference (manga mode, continuous mode) for a user at a specific level
 * @param {string} userId - User ID
 * @param {string} preferenceType - 'comic', 'series', 'publisher', or 'library'
 * @param {string} targetId - The ID/name of the target (comic ID, series name, etc.)
 * @param {boolean|null} mangaMode - The manga mode value (optional)
 * @param {boolean|null} continuousMode - The continuous mode value (optional)
 */
async function setReadingPreference(userId, preferenceType, targetId, mangaMode, continuousMode) {
  try {
    const now = Date.now();
    let sets = ['updatedAt = excluded.updatedAt'];
    let params = [userId, preferenceType, targetId, now, now];
    let columns = ['userId', 'preferenceType', 'targetId', 'updatedAt', 'createdAt'];
    let placeholders = ['?', '?', '?', '?', '?'];

    if (mangaMode !== undefined) {
      columns.push('mangaMode');
      placeholders.push('?');
      params.push(mangaMode === null ? null : (mangaMode ? 1 : 0));
      sets.push('mangaMode = excluded.mangaMode');
    }
    if (continuousMode !== undefined) {
      columns.push('continuousMode');
      placeholders.push('?');
      params.push(continuousMode === null ? null : (continuousMode ? 1 : 0));
      sets.push('continuousMode = excluded.continuousMode');
    }

    const sql = `
      INSERT INTO user_reading_preferences (${columns.join(', ')})
      VALUES (${placeholders.join(', ')})
      ON CONFLICT(userId, preferenceType, targetId) DO UPDATE SET
        ${sets.join(', ')}
    `;

    await dbRun(sql, params);
    log('INFO', 'READING_PREFS', `Set ${preferenceType} '${targetId}' preferences (manga: ${mangaMode}, continuous: ${continuousMode}) for user ${userId}`);
    return true;
  } catch (error) {
    log('ERROR', 'READING_PREFS', `Failed to set reading preference: ${error.message}`);
    return false;
  }
}

/**
 * Get all reading preferences for a user
 */
async function getAllReadingPreferences(userId) {
  try {
    let query = `SELECT preferenceType, targetId, mangaMode, continuousMode FROM user_reading_preferences`;
    let params = [];
    if (userId && userId !== 'default-user') {
      query += ` WHERE userId IN (?, 'default-user')
                 ORDER BY CASE WHEN userId = ? THEN 1 ELSE 0 END ASC`;
      params.push(userId, userId);
    } else if (userId) {
      query += ` WHERE userId = ?`;
      params.push(userId);
    }
    const rows = await dbAll(query, params);

    const merged = new Map();
    for (const r of rows) {
      const key = `${r.preferenceType}:${r.targetId}`;
      const existing = merged.get(key);
      if (existing) {
        merged.set(key, {
          preferenceType: r.preferenceType,
          targetId: r.targetId,
          mangaMode: r.mangaMode !== null && r.mangaMode !== undefined ? r.mangaMode : existing.mangaMode,
          continuousMode: r.continuousMode !== null && r.continuousMode !== undefined ? r.continuousMode : existing.continuousMode
        });
      } else {
        merged.set(key, {
          preferenceType: r.preferenceType,
          targetId: r.targetId,
          mangaMode: r.mangaMode,
          continuousMode: r.continuousMode
        });
      }
    }
    return Array.from(merged.values());
  } catch (error) {
    log('ERROR', 'READING_PREFS', `Failed to get all reading preferences: ${error.message}`);
    return [];
  }
}

/**
 * Get unified reading preference maps
 * @param {number|null} userId - If provided, gets preferences for a specific user.
 */
async function getReadingPrefMaps(userId = null) {
  let query = `SELECT userId, preferenceType, targetId, mangaMode, continuousMode FROM user_reading_preferences`;
  let params = [];
  if (userId && userId !== 'default-user') {
    query += ` WHERE userId IN (?, 'default-user')
               ORDER BY CASE WHEN userId = ? THEN 1 ELSE 0 END ASC`;
    params.push(userId, userId);
  } else if (userId) {
    query += ` WHERE userId = ?`;
    params.push(userId);
  } else {
    query += ` WHERE mangaMode IS NOT NULL OR continuousMode IS NOT NULL
               ORDER BY CASE WHEN userId = 'default-user' THEN 0 ELSE 1 END ASC`;
  }
  
  const rows = await dbAll(query, params);
  
  const prefMaps = {
    comic: new Map(),
    series: new Map(),
    publisher: new Map(),
    library: new Map()
  };

  for (const pref of rows) {
    if (prefMaps[pref.preferenceType]) {
      const existing = prefMaps[pref.preferenceType].get(pref.targetId);
      const newManga = pref.mangaMode === 1 ? true : (pref.mangaMode === 0 ? false : null);
      const newContinuous = pref.continuousMode === 1 ? true : (pref.continuousMode === 0 ? false : null);

      if (existing) {
        prefMaps[pref.preferenceType].set(pref.targetId, {
          mangaMode: newManga !== null ? newManga : existing.mangaMode,
          continuousMode: newContinuous !== null ? newContinuous : existing.continuousMode
        });
      } else {
        prefMaps[pref.preferenceType].set(pref.targetId, {
          mangaMode: newManga,
          continuousMode: newContinuous
        });
      }
    }
  }
  
  return prefMaps;
}

/**
 * Resolve reading modes hierarchically
 */
function resolveReadingModes({ comicId, series, publisher, comicPath, prefMaps, comicsRoots }) {
  const levels = [];
  if (prefMaps && prefMaps.comic && prefMaps.comic.has(comicId)) levels.push(prefMaps.comic.get(comicId));
  if (series && prefMaps && prefMaps.series && prefMaps.series.has(series)) levels.push(prefMaps.series.get(series));
  if (publisher && prefMaps && prefMaps.publisher && prefMaps.publisher.has(publisher)) levels.push(prefMaps.publisher.get(publisher));
  if (comicPath && comicsRoots && prefMaps && prefMaps.library) {
    const root = comicsRoots.find(d => comicPath.startsWith(d));
    if (root && prefMaps.library.has(root)) levels.push(prefMaps.library.get(root));
  }

  let mangaMode = false;
  let continuousMode = false;

  for (const level of levels) {
    if (level.mangaMode !== null && level.mangaMode !== undefined) {
      mangaMode = level.mangaMode;
      break;
    }
  }

  for (const level of levels) {
    if (level.continuousMode !== null && level.continuousMode !== undefined) {
      continuousMode = level.continuousMode;
      break;
    }
  }

  return { mangaMode, continuousMode };
}

module.exports = {
  setReadingPreference,
  getAllReadingPreferences,
  getReadingPrefMaps,
  resolveReadingModes
};
