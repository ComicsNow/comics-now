#!/usr/bin/env node
/**
 * Comics Now! - ReadingOrders CLI runner
 * Executes the Python continuity crawler synchronously from the command line.
 */
const { spawnSync } = require('child_process');
const path = require('path');

const res = spawnSync(
  'python3',
  [
    '-c',
    'from tagger_app.continuity.crawler import continuity_crawler; res = continuity_crawler.start_sync(run_async=False); print("Crawl complete:", res)'
  ],
  {
    cwd: path.join(__dirname, '../tagger'),
    stdio: 'inherit'
  }
);

process.exit(res.status || 0);
