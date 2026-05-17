# Plan 12 — Wire `closeDb` into SIGTERM / SIGINT handlers

**Category:** Missing functionality — wire up, don't delete.

## Finding

`server/db.js:322 closeDb` is exported but `grep -rn "SIGTERM\|SIGINT\|process.on" server server.js` returns nothing. On `docker stop` / Ctrl-C / `kill <pid>` the process exits without flushing SQLite. With WAL mode under concurrent writes this can leave the journal in a state that requires recovery on next boot, and in the worst case can lose the most recent commits.

## Steps

1. In `server.js`, after `app.listen(...)`, install handlers:
   ```js
   const { closeDb } = require('./server/db');

   let shuttingDown = false;
   async function shutdown(signal) {
     if (shuttingDown) return;
     shuttingDown = true;
     log('INFO', 'SERVER', `Received ${signal}, shutting down…`);
     try {
       await closeDb();
       log('INFO', 'SERVER', 'DB closed cleanly.');
     } catch (e) {
       log('ERROR', 'SERVER', `closeDb failed: ${e.message}`);
     }
     process.exit(0);
   }

   process.on('SIGTERM', () => shutdown('SIGTERM'));
   process.on('SIGINT',  () => shutdown('SIGINT'));
   ```
2. Keep the listen reference: `const server = app.listen(PORT, …);` and inside `shutdown`, call `server.close()` before `closeDb()` so in-flight requests drain.
3. Optional follow-up: also cancel scheduled timers (`scheduleNextScan`, `scheduleCtRun`) so the process exits promptly. If timers aren't cancellable today, that's a separate plan.

## Test strategy

### Before
- `npm test`.
- Start server: `node server.js &` ; note PID.
- Hit an endpoint to make sure it's alive.
- `kill -TERM <pid>` ; observe: process exits, but no "DB closed" log line and `.db-wal` / `.db-shm` may linger.

### After
- `npm test` — unchanged.
- Same start + `kill -TERM` cycle. Expect log lines `Received SIGTERM…` and `DB closed cleanly.` Process exits within ~2 seconds.
- `Ctrl-C` in a foreground run: same logs.
- `docker stop comics-now` (if you run via Docker): logs visible in container output; container exits within Docker's default 10s grace period (not at 10s).
- Stress: send a large `GET /api/v1/library` and SIGTERM mid-flight. Request should complete (server.close drains) before the process exits.

## On failure

Per shared policy.
- **Process hangs and Docker SIGKILLs after 10s:** a connection or timer is keeping the event loop alive. Add `server.close()` first; if still hung, identify the open handle with `process._getActiveHandles()` and address that — don't shorten Docker's grace period.
- **`closeDb` rejects with "DB is locked":** an in-flight write is still in progress. Either await `server.close()` first (preferred) or accept the error and log it; do not swallow silently.
- **Tests fail:** unlikely — none of the existing tests exercise process signals. If a new integration test you write fails, the test setup probably starts a process but doesn't await its exit. Fix the test runner, not the handler.
