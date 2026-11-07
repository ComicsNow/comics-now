/**
 * Central Log Retention Service
 * Enforces a strict 21-day retention policy across all Comics Now log stores.
 */
const fs = require('fs');
const path = require('path');
const { SCAN_LOGS_DIR, LOG_RETENTION_DAYS } = require('../constants');

function pruneScanLogFiles(logsDir = SCAN_LOGS_DIR, maxAgeDays = LOG_RETENTION_DAYS) {
  if (!logsDir || !fs.existsSync(logsDir)) return 0;
  const cutoffSec = (Date.now() / 1000) - (maxAgeDays * 86400);
  let pruned = 0;

  try {
    const files = fs.readdirSync(logsDir);
    for (const f of files) {
      if (f.startsWith('scan_log_') && f.endsWith('.json')) {
        const fullPath = path.join(logsDir, f);
        try {
          const stat = fs.statSync(fullPath);
          if (stat.mtimeMs / 1000 < cutoffSec) {
            fs.unlinkSync(fullPath);
            pruned++;
          }
        } catch (_) {}
      }
    }
  } catch (_) {}
  return pruned;
}

async function pruneAuditLogs(dbInstance, maxAgeDays = LOG_RETENTION_DAYS) {
  if (!dbInstance || typeof dbInstance.dbRun !== 'function') return 0;
  const sql = `DELETE FROM impersonation_audit WHERE timestamp < datetime('now', '-${maxAgeDays} days')`;
  try {
    await dbInstance.dbRun(sql);
    return 1;
  } catch (_) {
    return 0;
  }
}

async function runFullRetentionSweep(deps = {}) {
  const logger = deps.logger || require('../logger');
  const db = deps.db || require('../db');
  const logsDir = deps.logsDir || SCAN_LOGS_DIR;
  const maxDays = deps.maxAgeDays || LOG_RETENTION_DAYS;

  let inMemoryPruned = 0;
  if (typeof logger.pruneOldLogs === 'function') {
    inMemoryPruned = logger.pruneOldLogs(maxDays);
  }

  const diskPruned = pruneScanLogFiles(logsDir, maxDays);
  await pruneAuditLogs(db, maxDays);

  return { inMemoryPruned, diskPruned };
}

let _retentionTimer = null;
function scheduleRetentionSweep(intervalHours = 24, deps = {}) {
  if (_retentionTimer) {
    clearInterval(_retentionTimer);
    _retentionTimer = null;
  }
  // Run on startup
  runFullRetentionSweep(deps).catch(() => {});

  const intervalMs = intervalHours * 60 * 60 * 1000;
  _retentionTimer = setInterval(() => {
    runFullRetentionSweep(deps).catch(() => {});
  }, intervalMs);
  if (_retentionTimer.unref) _retentionTimer.unref();
}

module.exports = {
  pruneScanLogFiles,
  pruneAuditLogs,
  runFullRetentionSweep,
  scheduleRetentionSweep
};
