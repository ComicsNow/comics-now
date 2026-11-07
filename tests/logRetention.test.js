const fs = require('fs');
const path = require('path');
const os = require('os');
const logger = require('../server/logger');
const { pruneScanLogFiles, pruneAuditLogs } = require('../server/services/log-retention');

describe('Universal 21-Day Log Retention Policy', () => {
  describe('In-Memory Logger Pruning', () => {
    it('prunes entries older than 21 days from logger streams', () => {
      const now = Date.now();
      const twentyTwoDaysAgo = new Date(now - 22 * 24 * 60 * 60 * 1000).toISOString();
      const tenDaysAgo = new Date(now - 10 * 24 * 60 * 60 * 1000).toISOString();
      const oneHourAgo = new Date(now - 60 * 60 * 1000).toISOString();

      // Clear existing
      if (typeof logger.clearAllLogsForTesting === 'function') {
        logger.clearAllLogsForTesting();
      }

      // Push custom timestamp entries
      logger.logWithTimestamp('INFO', 'TEST', 'Old message', twentyTwoDaysAgo);
      logger.logWithTimestamp('INFO', 'TEST', 'Mid message', tenDaysAgo);
      logger.logWithTimestamp('INFO', 'TEST', 'Recent message', oneHourAgo);

      expect(typeof logger.pruneOldLogs).toBe('function');
      const prunedCount = logger.pruneOldLogs(21);

      expect(prunedCount).toBeGreaterThanOrEqual(1);
      const remaining = logger.getLogs().filter(l => l.category === 'TEST');
      expect(remaining.length).toBe(2);
      expect(remaining.find(l => l.message === 'Old message')).toBeUndefined();
      expect(remaining.find(l => l.message === 'Mid message')).toBeDefined();
      expect(remaining.find(l => l.message === 'Recent message')).toBeDefined();
    });
  });

  describe('Scan Log Files On-Disk Pruning', () => {
    let tmpDir;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-logs-test-'));
    });

    afterEach(() => {
      if (fs.existsSync(tmpDir)) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('prunes scan_log_*.json files older than 21 days', () => {
      const nowSec = Date.now() / 1000;
      const twentyTwoDaysAgoSec = nowSec - (22 * 86400);
      const fiveDaysAgoSec = nowSec - (5 * 86400);

      const oldFile = path.join(tmpDir, 'scan_log_old.json');
      const newFile = path.join(tmpDir, 'scan_log_new.json');
      const otherFile = path.join(tmpDir, 'other_file.txt');

      fs.writeFileSync(oldFile, JSON.stringify({ id: 'old' }));
      fs.utimesSync(oldFile, twentyTwoDaysAgoSec, twentyTwoDaysAgoSec);

      fs.writeFileSync(newFile, JSON.stringify({ id: 'new' }));
      fs.utimesSync(newFile, fiveDaysAgoSec, fiveDaysAgoSec);

      fs.writeFileSync(otherFile, 'preserve this');

      const pruned = pruneScanLogFiles(tmpDir, 21);
      expect(pruned).toBe(1);

      expect(fs.existsSync(oldFile)).toBe(false);
      expect(fs.existsSync(newFile)).toBe(true);
      expect(fs.existsSync(otherFile)).toBe(true);
    });
  });

  describe('Audit Table Retention Pruning', () => {
    it('prunes impersonation_audit rows older than 21 days', async () => {
      const mockRun = jest.fn().mockResolvedValue();
      const mockDb = { dbRun: mockRun };

      await pruneAuditLogs(mockDb, 21);

      expect(mockRun).toHaveBeenCalledWith(
        expect.stringContaining("DELETE FROM impersonation_audit WHERE timestamp < datetime('now', '-21 days')")
      );
    });
  });
});
