const { MAX_LOG_ENTRIES } = require('./constants');

const rawConsole = {
  log: console.log.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console)
};

function withTimestamp(fn) {
  return (...args) => fn(`[${new Date().toISOString()}]`, ...args);
}

console.log = withTimestamp(rawConsole.log);
console.warn = withTimestamp(rawConsole.warn);
console.error = withTimestamp(rawConsole.error);

const logs = [];
const ctLogs = [];
const ctClients = new Set();
const renameLogs = [];
const renameClients = new Set();
const moveLogs = [];
const moveClients = new Set();
const guidedLogs = [];
const guidedClients = new Set();

function pushWithLimit(collection, entry) {
  collection.push(entry);
  if (collection.length > MAX_LOG_ENTRIES) {
    collection.shift();
  }
}

function ctLog(message) {
  const entry = { timestamp: new Date().toISOString(), message };
  pushWithLimit(ctLogs, entry);
  for (const res of ctClients) {
    res.write(`data: ${JSON.stringify(entry)}\n\n`);
  }
}

function log(level, category, message) {
  const timestamp = new Date().toISOString();
  const entry = { timestamp, level, category, message };
  pushWithLimit(logs, entry);
  // Only output ERROR level logs to console
  if (level === 'ERROR') {
    rawConsole.error(`[${timestamp}] [${level}] [${category}] ${message}`);
  }
}

function registerCtClient(res) {
  ctClients.add(res);
}

function unregisterCtClient(res) {
  ctClients.delete(res);
}

function getLogs() {
  return logs;
}

function getCtLogs() {
  return ctLogs;
}

// Rename operations logging
function renameLog(message) {
  const entry = { timestamp: new Date().toISOString(), message };
  pushWithLimit(renameLogs, entry);
  for (const res of renameClients) {
    res.write(`data: ${JSON.stringify(entry)}\n\n`);
  }
}

function registerRenameClient(res) {
  renameClients.add(res);
}

function unregisterRenameClient(res) {
  renameClients.delete(res);
}

function getRenameLogs() {
  return renameLogs;
}

function clearRenameLogs() {
  renameLogs.length = 0;
}

// Move operations logging
function moveLog(message) {
  const entry = { timestamp: new Date().toISOString(), message };
  pushWithLimit(moveLogs, entry);
  for (const res of moveClients) {
    res.write(`data: ${JSON.stringify(entry)}\n\n`);
  }
}

function registerMoveClient(res) {
  moveClients.add(res);
}

function unregisterMoveClient(res) {
  moveClients.delete(res);
}

function getMoveLogs() {
  return moveLogs;
}

function clearMoveLogs() {
  moveLogs.length = 0;
}

// Guided Reader operations logging
function guidedLog(level, message) {
  const entry = { timestamp: new Date().toISOString(), level: level || 'INFO', message };
  pushWithLimit(guidedLogs, entry);
  for (const res of guidedClients) {
    res.write(`data: ${JSON.stringify(entry)}\n\n`);
  }
}

// In-place log update. Entries sharing an `id` overwrite the previous one in
// both the replay buffer and any connected SSE client view, so the UI shows
// progress on a single line instead of spamming new lines.
function guidedLogUpdate(id, level, message) {
  const entry = { timestamp: new Date().toISOString(), level: level || 'INFO', message, id };
  // Replace prior buffer entry with the same id (or push if first time).
  const existingIdx = guidedLogs.findIndex(e => e.id === id);
  if (existingIdx >= 0) {
    guidedLogs[existingIdx] = entry;
  } else {
    pushWithLimit(guidedLogs, entry);
  }
  for (const res of guidedClients) {
    res.write(`data: ${JSON.stringify(entry)}\n\n`);
  }
}

function registerGuidedClient(res) {
  guidedClients.add(res);
}

function unregisterGuidedClient(res) {
  guidedClients.delete(res);
}

function getGuidedLogs() {
  return guidedLogs;
}

function clearGuidedLogs() {
  guidedLogs.length = 0;
}

module.exports = {
  log,
  ctLog,
  registerCtClient,
  unregisterCtClient,
  getLogs,
  getCtLogs,
  renameLog,
  registerRenameClient,
  unregisterRenameClient,
  getRenameLogs,
  clearRenameLogs,
  moveLog,
  registerMoveClient,
  unregisterMoveClient,
  getMoveLogs,
  clearMoveLogs,
  guidedLog,
  guidedLogUpdate,
  registerGuidedClient,
  unregisterGuidedClient,
  getGuidedLogs,
  clearGuidedLogs
};
