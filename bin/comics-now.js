#!/usr/bin/env node

/**
 * Comics Now! CLI Launcher
 * Enables running Comics Now via `npx comics-now` or global npm installation.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const pkg = require('../package.json');

const args = process.argv.slice(2);

function printHelp() {
  console.log(`
Comics Now! 💥📚 v${pkg.version}
Modern self-hosted comic book library server and AI-augmented reader.

Usage:
  comics-now [options]
  npx comics-now [options]

Options:
  -p, --port <port>       Port to listen on (default: 3000 or process.env.PORT)
  -c, --comics <path>     Directory path to comic books (default: /comics)
  -d, --data-dir <path>   Directory to store database, config, and thumbnails
                          (default: ~/.comics-now)
  -h, --help              Display this help message
  -v, --version           Display version number

Examples:
  npx comics-now
  npx comics-now --port 4000 --comics ~/Comics
  npx comics-now --data-dir ./my-comics-data --comics /mnt/media/comics
`);
  process.exit(0);
}

function printVersion() {
  console.log(`v${pkg.version}`);
  process.exit(0);
}

// Parse arguments
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '-h' || arg === '--help') {
    printHelp();
  } else if (arg === '-v' || arg === '--version') {
    printVersion();
  } else if (arg === '-p' || arg === '--port') {
    const val = args[++i];
    if (!val || isNaN(Number(val))) {
      console.error('Error: --port requires a valid port number.');
      process.exit(1);
    }
    process.env.PORT = val;
  } else if (arg === '-c' || arg === '--comics') {
    const val = args[++i];
    if (!val) {
      console.error('Error: --comics requires a directory path.');
      process.exit(1);
    }
    process.env.COMICS_LOCATION = path.resolve(val);
  } else if (arg === '-d' || arg === '--data-dir') {
    const val = args[++i];
    if (!val) {
      console.error('Error: --data-dir requires a directory path.');
      process.exit(1);
    }
    process.env.DATA_DIR = path.resolve(val);
  }
}

// Default DATA_DIR for CLI / npm execution to user's home directory if not set
if (!process.env.DATA_DIR) {
  process.env.DATA_DIR = path.join(os.homedir(), '.comics-now');
}

// Ensure DATA_DIR exists
try {
  if (!fs.existsSync(process.env.DATA_DIR)) {
    fs.mkdirSync(process.env.DATA_DIR, { recursive: true });
  }
} catch (err) {
  console.error(`Error: Could not create data directory at "${process.env.DATA_DIR}":`, err.message);
  process.exit(1);
}

// Print welcome banner
console.log(`
\x1b[36m╔═══════════════════════════════════════════════════════════╗\x1b[0m
\x1b[36m║\x1b[0m                     \x1b[1mComics Now! 💥📚\x1b[0m                      \x1b[36m║\x1b[0m
\x1b[36m║\x1b[0m         \x1b[90mv${pkg.version.padEnd(8)} · Modern Comic Library Server\x1b[0m          \x1b[36m║\x1b[0m
\x1b[36m╚═══════════════════════════════════════════════════════════╝\x1b[0m
`);
console.log(`\x1b[32m✔\x1b[0m Data Directory:   \x1b[33m${process.env.DATA_DIR}\x1b[0m`);
if (process.env.COMICS_LOCATION) {
  console.log(`\x1b[32m✔\x1b[0m Comics Directory: \x1b[33m${process.env.COMICS_LOCATION}\x1b[0m`);
}
console.log('');

// Hand off execution to server.js
require('../server.js');
