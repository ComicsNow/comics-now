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

function t0() {
  return process.hrtime.bigint();
}

function ms(since) {
  return Number((process.hrtime.bigint() - since) / 1000000n);
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
  t0,
  ms
};
