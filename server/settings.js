const { db, dbAll, dbRun } = require('./db');
const { log } = require('./logger');
const {
  setScanIntervalMinutes,
  setComicVineApiKey,
  setCtScheduleMinutes
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
        setScanIntervalMinutes(raw);
      }
      if (row.key === 'comicVineApiKey') {
        try {
          setComicVineApiKey(JSON.parse(row.value));
        } catch {
          setComicVineApiKey(row.value);
        }
      }
      if (row.key === 'ctScheduleMinutes') {
        let rawMinutes;
        try {
          rawMinutes = JSON.parse(row.value);
        } catch {
          rawMinutes = row.value;
        }
        setCtScheduleMinutes(rawMinutes);
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
