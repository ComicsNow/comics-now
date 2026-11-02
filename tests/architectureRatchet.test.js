/**
 * Architectural Ratchet & Code Health Invariants Test
 *
 * Enforces permanent bans on:
 * 1. Monolithic Files & Responsibility Smearing (> 380 lines in protected & new files).
 * 2. The "Inline Require" Pattern (Dynamic Runtime Imports).
 *
 * Uses a Ratchet Architecture:
 * - Strictly protects all recently modularized code (tagger_app, library/render, viewer/fullscreen, comictagger).
 * - Strictly enforces < 380 lines on all newly created files.
 * - Grandfathers the 55 known legacy files so `npm test` passes 100% cleanly without breaking CI or builds.
 */

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const MAX_LINES = 380;

// The Grandfathered Legacy Files (All 8 Tier 1 monoliths have been decomposed!)
const GRANDFATHERED_LEGACY_FILES = new Set([]);

// Documented Cohesive Architectural Exemptions (Indivisible single responsibilities where splitting harms cohesion)
const COHESIVE_EXEMPTIONS = new Map([
  [
    'tagger/tagger_app/sources/amazon.py',
    'Multi-tier DOM fallback scraper (JSON-LD, desktop selectors, and semantic scanner sharing in-flight context)'
  ],
  [
    'public/service-worker.js',
    'W3C Service Worker single-file scope specification constraint'
  ],
  [
    'scripts/modal/modal_app.py',
    'Modal cloud deployment single-entrypoint app specification'
  ],
  [
    'scripts/colab/colab_bulk_guided_view.py',
    'Standalone Google Colab GPU batch inference script for PaliGemma 2 panel & bubble detection'
  ],
  [
    'public/js/viewer/fullscreen/pan.js',
    'Integrated 2D gesture and viewport matrix transformation math'
  ],
  [
    'server/services/gemini-cover.js',
    'Single-purpose multimodal vision API client'
  ],
  [
    'public/js/viewer/guided/overlay.js',
    'Integrated SVG panel mask and Bézier path renderer'
  ],
  [
    'scripts/colab/colab_speaker_attribution.py',
    'Standalone Google Colab GPU/TPU notebook script for Gemini speaker attribution'
  ],
  [
    'tagger/tagger_app/core/comicinfo.py',
    'Exhaustive ComicInfo XML v2.1 schema serialization'
  ]
]);

function isExempt(rel) {
  return GRANDFATHERED_LEGACY_FILES.has(rel) || COHESIVE_EXEMPTIONS.has(rel);
}

function countLines(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return content.split(/\r\n|\r|\n/).length;
  } catch {
    return 0;
  }
}

function walkDir(dir, fileList = [], extensions = ['.js', '.py']) {
  if (!fs.existsSync(dir)) return fileList;
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    if (file === 'node_modules' || file === '.venv' || file === 'dist' || file === '.git' || file === 'coverage' || file === 'tests') {
      continue;
    }
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      walkDir(fullPath, fileList, extensions);
    } else if (extensions.some(ext => file.endsWith(ext))) {
      fileList.push(fullPath);
    }
  }
  return fileList;
}

describe('Architectural Ratchet & Code Health Invariants', () => {
  test('Protected modularized submodules must strictly remain under 380 lines', () => {
    const protectedDirs = [
      path.join(ROOT_DIR, 'tagger/tagger_app/blueprints'),
      path.join(ROOT_DIR, 'tagger/tagger_app/sources'),
      path.join(ROOT_DIR, 'public/js/comictagger'),
      path.join(ROOT_DIR, 'public/js/viewer/fullscreen'),
      path.join(ROOT_DIR, 'public/js/library/render'),
      path.join(ROOT_DIR, 'server/routes/user/reading-lists'),
      path.join(ROOT_DIR, 'server/services/metadata'),
      path.join(ROOT_DIR, 'public/js/continuous'),
      path.join(ROOT_DIR, 'tagger/tagger_app/core/metadata_parts'),
      path.join(ROOT_DIR, 'public/js/offline/downloads'),
      path.join(ROOT_DIR, 'server/routes/user/metadata'),
      path.join(ROOT_DIR, 'mcp/comics_mcp'),
      path.join(ROOT_DIR, 'public/js/app')
    ];

    const violations = [];

    for (const dir of protectedDirs) {
      if (!fs.existsSync(dir)) continue;
      const files = walkDir(dir);
      for (const file of files) {
        const rel = path.relative(ROOT_DIR, file).replace(/\\/g, '/');
        // Exclude legacy allowlisted and documented cohesive exemptions
        if (isExempt(rel)) continue;

        const lines = countLines(file);
        if (lines > MAX_LINES) {
          violations.push(`${rel}: ${lines} lines (exceeds ${MAX_LINES})`);
        }
      }
    }

    // Also check tagger/tagger_app/core/enrichment.py
    const enrichmentPath = path.join(ROOT_DIR, 'tagger/tagger_app/core/enrichment.py');
    if (fs.existsSync(enrichmentPath)) {
      const enrichmentLines = countLines(enrichmentPath);
      if (enrichmentLines > MAX_LINES) {
        violations.push(`tagger/tagger_app/core/enrichment.py: ${enrichmentLines} lines`);
      }
    }

    expect(violations).toEqual([]);
  });

  test('Protected JavaScript submodules must not contain inline requires', () => {
    const protectedDirs = [
      path.join(ROOT_DIR, 'public/js/comictagger'),
      path.join(ROOT_DIR, 'public/js/library/render'),
      path.join(ROOT_DIR, 'public/js/viewer/fullscreen')
    ];

    const inlineViolations = [];

    for (const dir of protectedDirs) {
      if (!fs.existsSync(dir)) continue;
      const files = walkDir(dir, [], ['.js']);
      for (const file of files) {
        const content = fs.readFileSync(file, 'utf8');
        const lines = content.split(/\r\n|\r|\n/);
        const rel = path.relative(ROOT_DIR, file).replace(/\\/g, '/');

        lines.forEach((lineText, idx) => {
          // Detect require(...) calls that are indented / inside functions
          if (/^\s{2,}.*require\(/.test(lineText) && !lineText.includes('//') && !lineText.includes('jest.mock')) {
            inlineViolations.push(`${rel}:${idx + 1} -> ${lineText.trim()}`);
          }
        });
      }
    }

    expect(inlineViolations).toEqual([]);
  });

  test('New source files outside the grandfathered allowlist must strictly remain under 380 lines', () => {
    const scanDirs = [
      path.join(ROOT_DIR, 'server'),
      path.join(ROOT_DIR, 'public/js'),
      path.join(ROOT_DIR, 'tagger/tagger_app'),
      path.join(ROOT_DIR, 'mcp/comics_mcp')
    ];

    const newFileViolations = [];

    for (const dir of scanDirs) {
      const files = walkDir(dir);
      for (const file of files) {
        const rel = path.relative(ROOT_DIR, file).replace(/\\/g, '/');
        if (isExempt(rel)) {
          continue; // Grandfathered or documented cohesive exemption
        }

        const lines = countLines(file);
        if (lines > MAX_LINES) {
          newFileViolations.push(`${rel}: ${lines} lines (exceeds ${MAX_LINES})`);
        }
      }
    }

    expect(newFileViolations).toEqual([]);
  });

  test('Grandfathered legacy files allowlist is correctly documented and tracked', () => {
    expect(GRANDFATHERED_LEGACY_FILES.size).toBe(0);
  });

  test('Cohesive architectural exemptions have documented rationales, valid file paths, and source headers', () => {
    expect(COHESIVE_EXEMPTIONS.size).toBe(9);
    for (const [relPath, rationale] of COHESIVE_EXEMPTIONS.entries()) {
      expect(typeof rationale).toBe('string');
      expect(rationale.trim().length).toBeGreaterThan(15);
      const full = path.join(ROOT_DIR, relPath);
      expect(fs.existsSync(full)).toBe(true);
      const content = fs.readFileSync(full, 'utf8');
      expect(content).toMatch(/ARCHITECTURAL_EXEMPTION:/);
    }
  });
});
