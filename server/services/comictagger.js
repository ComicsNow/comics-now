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
const CT_SUCCESS_PATTERNS = [/save\s+complete/i, /tag\s+written/i, /archive\s+already\s+tagged/i, /tag\s+script:\s*success/i, /sidecar\s+written/i, /sidecar\s+updated/i];
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
    // 1. Strip all leading junk (symbols, spaces, progress markers)
    // We look for the FIRST pattern of "Number." or "Number:" 
    // This handles symbols like ❯, ✓, or even just leading spaces.
    const cleanLine = line.replace(/^.*?(\d+[.:])/, '$1').trim();

    // 2. Extract choice and rest using anchored regex for precision
    const startMatch = cleanLine.match(/^(\d+)[.:]\s*(.+)$/);
    if (!startMatch) return null;

    const choice = startMatch[1];
    const rest = startMatch[2].trim();

    // Now try to parse the rich metadata from the "rest"
    // Title (YEAR) #issue [Publisher] ...
    const richMatch = rest.match(/^(.+?)(?:\s+\((\d{4})\))?(?:\s+(?:#)?(\d+[\w\d]*)?)?(?:\s+\[([^\]]+)\])?(?:\s+(.+))?$/);

    if (richMatch) {
      return {
        choice: choice,
        title: richMatch[1].trim(),
        year: richMatch[2] || null,
        issue: richMatch[3] || '?',
        publisher: richMatch[4] ? richMatch[4].trim() : 'Unknown',
        extra: richMatch[5] ? richMatch[5].trim() : null
      };
    }

    // Fallback if rich parsing fails
    return {
      choice: choice,
      title: rest,
      year: null,
      issue: '?',
      publisher: 'Unknown',
      extra: null
    };
  } catch (error) {
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
        let stdoutRemainder = '';
        let stderrRemainder = '';

        const stripAnsi = (str) => str.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');

        const handleLine = (l) => {
          // Skip empty lines
          let trimmed = l.trim();
          if (!trimmed) return;
          
          // Strip ANSI colors/codes that ComicTagger might output
          trimmed = stripAnsi(trimmed);

          ctLog(trimmed);

          // 1. Check for failure patterns IMMEDIATELY to avoid misidentifying headers
          if (CT_FAIL_PATTERNS.some(r => r.test(trimmed))) {
            decision = 'no';
            if (collectingMatches || awaitingUserInput) {
              ctLog(`ⓘ FAILURE DETECTED: Aborting match collection/input.`);
              collectingMatches = false;
              awaitingUserInput = false;
              if (userChoiceResolver) {
                userChoiceResolver('skip');
              }
              pendingMatchState = null;
            }
            return;
          }

          // 2. Check for success patterns
          if (CT_SUCCESS_PATTERNS.some(r => r.test(trimmed))) {
            decision = 'yes';
            // If we were expecting input or collecting matches, a success pattern means
            // the operation is finished (likely an auto-match or script completion).
            if (collectingMatches || awaitingUserInput) {
              ctLog(`ⓘ SUCCESS DETECTED: Clearing pending match state.`);
              collectingMatches = false;
              awaitingUserInput = false;
              if (userChoiceResolver) {
                userChoiceResolver('skip');
              }
              pendingMatchState = null;
            }
          }

          // Add debug logging during collection
          if (collectingMatches) {
            ctLog(`[DEBUG] Processing line during collection: ${trimmed}`);
          }

          // Detect auto-selected match (usually has a checkmark or arrow)
          if (/^[✓❯]\s*\d+\./.test(trimmed)) {
            const cleaned = trimmed.replace(/^[✓❯]\s*/, '');
            autoSelectedMatch = parseMatchLine(cleaned);
          }

          // Start collecting matches when we see the header
          // Broad check for headers: "Matches found", "Possible matches", "Search results", "Archives with", etc.
          // REFINED: Exclude lines that explicitly say "No matches" or "Successful matches"
          const isMatchHeader = (/matches/i.test(trimmed) || 
                                 /Archives with/i.test(trimmed) || 
                                 /Search results/i.test(trimmed) || 
                                 /Multiple.*found/i.test(trimmed) || 
                                 /Suggested matches/i.test(trimmed)) && 
                                !/no\s+matches/i.test(trimmed) &&
                                !/Successful matches/i.test(trimmed);

          if (isMatchHeader) {
            // Only reset if we aren't already collecting to avoid double-resetting on multi-line headers
            if (!collectingMatches) {
              collectingMatches = true;
              collectedMatches = [];
              ctLog(`ⓘ DETECTED MATCH LIST START: ${trimmed}`);
              
              // Ensure we have an absolute path for the preview endpoint
              const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(filePath);
              
              // Pre-initialize pending state
              pendingMatchState = {
                fileName: entry.name,
                filePath: absolutePath,
                matches: [],
                timestamp: new Date().toISOString(),
                waitingForResponse: true,
                isFinal: false,
                previewBuffer: null,
                previewMime: null
              };

              // INITIALIZE RESOLVER EARLY: This allows "Apply" to work even if we haven't
              // officially hit the prompt yet in the logs (race condition fix).
              pendingUserChoice = new Promise((resolveChoice) => {
                userChoiceResolver = resolveChoice;
                currentProcess.resolveUserChoice = resolveChoice;
                currentProcess.currentFile = entry.name;
              });
              
              // Background extract and cache the preview image
              (async () => {
                try {
                  const library = require('./library');
                  const pages = await library.getComicPages(absolutePath);
                  if (pages && pages.length > 0) {
                    const firstPage = pages[0];
                    const buffer = await library.extractPageBuffer(absolutePath, firstPage);
                    if (buffer && pendingMatchState && pendingMatchState.filePath === absolutePath) {
                      const { getMimeFromExt } = require('../utils');
                      pendingMatchState.previewBuffer = buffer;
                      pendingMatchState.previewMime = getMimeFromExt(firstPage);
                      ctLog(`ⓘ Cached preview image for: ${entry.name}`);
                    }
                  }
                } catch (err) {}
              })();

              ctLog(`ⓘ Initialized pending match state for: ${entry.name}`);
            }
            // NO RETURN HERE - let the line fall through in case a match is on the same line!
          }

          // Collect match lines
          if (collectingMatches) {
            // Check if we hit the prompt
            // Pattern covers: "Choose a match", "Enter selection", "[1-5]:", "[1-5] (s to skip):"
            if (/Choose a match/i.test(trimmed) || /Enter selection/i.test(trimmed) || /Select an option/i.test(trimmed) || /Select a match/i.test(trimmed) || /\[\d+-\d+\]/.test(trimmed)) {
              awaitingUserInput = true;
              collectingMatches = false;

              // Finalize match list for UI
              if (pendingMatchState) {
                pendingMatchState.matches = [...collectedMatches];
                pendingMatchState.isFinal = true;
              }

              // Safety check: if we hit a prompt but have no matches, don't hang the UI
              if (collectedMatches.length === 0) {
                ctLog('⚠️ WARNING: No matches were parsed during collection phase! Auto-skipping prompt.');
                if (userChoiceResolver) {
                  userChoiceResolver('skip');
                }
                pendingMatchState = null;
                awaitingUserInput = false;
                return;
              }

              ctLog(`>>> WAITING FOR USER SELECTION (Found ${collectedMatches.length} matches)`);

              pendingUserChoice.then((choice) => {
                if (choice === 'skip' || choice === 's' || choice === 'timeout') {
                  decision = 'no';
                  ctLog(`✗ User skipped match`);
                } else {
                  userSelectedChoice = choice;
                  decision = 'yes';
                  ctLog(`✓ User selected match #${choice}`);
                }
                pendingMatchState = null;
              }).catch((err) => {
                ctLog(`✗ Error handling user choice: ${err.message}`);
                pendingMatchState = null;
              });
              return;
            }

            const parsed = parseMatchLine(trimmed);
            if (parsed) {
              collectedMatches.push(parsed);
              // Update state in real-time so "Grab Matches" works even before the prompt
              if (pendingMatchState) {
                pendingMatchState.matches = [...collectedMatches];
              }
            } else {
               // Log lines that look like matches but failed to parse
               if (/^\d+[.:]/.test(trimmed) || /^[✓❯]\s*\d+[.:]/.test(trimmed)) {
                 ctLog(`⚠️ FAILED TO PARSE POTENTIAL MATCH: ${trimmed}`);
               }
            }
            return;
          }
        };

        currentProcess.stdout.on('data', d => {
          // Split on both \n and \r to handle progress bars and line updates correctly
          const lines = (stdoutRemainder + d.toString()).split(/\r\n|\r|\n/);
          stdoutRemainder = lines.pop();
          lines.forEach(l => handleLine(l));
        });

        currentProcess.stderr.on('data', d => {
          const lines = (stderrRemainder + d.toString()).split(/\r\n|\r|\n/);
          stderrRemainder = lines.pop();
          lines.forEach(l => handleLine(l));
        });

        currentProcess.on('close', async (code) => {
          processExited = true;
          if (stdoutRemainder) handleLine(stdoutRemainder);
          if (stderrRemainder) handleLine(stderrRemainder);

          if (awaitingUserInput && userChoiceResolver) {
            ctLog('ⓘ Process closed while waiting for user input - resolving as timeout');
            userChoiceResolver('timeout');
            pendingMatchState = null;
          }

          if (pendingUserChoice) {
            try { await pendingUserChoice; } catch {}
          }

          // For CBRs, if no explicit failure and we have a match, consider it successful
          const isSuccessful = decision === 'yes' || (!decision && code === 0 && (autoSelectedMatch || userSelectedChoice));
          
          ctLog(`ⓘ Process finished with code ${code}. Decision: ${decision || 'none'}. Successful: ${isSuccessful}`);

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

            const id = require('../utils').createId(filePath);
            const tagStatus = isSuccessful ? 'successful' : 'failed';
            try {
              await dbRun(
                `INSERT OR IGNORE INTO comics (id, path, name, publisher, series, libraryMode, tagStatus) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [id, filePath, entry.name, 'Unknown Publisher', 'Unknown Series', 'metadata', 'pending']
              );
              await dbRun(`UPDATE comics SET tagStatus = ? WHERE id = ?`, [tagStatus, id]);
              ctLog(`✓ SUCCESS → Tagged in database as successful: ${entry.name}`);
              hasChanges = true;
            } catch (err) {
              ctLog(`✗ Failed to update tagStatus in database for ${entry.name}: ${err.message}`);
            }
          } else {
            const id = require('../utils').createId(filePath);
            try {
              await dbRun(
                `INSERT OR IGNORE INTO comics (id, path, name, publisher, series, libraryMode, tagStatus) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [id, filePath, entry.name, 'Unknown Publisher', 'Unknown Series', 'metadata', 'pending']
              );
              await dbRun(`UPDATE comics SET tagStatus = ? WHERE id = ?`, ['failed', id]);
            } catch (err) {}
            ctLog(`➜ KEPT in place (not a confirmed match): ${entry.name}`);
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
    ctLog('⚠ ERROR: No process waiting for user input when trying to apply selection');
    throw new Error('No process waiting for user input');
  }

  const choice = selections[0] || '0';
  
  try {
    if (currentProcess.stdin.writable) {
      ctLog(`ⓘ Sending selection #${choice} to ComicTagger and closing stdin...`);
      // Using end() ensures the input is flushed and the stream is closed, 
      // which some CLI tools prefer for single inputs.
      currentProcess.stdin.end(`${choice}\n`);
      ctLog(`✓ Selection #${choice} sent successfully`);
      
      // Resolve the internal promise
      currentProcess.resolveUserChoice(choice);
    } else {
      ctLog('⚠ ERROR: ComicTagger stdin is not writable!');
      currentProcess.resolveUserChoice('timeout');
    }
  } catch (err) {
    ctLog(`✗ CRITICAL ERROR applying selection: ${err.message}`);
    currentProcess.resolveUserChoice('timeout');
  }
}

function skipCurrentMatch() {
  if (!currentProcess || !currentProcess.resolveUserChoice) {
    ctLog('⚠ ERROR: No process waiting for user input when trying to skip');
    throw new Error('No process waiting for user input');
  }

  try {
    if (currentProcess.stdin.writable) {
      ctLog(`ⓘ Sending skip command 's' to ComicTagger and closing stdin...`);
      currentProcess.stdin.end('s\n');
      ctLog(`✓ Skip command sent successfully`);
      
      currentProcess.resolveUserChoice('skip');
    } else {
      ctLog('⚠ ERROR: ComicTagger stdin is not writable for skip!');
      currentProcess.resolveUserChoice('skip');
    }
  } catch (err) {
    ctLog(`✗ CRITICAL ERROR applying skip: ${err.message}`);
    currentProcess.resolveUserChoice('skip');
  }
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
