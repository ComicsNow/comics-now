const { log } = require('./logger');
const { closeDb } = require('./db');
const { stopTaggerWorker } = require('./services/tagger-process');

/**
 * Attaches graceful shutdown handlers to SIGINT and SIGTERM.
 *
 * @param {import('http').Server} server - Active Express HTTP server instance
 */
function setupGracefulShutdown(server) {
  let shuttingDown = false;

  async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    log('INFO', 'SERVER', `Received ${signal}, shutting down…`);

    server.close(async () => {
      log('INFO', 'SERVER', 'HTTP server closed.');
      stopTaggerWorker();
      try {
        await closeDb();
        log('INFO', 'SERVER', 'DB closed cleanly.');
      } catch (e) {
        log('ERROR', 'SERVER', `closeDb failed: ${e.message}`);
      }
      process.exit(0);
    });

    // Fallback exit if server.close hangs
    const forceExitTimer = setTimeout(() => {
      log('WARN', 'SERVER', 'Shutdown timed out, forcing exit.');
      stopTaggerWorker();
      process.exit(1);
    }, 10000);
    forceExitTimer.unref();
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  return { shutdown };
}

module.exports = {
  setupGracefulShutdown
};
