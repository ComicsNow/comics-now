const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { ctLog } = require('../logger');
const { getConfig, getCtScheduleMinutes } = require('../config');

// Interactive mode: use -i flag to prompt for matches
const CT_ARGS = ['-s', '-t', 'cr', '-f', '-o', '-i'];
const CT_SUCCESS_PATTERNS = [/tag\s+written/i, /archive\s+already\s+tagged/i, /tag\s+script:\s*success/i];
const CT_FAIL_PATTERNS = [/no\s+match/i, /could\s+not\s+(?:identify|find)/i, /tag\s+script:\s*failed/i];

let ctInterval = null;
let ctRunning = false;
let currentProcess = null;
let pendingUserChoice = null;
let pendingMatchState = null; // Stores info about pending match for later response

async function runComicTagger() {
  if (ctRunning) {
    ctLog('ComicTagger already running.');
    return;
  }
  ctRunning = true;
  try {
    ctLog('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    ctLog('Starting ComicTagger run...');
    ctLog('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    const config = getConfig();
    const dir = config.comicsLocation;
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });

    const cbzFiles = entries.filter(e => e.isFile() && path.extname(e.name).toLowerCase() === '.cbz');
    if (cbzFiles.length === 0) {
      ctLog('ⓘ No CBZ files found to process');
      return;
    }

    ctLog(`ⓘ Found ${cbzFiles.length} CBZ file(s) to process`);
    ctLog('');

    for (const entry of cbzFiles) {
      const filePath = path.join(dir, entry.name);
      ctLog(`─────────────────────────────────────────`);
      ctLog(`Processing: ${entry.name}`);
      await new Promise(async (resolve) => {
        currentProcess = spawn(config.comictaggerPath, [...CT_ARGS, filePath], {
          stdio: ['pipe', 'pipe', 'pipe']
        });
        let decision = null;
        let awaitingUserInput = false;
        let userChoiceResolver = null;
        let processExited = false;

        const handleLine = (l) => {
          // Skip empty lines
          const trimmed = l.trim();
          if (!trimmed) return;

          ctLog(trimmed);

          // Detect when ComicTagger is asking for user selection
          // Pattern: "Choose a match #, or 's' to skip:"
          if (/Choose a match.*or.*skip/i.test(l)) {
            if (!awaitingUserInput) {
              awaitingUserInput = true;
              ctLog('>>> WAITING FOR USER SELECTION <<<');

              // Store pending match state for later retrieval
              pendingMatchState = {
                fileName: entry.name,
                timestamp: new Date().toISOString(),
                waitingForResponse: true
              };

              // Create a promise that will be resolved when user makes a choice
              pendingUserChoice = new Promise((resolveChoice) => {
                userChoiceResolver = resolveChoice;
                currentProcess.resolveUserChoice = resolveChoice;
                currentProcess.currentFile = entry.name;
              });

              // Wait for user choice in the background
              pendingUserChoice.then((choice) => {
                if (choice === 'skip' || choice === 's') {
                  ctLog(`✗ User skipped match`);
                } else {
                  ctLog(`✓ User selected match #${choice}`);
                }
                // Clear pending state once choice is made
                pendingMatchState = null;
                // If process hasn't exited yet, we successfully handled the choice
                if (!processExited) {
                  decision = 'yes'; // Assume success if user made a choice
                }
              }).catch((err) => {
                ctLog(`✗ Error handling user choice: ${err.message}`);
                pendingMatchState = null;
              });
            }
          }

          if (CT_SUCCESS_PATTERNS.some(r => r.test(l))) decision = 'yes';
          if (CT_FAIL_PATTERNS.some(r => r.test(l))) decision = 'no';
        };

        currentProcess.stdout.on('data', d => d.toString().split(/\r?\n/).forEach(l => l && handleLine(l)));
        currentProcess.stderr.on('data', d => d.toString().split(/\r?\n/).forEach(l => l && handleLine(l)));

        currentProcess.on('close', async (code) => {
          processExited = true;

          // If we were waiting for user input and process closed without choice, resolve it
          if (awaitingUserInput && userChoiceResolver) {
            userChoiceResolver('timeout');
            pendingMatchState = null;
          }

          const isSuccessful = decision === 'yes' || (!decision && code === 0);
          if (isSuccessful) {
            const destDir = path.join(dir, 'yes');
            try {
              await fs.promises.mkdir(destDir, { recursive: true });
              await fs.promises.rename(filePath, path.join(destDir, entry.name));
              ctLog(`✓ SUCCESS → Moved to /yes/ folder: ${entry.name}`);
            } catch (err) {
              ctLog(`✗ Failed to move file: ${err.message}`);
            }
          } else {
            ctLog(`➜ KEPT (no changes): ${entry.name}`);
          }
          ctLog('');
          currentProcess = null;
          pendingUserChoice = null;
          resolve();
        });
      });
    }
    ctLog('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    ctLog('✓ ComicTagger run completed successfully');
    ctLog('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  } catch (err) {
    ctLog('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    ctLog(`✗ ComicTagger error: ${err.message}`);
    ctLog('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  } finally {
    ctRunning = false;
    currentProcess = null;
    pendingUserChoice = null;
    pendingMatchState = null;
  }
}

function getPendingMatch() {
  return pendingMatchState;
}

function applyUserSelection(selections) {
  if (!currentProcess || !currentProcess.resolveUserChoice) {
    throw new Error('No process waiting for user input');
  }

  // Send selection to ComicTagger stdin
  const choice = selections[0] || '0'; // Take first selection or skip
  currentProcess.stdin.write(`${choice}\n`);
  currentProcess.resolveUserChoice(choice);

  ctLog(`✓ Applied user selection: #${choice}`);
}

function skipCurrentMatch() {
  if (!currentProcess || !currentProcess.resolveUserChoice) {
    throw new Error('No process waiting for user input');
  }

  // Send 's' to skip (ComicTagger expects 's' character)
  currentProcess.stdin.write('s\n');
  currentProcess.resolveUserChoice('skip');

  ctLog('⊘ User skipped match');
}

function scheduleCtRun() {
  if (ctInterval) clearInterval(ctInterval);
  const minutes = getCtScheduleMinutes();
  if (minutes > 0) {
    ctInterval = setInterval(() => {
      runComicTagger();
    }, minutes * 60 * 1000);
  }
}

module.exports = {
  runComicTagger,
  scheduleCtRun,
  applyUserSelection,
  skipCurrentMatch,
  getPendingMatch
};
