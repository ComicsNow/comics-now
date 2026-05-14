const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { ctLog } = require('../logger');
const { getConfig, getCtScheduleMinutes } = require('../config');
const { dbRun } = require('../db');
const { searchIssue, getIssueDetails } = require('./comicvine');

/**
 * Lazy-load scanLibrary to avoid potential circular dependencies
 */
function getScanLibrary() {
  return require('./library').scanLibrary;
}

// Interactive mode: use -i flag to prompt for matches
const CT_ARGS = ['-s', '-t', 'cr', '-f', '-o', '-i'];
const CT_SUCCESS_PATTERNS = [/tag\s+written/i, /archive\s+already\s+tagged/i, /tag\s+script:\s*success/i, /sidecar\s+written/i, /sidecar\s+updated/i];
const CT_FAIL_PATTERNS = [/no\s+match/i, /could\s+not\s+(?:identify|find)/i, /tag\s+script:\s*failed/i];

let ctInterval = null;
let ctRunning = false;
let currentProcess = null;
let pendingUserChoice = null;
let pendingMatchState = null; // Stores info about pending match for later response

/**
 * Parse a ComicTagger match line
 * Example: "1. Mugshots (2024) #2 [Mad Cave Studios] (7/2024) - Chapter Two: An Eye For An Eye"
 * Returns: { choice, title, year, issue, publisher, subtitle }
 */
function parseMatchLine(line) {
  try {
    // Pattern: number. Title (YEAR) #issue [Publisher] (date) - Subtitle
    const match = line.match(/^(\d+)\.\s*(.+?)\s*\((\d{4})\)\s*#(\d+)\s*\[([^\]]+)\](?:\s*\(([^)]+)\))?(?:\s*-\s*(.+))?$/);

    if (match) {
      return {
        choice: match[1],
        title: match[2].trim(),
        year: match[3],
        issue: match[4],
        publisher: match[5].trim(),
        date: match[6] ? match[6].trim() : null,
        subtitle: match[7] ? match[7].trim() : null
      };
    }

    // Fallback: simpler pattern without date/subtitle
    const simpleMatch = line.match(/^(\d+)\.\s*(.+?)\s*\((\d{4})\)\s*#(\d+)\s*\[([^\]]+)\]/);
    if (simpleMatch) {
      return {
        choice: simpleMatch[1],
        title: simpleMatch[2].trim(),
        year: simpleMatch[3],
        issue: simpleMatch[4],
        publisher: simpleMatch[5].trim(),
        date: null,
        subtitle: null
      };
    }

    return null;
  } catch (error) {
    ctLog(`Warning: Failed to parse match line: ${line}`);
    return null;
  }
}

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

    const allowedFormats = config.allowed_formats || 'cbz';
    const comicFiles = entries.filter(e => {
      if (!e.isFile()) return false;
      const ext = path.extname(e.name).toLowerCase();
      if (ext === '.cbz') return allowedFormats === 'cbz' || allowedFormats === 'both';
      if (ext === '.cbr') return allowedFormats === 'cbr' || allowedFormats === 'both';
      return false;
    });

    if (comicFiles.length === 0) {
      ctLog(`ⓘ No supported comic files found to process (Allowed: ${allowedFormats})`);
      return;
    }

    ctLog(`ⓘ Found ${comicFiles.length} comic file(s) to process`);
    ctLog('');

    let hasChanges = false;

    for (const entry of comicFiles) {
      const filePath = path.join(dir, entry.name);
      const isCbr = path.extname(entry.name).toLowerCase() === '.cbr';
      const args = [...CT_ARGS];
      if (isCbr) {
        // CBRs cannot be written to by ComicTagger, so we remove the -s (save) flag
        // and avoid using --sidecar as we now use the DB exclusively.
        const sIndex = args.indexOf('-s');
        if (sIndex > -1) args.splice(sIndex, 1);
      }
      args.push(filePath);

      ctLog(`─────────────────────────────────────────`);
      ctLog(`Processing: ${entry.name}${isCbr ? ' (CBR - DB only)' : ''}`);
      await new Promise(async (resolve) => {
        currentProcess = spawn(config.comictaggerPath, args, {
          stdio: ['pipe', 'pipe', 'pipe']
        });
        let decision = null;
        let awaitingUserInput = false;
        let userChoiceResolver = null;
        let processExited = false;
        let collectingMatches = false;
        let collectedMatches = [];
        let autoSelectedMatch = null;
        let userSelectedChoice = null;

        const handleLine = (l) => {
          // Skip empty lines
          const trimmed = l.trim();
          if (!trimmed) return;

          ctLog(trimmed);

          // Detect auto-selected match (usually has a checkmark or arrow)
          if (/^[✓❯]\s*\d+\./.test(trimmed)) {
            const cleaned = trimmed.replace(/^[✓❯]\s*/, '');
            autoSelectedMatch = parseMatchLine(cleaned);
          }

          // Start collecting matches when we see the header
          if (/low-confidence match/i.test(l) || /Multiple.*matches/i.test(l) || /Archives with low-confidence/i.test(l)) {
            collectingMatches = true;
            collectedMatches = [];
            return;
          }

          // Collect match lines
          const cleanedLine = trimmed.replace(/^[❯⊘✓✗►▶•]\s*/, '');
          if (collectingMatches && /^\d+\./.test(cleanedLine)) {
            const parsed = parseMatchLine(cleanedLine);
            if (parsed) {
              collectedMatches.push(parsed);
            }
            return;
          }

          // Detect when ComicTagger is asking for user selection
          if (/Choose a match.*or.*skip/i.test(l)) {
            if (!awaitingUserInput) {
              awaitingUserInput = true;
              ctLog('>>> WAITING FOR USER SELECTION <<<');

              pendingMatchState = {
                fileName: entry.name,
                filePath: filePath,
                matches: collectedMatches,
                timestamp: new Date().toISOString(),
                waitingForResponse: true
              };

              collectingMatches = false;

              pendingUserChoice = new Promise((resolveChoice) => {
                userChoiceResolver = resolveChoice;
                currentProcess.resolveUserChoice = resolveChoice;
                currentProcess.currentFile = entry.name;
              });

              pendingUserChoice.then((choice) => {
                if (choice === 'skip' || choice === 's' || choice === 'timeout') {
                  decision = 'no';
                  ctLog(`✗ User skipped match`);
                } else {
                  decision = 'yes';
                  userSelectedChoice = choice;
                  ctLog(`✓ User selected match #${choice}`);
                }
                pendingMatchState = null;
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

          if (awaitingUserInput && userChoiceResolver) {
            userChoiceResolver('timeout');
            pendingMatchState = null;
          }

          if (pendingUserChoice) {
            try { await pendingUserChoice; } catch {}
          }

          // For CBRs, if no explicit failure and we have a match, consider it successful
          const isSuccessful = decision === 'yes' || (!decision && code === 0 && (autoSelectedMatch || userSelectedChoice));
          
          if (isSuccessful) {
            let matchToUse = autoSelectedMatch;
            if (userSelectedChoice) {
              matchToUse = collectedMatches.find(m => m.choice === userSelectedChoice);
            }

            if (isCbr && matchToUse) {
              try {
                ctLog(`ⓘ Fetching full metadata for: ${matchToUse.title} (${matchToUse.year}) #${matchToUse.issue}`);
                const searchResults = await searchIssue(matchToUse.title, matchToUse.year, matchToUse.issue);
                
                // Find best match in search results (usually the first one if searching for specific issue)
                if (searchResults.length > 0) {
                  const bestMatch = searchResults[0]; 
                  const fullMeta = await getIssueDetails(bestMatch.id);
                  if (fullMeta) {
                    await dbRun('UPDATE comics SET metadata = ? WHERE path = ?', [JSON.stringify(fullMeta), filePath]);
                    ctLog(`✓ Saved metadata to database for CBR: ${entry.name}`);
                  }
                } else {
                  ctLog(`⚠ Could not find matching issue on ComicVine for DB update`);
                }
              } catch (err) {
                ctLog(`✗ Failed to update DB metadata for CBR: ${err.message}`);
              }
            }

            const destDir = path.join(dir, 'yes');
            try {
              await fs.promises.mkdir(destDir, { recursive: true });
              await fs.promises.rename(filePath, path.join(destDir, entry.name));
              ctLog(`✓ SUCCESS → Moved to /yes/ folder: ${entry.name}`);
              hasChanges = true;
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

    if (hasChanges) {
      ctLog('ⓘ Triggering library scan due to changes');
      const scan = getScanLibrary();
      if (scan) scan();
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
