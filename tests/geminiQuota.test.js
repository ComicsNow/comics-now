const {
  getPacificDateString,
  getMsUntilNextPacificMidnight,
  getOrResetDailyUsage,
  incrementDailyUsage,
  startMidnightPacificScheduler,
  stopMidnightPacificScheduler
} = require('../server/services/gemini-quota');

describe('Gemini Quota & Midnight Pacific Reset', () => {
  afterEach(() => {
    stopMidnightPacificScheduler();
  });

  describe('getPacificDateString', () => {
    test('accurately formats Pacific Daylight Time (PDT) boundaries at 07:00 UTC', () => {
      // 2026-10-02 06:59:59 UTC is 23:59:59 PDT on 2026-10-01 (1 sec before midnight)
      const beforeMidnight = new Date('2026-10-02T06:59:59.000Z');
      expect(getPacificDateString(beforeMidnight)).toBe('2026-10-01');

      // 2026-10-02 07:00:00 UTC is 00:00:00 PDT on 2026-10-02 (exact midnight Pacific)
      const exactMidnight = new Date('2026-10-02T07:00:00.000Z');
      expect(getPacificDateString(exactMidnight)).toBe('2026-10-02');
    });

    test('accurately formats Pacific Standard Time (PST) boundaries at 08:00 UTC in winter', () => {
      // 2026-12-16 07:59:59 UTC is 23:59:59 PST on 2026-12-15
      const beforeMidnight = new Date('2026-12-16T07:59:59.000Z');
      expect(getPacificDateString(beforeMidnight)).toBe('2026-12-15');

      // 2026-12-16 08:00:00 UTC is 00:00:00 PST on 2026-12-16
      const exactMidnight = new Date('2026-12-16T08:00:00.000Z');
      expect(getPacificDateString(exactMidnight)).toBe('2026-12-16');
    });
  });

  describe('getMsUntilNextPacificMidnight', () => {
    test('computes exact milliseconds to next Pacific midnight', () => {
      const testTime = new Date('2026-10-02T04:00:00.000Z'); // 21:00 PDT (3 hours before midnight)
      const ms = getMsUntilNextPacificMidnight(testTime);

      // Expected target is 2026-10-02T07:00:00.000Z (exactly 3 hours = 10,800,000 ms)
      expect(ms).toBe(10800000);

      const target = new Date(testTime.getTime() + ms);
      expect(target.toISOString()).toBe('2026-10-02T07:00:00.000Z');
      expect(getPacificDateString(target)).toBe('2026-10-02');
      expect(getPacificDateString(new Date(target.getTime() - 1000))).toBe('2026-10-01');
    });
  });

  describe('getOrResetDailyUsage', () => {
    test('returns existing count when last reset matches current Pacific date', async () => {
      const mockDb = {
        dbGet: jest.fn().mockImplementation((query) => {
          if (query.includes("key = '_ext_cover_reset'")) {
            return Promise.resolve({ value: '2026-10-01' });
          }
          if (query.includes("key = '_ext_cover_requests'")) {
            return Promise.resolve({ value: '42' });
          }
          return Promise.resolve(null);
        }),
        dbRun: jest.fn().mockResolvedValue({ changes: 1 })
      };

      const testNow = new Date('2026-10-02T04:00:00.000Z'); // Still 2026-10-01 Pacific
      const count = await getOrResetDailyUsage(mockDb, testNow);

      expect(count).toBe(42);
      expect(mockDb.dbRun).not.toHaveBeenCalled();
    });

    test('resets count to 0 and updates date when midnight Pacific has passed', async () => {
      const mockDb = {
        dbGet: jest.fn().mockImplementation((query) => {
          if (query.includes("key = '_ext_cover_reset'")) {
            return Promise.resolve({ value: '2026-10-01' }); // Yesterday
          }
          if (query.includes("key = '_ext_cover_requests'")) {
            return Promise.resolve({ value: '88' });
          }
          return Promise.resolve(null);
        }),
        dbRun: jest.fn().mockResolvedValue({ changes: 1 })
      };

      const testNow = new Date('2026-10-02T07:05:00.000Z'); // Now 2026-10-02 Pacific!
      const count = await getOrResetDailyUsage(mockDb, testNow);

      expect(count).toBe(0);
      expect(mockDb.dbRun).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining("'_ext_cover_reset'"),
        ['2026-10-02']
      );
      expect(mockDb.dbRun).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining("'_ext_cover_requests'"),
        ['0']
      );


    });
  });

  describe('incrementDailyUsage', () => {
    test('increments usage when under cap', async () => {
      let storedCount = 10;
      const mockDb = {
        dbGet: jest.fn().mockImplementation((query) => {
          if (query.includes("key = '_ext_cover_reset'")) {
            return Promise.resolve({ value: '2026-10-01' });
          }
          if (query.includes("key = '_ext_cover_requests'")) {
            return Promise.resolve({ value: String(storedCount) });
          }
          return Promise.resolve(null);
        }),
        dbRun: jest.fn().mockImplementation((query, params) => {
          if (query.includes("UPDATE settings SET value = ? WHERE key = '_ext_cover_requests'")) {
            storedCount = parseInt(params[0], 10);
          }
          return Promise.resolve({ changes: 1 });
        })
      };

      const testNow = new Date('2026-10-02T04:00:00.000Z'); // 2026-10-01 Pacific
      const result = await incrementDailyUsage(mockDb, 450, testNow);

      expect(result.allowed).toBe(true);
      expect(result.count).toBe(11);
      expect(storedCount).toBe(11);
    });

    test('rejects request when at or above daily cap', async () => {
      const mockDb = {
        dbGet: jest.fn().mockImplementation((query) => {
          if (query.includes("key = '_ext_cover_reset'")) {
            return Promise.resolve({ value: '2026-10-01' });
          }
          if (query.includes("key = '_ext_cover_requests'")) {
            return Promise.resolve({ value: '450' });
          }
          return Promise.resolve(null);
        }),
        dbRun: jest.fn().mockResolvedValue({ changes: 1 })
      };

      const testNow = new Date('2026-10-02T04:00:00.000Z');
      const result = await incrementDailyUsage(mockDb, 450, testNow);

      expect(result.allowed).toBe(false);
      expect(result.count).toBe(450);
      expect(mockDb.dbRun).not.toHaveBeenCalled();
    });

    test('automatically resets and allows request if day rolled over even if previously capped', async () => {
      const mockDb = {
        dbGet: jest.fn().mockImplementation((query) => {
          if (query.includes("key = '_ext_cover_reset'")) {
            return Promise.resolve({ value: '2026-10-01' }); // Capped on previous day
          }
          if (query.includes("key = '_ext_cover_requests'")) {
            return Promise.resolve({ value: '450' });
          }
          return Promise.resolve(null);
        }),
        dbRun: jest.fn().mockResolvedValue({ changes: 1 })
      };

      const testNow = new Date('2026-10-02T07:01:00.000Z'); // 2026-10-02 Pacific (after midnight)
      const result = await incrementDailyUsage(mockDb, 450, testNow);

      expect(result.allowed).toBe(true);
      expect(result.count).toBe(1);
    });
  });

  describe('startMidnightPacificScheduler', () => {
    test('schedules and cleans up without errors', () => {
      const mockDb = {
        dbGet: jest.fn().mockResolvedValue({ value: '0' }),
        dbRun: jest.fn().mockResolvedValue({ changes: 1 })
      };
      const mockLog = jest.fn();

      startMidnightPacificScheduler({ db: mockDb, log: mockLog });
      stopMidnightPacificScheduler();
    });
  });
});
