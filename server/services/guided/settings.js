const { dbAll, dbGet } = require('../../db');
const { state } = require('./state');

const SETTINGS_KEYS = {
  autoOnAdd: 'guided.autoOnAdd',
  scheduleEnabled: 'guided.scheduleEnabled',
  scheduleInterval: 'guided.scheduleInterval',
  scheduleUnit: 'guided.scheduleUnit',
  useModal: 'guided.useModal',
  modalTokenId: 'guided.modalTokenId',
  modalTokenSecret: 'guided.modalTokenSecret',
  modalEnvironment: 'guided.modalEnvironment',
  concurrency: 'guided.concurrency'
};

async function getSetting(key, fallback) {
  try {
    const row = await dbGet('SELECT value FROM settings WHERE key = ?', [key]);
    if (!row) return fallback;
    try { return JSON.parse(row.value); } catch { return row.value; }
  } catch {
    return fallback;
  }
}

async function getSettings() {
  const modalSecret = await getSetting(SETTINGS_KEYS.modalTokenSecret, '');
  return {
    autoOnAdd: !!(await getSetting(SETTINGS_KEYS.autoOnAdd, false)),
    scheduleEnabled: !!(await getSetting(SETTINGS_KEYS.scheduleEnabled, false)),
    scheduleInterval: Number(await getSetting(SETTINGS_KEYS.scheduleInterval, 24)) || 24,
    scheduleUnit: await getSetting(SETTINGS_KEYS.scheduleUnit, 'hours'),
    useModal: !!(await getSetting(SETTINGS_KEYS.useModal, false)),
    modalTokenId: (await getSetting(SETTINGS_KEYS.modalTokenId, '')) || '',
    hasModalSecret: !!modalSecret,
    modalEnvironment: (await getSetting(SETTINGS_KEYS.modalEnvironment, '')) || '',
    concurrency: Number(await getSetting(SETTINGS_KEYS.concurrency, 2)) || 2
  };
}

async function getStatusCounts() {
  const rows = await dbAll(
    `SELECT COALESCE(guidedViewStatus, 'pending') AS s, COUNT(*) AS c
     FROM comics GROUP BY s`
  );
  const counts = { pending: 0, processing: 0, completed: 0, failed: 0, skipped: 0 };
  for (const r of rows) counts[r.s] = (counts[r.s] || 0) + r.c;
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return { ...counts, total };
}

async function getStatus() {
  const settings = await getSettings();
  const counts = await getStatusCounts();
  const active = Array.from(state.activeComics.values()).map(c => ({
    id: c.id,
    name: c.name,
    path: c.path,
    workerIndex: c.workerIndex
  }));
  return {
    isRunning: state.isRunning,
    current: state.current,
    active,
    queueLength: state.queue.length,
    startedAt: state.startedAt,
    lastFinishedAt: state.lastFinishedAt,
    lastError: state.lastError,
    counts,
    settings,
    nextScheduledAt: state.scheduleTimer ? state.scheduleTimer._nextAt || null : null
  };
}

function intervalToMs(interval, unit) {
  const n = Math.max(1, Number(interval) || 1);
  if (unit === 'days') return n * 24 * 60 * 60 * 1000;
  return n * 60 * 60 * 1000; // hours
}

module.exports = {
  SETTINGS_KEYS,
  getSetting,
  getSettings,
  getStatusCounts,
  getStatus,
  intervalToMs
};
