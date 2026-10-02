/**
 * Gemini Daily Quota & Usage Manager
 *
 * Manages daily request counting and automatic reset at midnight Pacific Time (America/Los_Angeles).
 * Google Generative AI / Gemini API daily request limits reset at 00:00:00 Pacific Time (PT).
 */

/**
 * Returns the current date in YYYY-MM-DD format in the America/Los_Angeles timezone.
 * Handles DST (PDT vs PST) transitions automatically.
 * @param {Date} [date]
 * @returns {string} e.g. "2026-10-01"
 */
function getPacificDateString(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(d);
}

/**
 * Calculates milliseconds from `date` until the next midnight in Pacific Time (America/Los_Angeles).
 * @param {Date} [date]
 * @returns {number} milliseconds
 */
function getMsUntilNextPacificMidnight(date = new Date()) {
  const now = date instanceof Date ? date : new Date(date);
  const todayPacific = getPacificDateString(now);
  const [y, m, d] = todayPacific.split('-').map(Number);

  // America/Los_Angeles midnight occurs between 07:00 UTC (PDT) and 08:00 UTC (PST) on d+1.
  // Start searching from 06:55:00 UTC on d+1.
  let candidate = new Date(Date.UTC(y, m - 1, d + 1, 6, 55, 0));
  while (getPacificDateString(candidate) === todayPacific) {
    candidate = new Date(candidate.getTime() + 60000);
  }
  // Step back 1 minute then advance by 1 second to find exact boundary
  candidate = new Date(candidate.getTime() - 60000);
  while (getPacificDateString(candidate) === todayPacific) {
    candidate = new Date(candidate.getTime() + 1000);
  }
  return Math.max(1000, candidate.getTime() - now.getTime());
}

/**
 * Retrieves the current daily usage count, resetting to 0 if midnight Pacific has passed.
 * @param {Object} db - { dbGet, dbRun }
 * @param {Date} [nowDate] - Optional override for testing
 * @returns {Promise<number>}
 */
async function getOrResetDailyUsage(db, nowDate = new Date()) {
  if (!db || typeof db.dbGet !== 'function') return 0;

  try {
    const todayPacific = getPacificDateString(nowDate);
    const resetRow = await db.dbGet("SELECT value FROM settings WHERE key = '_ext_cover_reset'");
    const lastReset = resetRow?.value;

    if (lastReset !== todayPacific) {
      if (typeof db.dbRun === 'function') {
        await db.dbRun("INSERT INTO settings (key, value) VALUES ('_ext_cover_reset', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [todayPacific]);
        await db.dbRun("INSERT INTO settings (key, value) VALUES ('_ext_cover_requests', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", ['0']);
      }
      return 0;
    }


    const reqRow = await db.dbGet("SELECT value FROM settings WHERE key = '_ext_cover_requests'");
    return parseInt(reqRow?.value || '0', 10);
  } catch (err) {
    return 0;
  }
}

/**
 * Increments the daily request count if under the cap, resetting if a new Pacific day has arrived.
 * @param {Object} db - { dbGet, dbRun }
 * @param {number} dailyCap
 * @param {Date} [nowDate] - Optional override for testing
 * @returns {Promise<{ allowed: boolean, count: number }>}
 */
async function incrementDailyUsage(db, dailyCap = 450, nowDate = new Date()) {
  if (!db || typeof db.dbGet !== 'function') {
    return { allowed: true, count: 0 };
  }

  try {
    const count = await getOrResetDailyUsage(db, nowDate);
    if (count >= dailyCap) {
      return { allowed: false, count };
    }

    const newCount = count + 1;
    if (typeof db.dbRun === 'function') {
      await db.dbRun("UPDATE settings SET value = ? WHERE key = '_ext_cover_requests'", [String(newCount)]);
    }
    return { allowed: true, count: newCount };
  } catch (err) {
    return { allowed: true, count: 0 };
  }
}

let midnightTimer = null;
let watchdogInterval = null;

/**
 * Starts the background scheduler that resets the quota at midnight Pacific Time everyday.
 * @param {Object} ctx - { db, log }
 */
function startMidnightPacificScheduler(ctx = {}) {
  stopMidnightPacificScheduler();

  const db = ctx.db || {};
  const logger = ctx.log || ((lvl, tag, msg) => console.log(`[${lvl}][${tag}] ${msg}`));

  function scheduleNextMidnight() {
    const msUntilMidnight = getMsUntilNextPacificMidnight();
    midnightTimer = setTimeout(async () => {
      try {
        await getOrResetDailyUsage(db);
        logger('INFO', 'GEMINI_QUOTA', `🌅 Gemini daily API requests usage reset to 0 at midnight Pacific (America/Los_Angeles). Next reset in ~24h.`);
      } catch (err) {
        logger('WARN', 'GEMINI_QUOTA', `Midnight Pacific reset error: ${err.message}`);
      }
      scheduleNextMidnight();
    }, msUntilMidnight);

    if (midnightTimer.unref) {
      midnightTimer.unref();
    }
  }

  scheduleNextMidnight();

  // Watchdog: Check every 60 seconds in case system clock changes or machine wakes from sleep
  watchdogInterval = setInterval(async () => {
    try {
      const todayPacific = getPacificDateString();
      if (typeof db.dbGet === 'function') {
        const resetRow = await db.dbGet("SELECT value FROM settings WHERE key = '_ext_cover_reset'");
        if (resetRow?.value && resetRow.value !== todayPacific) {
          await getOrResetDailyUsage(db);
          logger('INFO', 'GEMINI_QUOTA', `🌅 Watchdog detected Pacific day rollover (${resetRow.value} -> ${todayPacific}); reset usage to 0.`);
        }
      }
    } catch (_) {}
  }, 60000);

  if (watchdogInterval.unref) {
    watchdogInterval.unref();
  }
}

function stopMidnightPacificScheduler() {
  if (midnightTimer) {
    clearTimeout(midnightTimer);
    midnightTimer = null;
  }
  if (watchdogInterval) {
    clearInterval(watchdogInterval);
    watchdogInterval = null;
  }
}

module.exports = {
  getPacificDateString,
  getMsUntilNextPacificMidnight,
  getOrResetDailyUsage,
  incrementDailyUsage,
  startMidnightPacificScheduler,
  stopMidnightPacificScheduler
};
