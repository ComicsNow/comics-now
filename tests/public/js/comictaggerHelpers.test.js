const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadModuleInVm(relPath, sandbox) {
  const fullPath = path.resolve(__dirname, '../../..', relPath);
  const content = fs.readFileSync(fullPath, 'utf8');

  const cleanContent = content
    .replace(/import\s+[\s\S]*?from\s+['"][^'"]+['"];?/g, '')
    .replace(/export\s+[\s\S]*?\s+from\s+['"][^'"]+['"];?/g, '')
    .replace(/export\s+class\s+([a-zA-Z0-9_$]+)/g, 'globalThis.$1 = class $1')
    .replace(/export\s+function\s+([a-zA-Z0-9_$]+)/g, 'globalThis.$1 = function $1')
    .replace(/export\s+async\s+function\s+([a-zA-Z0-9_$]+)/g, 'globalThis.$1 = async function $1')
    .replace(/export\s+const\s+([a-zA-Z0-9_$]+)\s*=/g, 'globalThis.$1 =')
    .replace(/export\s+let\s+([a-zA-Z0-9_$]+)\s*=/g, 'globalThis.$1 =')
    .replace(/\bconst\s+/g, 'var ')
    .replace(/\blet\s+/g, 'var ')
    .replace(/export\s+\{[\s\S]*?\};?/g, '')
    .replace(/export\s+default\s+[\s\S]*?;?/g, '');

  const script = new vm.Script(cleanContent);
  script.runInContext(sandbox);
}

describe('ComicTagger Submodules Unit Tests (TDD Harness)', () => {
  let sandbox;
  let state;

  beforeEach(() => {
    state = {
      API_BASE_URL: 'http://localhost:3000'
    };

    sandbox = {
      window: {},
      document: {
        getElementById: jest.fn(() => null),
        querySelector: jest.fn(() => null),
        createElement: (tag) => ({
          tagName: tag.toUpperCase(),
          className: '',
          classList: {
            add: jest.fn(),
            remove: jest.fn(),
            contains: jest.fn(() => false)
          },
          dataset: {},
          appendChild: jest.fn(),
          style: {}
        })
      },
      state,
      console: { log: jest.fn(), error: jest.fn(), warn: jest.fn() },
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (id) => clearTimeout(id)
    };
    sandbox.globalThis = sandbox;
    sandbox.window = sandbox;
    vm.createContext(sandbox);
  });

  describe('logging.js: Message & Key Formatting', () => {
    test('isRateDefenseMessage correctly identifies rate defense & cooldown messages', () => {
      loadModuleInVm('public/js/comictagger/logging.js', sandbox);
      const isRateDefense = sandbox.isRateDefenseMessage;
      expect(isRateDefense('Rate defense active: waiting 15s')).toBe(true);
      expect(isRateDefense('Encountered cooldown for ComicVine')).toBe(true);
      expect(isRateDefense('Processing issue #1')).toBe(false);
      expect(isRateDefense(null)).toBe(false);
    });

    test('ctLogEntryKey formats ID-stamped vs standard entries', () => {
      loadModuleInVm('public/js/comictagger/logging.js', sandbox);
      const ctLogEntryKey = sandbox.ctLogEntryKey;
      expect(ctLogEntryKey({ id: 'review-123', timestamp: '2026-10-31T12:00:00Z', message: 'Review' }))
        .toBe('id:review-123:2026-10-31T12:00:00Z');
      expect(ctLogEntryKey({ timestamp: '2026-10-31T12:00:00Z', message: 'Standard line' }))
        .toBe('2026-10-31T12:00:00Z_Standard line');
    });

    test('formatLogTime extracts HH:MM:SS from ISO timestamps', () => {
      loadModuleInVm('public/js/comictagger/logging.js', sandbox);
      const formatLogTime = sandbox.formatLogTime;
      expect(formatLogTime('2026-10-31T14:35:20.123Z')).toBe('14:35:20');
      expect(formatLogTime('10:15:30')).toBe('10:15:30');
      expect(formatLogTime('')).toBe('');
    });
  });

  describe('matches.js: Match Card HTML Generation', () => {
    test('getCtMatchHtml renders match choice, score badge, title, and metadata', () => {
      loadModuleInVm('public/js/comictagger/matches.js', sandbox);
      const getCtMatchHtml = sandbox.getCtMatchHtml;
      const html = getCtMatchHtml({
        choice: '1',
        title: 'Batman: The Long Halloween',
        score: 95,
        source: 'ComicVine',
        publisher: 'DC Comics',
        year: 1996,
        issue: '1',
        fullMetadata: { writer: 'Jeph Loeb', penciller: 'Tim Sale' }
      });

      expect(html).toContain('data-choice="1"');
      expect(html).toContain('Batman: The Long Halloween');
      expect(html).toContain('95% Match');
      expect(html).toContain('ComicVine');
      expect(html).toContain('DC Comics');
      expect(html).toContain('1996');
      expect(html).toContain('Jeph Loeb, Tim Sale');
    });
  });
});
