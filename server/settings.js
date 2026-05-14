const { db, dbAll, dbRun } = require('./db');
const { log } = require('./logger');
const {
  setScanIntervalMinutes,
  setComicVineApiKey,
  setCtScheduleMinutes,
  setAllowedFormats,
  setMetadataStorage
} = require('./config');

async function loadSettings() {
  try {
    const rows = await dbAll('SELECT key, value FROM settings');
    if (!rows) {
      return;
    }
    for (const row of rows) {
      if (row.key === 'scanInterval') {
        let raw;
        try {
          raw = JSON.parse(row.value);
        } catch {
          raw = row.value;
        }
        setScanIntervalMinutes(raw, true);
      }
      if (row.key === 'comicVineApiKey') {
        try {
          setComicVineApiKey(JSON.parse(row.value), true);
        } catch {
          setComicVineApiKey(row.value, true);
        }
      }
      if (row.key === 'ctScheduleMinutes') {
        let rawMinutes;
        try {
          rawMinutes = JSON.parse(row.value);
        } catch {
          rawMinutes = row.value;
        }
        setCtScheduleMinutes(rawMinutes, true);
      }
      if (row.key === 'allowed_formats') {
        try {
          setAllowedFormats(JSON.parse(row.value), true);
        } catch {
          setAllowedFormats(row.value, true);
        }
      }
      if (row.key === 'metadata_storage') {
        try {
          setMetadataStorage(JSON.parse(row.value), true);
        } catch {
          setMetadataStorage(row.value, true);
        }
      }
    }
    log('INFO', 'SERVER', 'Settings loaded from DB.');
  } catch (err) {
    log('ERROR', 'DB', `Load settings failed: ${err.message}`);
  }
}

async function saveSetting(key, value) {
  try {
    await dbRun('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [key, JSON.stringify(value)]);
  } catch (err) {
    log('ERROR', 'DB', `Save setting '${key}' failed: ${err.message}`);
    throw err;
  }
}

module.exports = {
  loadSettings,
  saveSetting,
  db
};
