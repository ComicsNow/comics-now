const fs = require('fs');
const path = require('path');
const vm = require('vm');

describe('Globals Utilities', () => {
  let sandbox;
  let rawConsoleLogSpy;

  beforeEach(() => {
    const globalsPath = path.resolve(__dirname, '..', 'public', 'js', 'globals.js');
    let code = fs.readFileSync(globalsPath, 'utf8');

    // Strip export keywords for vm execution
    code = code.replace(/export\s+(async\s+)?(function|const|let|var)\s+/g, '$1$2 ');
    code = code.replace(/export\s+\{[^}]*\};?/g, '');
    // Change const state to var state so it attaches to sandbox and can be modified
    code = code.replace(/const state =/g, 'var state =');

    rawConsoleLogSpy = jest.fn();

    sandbox = {
      window: {
        location: { pathname: '/' },
        APP_CONFIG: {}
      },
      document: {
        getElementById: jest.fn(() => null),
        createElement: jest.fn(() => ({ style: {} })),
        body: { appendChild: jest.fn() }
      },
      console: {
        log: rawConsoleLogSpy,
        warn: jest.fn(),
        error: jest.fn()
      },
      state: {},
      localStorage: {
        getItem: jest.fn(),
        setItem: jest.fn()
      },
      navigator: {
        userAgent: 'Mozilla/5.0'
      },
      TextEncoder: class TextEncoder {
        encode(str) {
          return Array.from(str).map(c => c.charCodeAt(0));
        }
      },
      btoa: (str) => Buffer.from(str, 'binary').toString('base64'),
      setTimeout: setTimeout
    };
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    new vm.Script(code).runInContext(sandbox);
  });

  describe('escapeHtml', () => {
    it('escapes HTML characters correctly', () => {
      expect(sandbox.escapeHtml('<div>&"\'</div>')).toBe('&lt;div&gt;&amp;&quot;&#39;&lt;/div&gt;');
    });

    it('returns empty string for null or undefined', () => {
      expect(sandbox.escapeHtml(null)).toBe('');
      expect(sandbox.escapeHtml(undefined)).toBe('');
    });
  });

  describe('safeDirName', () => {
    it('safely formats string paths', () => {
      expect(sandbox.safeDirName('a/b\\c')).toBe('a_b_c');
      expect(sandbox.safeDirName('  hello  world  ')).toBe('hello world');
    });
  });

  describe('getRelativePath', () => {
    it('handles paths with baseUrl', () => {
      sandbox.state.APP_CONFIG = { baseUrl: '/app' };
      sandbox.window.location.pathname = '/app/comics';
      expect(sandbox.getRelativePath()).toBe('/comics');
    });

    it('returns / when at root', () => {
      sandbox.state.APP_CONFIG = { baseUrl: '' };
      sandbox.window.location.pathname = '';
      expect(sandbox.getRelativePath()).toBe('/');
    });
  });

  describe('Debug Log', () => {
    it('enables and disables debug logging', () => {
      sandbox.enableComicsNowDebug('TEST');
      expect(sandbox.isComicsNowDebugEnabled('TEST')).toBe(true);
      expect(sandbox.isComicsNowDebugEnabled('OTHER')).toBe(false);

      sandbox.debugLog('TEST', 'hello');
      expect(rawConsoleLogSpy).toHaveBeenCalledWith('[TEST]', 'hello');

      rawConsoleLogSpy.mockClear();
      sandbox.debugLog('OTHER', 'world');
      expect(rawConsoleLogSpy).not.toHaveBeenCalled();

      sandbox.disableComicsNowDebug();
      expect(sandbox.isComicsNowDebugEnabled('TEST')).toBe(false);
    });
  });

  describe('Message Generators', () => {
    it('creates loading message', () => {
      const msg = sandbox.createLoadingMessage('Loading...', 2);
      expect(msg).toContain('skeleton-card');
      // Should contain 2 skeleton cards
      expect(msg.match(/skeleton-card/g).length).toBe(2);
    });

    it('creates empty message', () => {
      const msg = sandbox.createEmptyMessage('No comics found');
      expect(msg).toContain('No comics found');
      expect(msg).toContain('empty-state');
    });

    it('creates error message', () => {
      const msg = sandbox.createErrorMessage('Error <div>');
      expect(msg).toContain('Error &lt;div&gt;');
      expect(msg).toContain('bg-gray-800 rounded-lg');
    });
  });

  describe('encodePath', () => {
    it('encodes paths to base64 correctly', () => {
      const input = 'hello world';
      // Base64 of 'hello world' is 'aGVsbG8gd29ybGQ='
      expect(sandbox.encodePath(input)).toBe('aGVsbG8gd29ybGQ=');
    });
  });

  describe('toTrimmedString', () => {
    it('trims string and handles null/undefined', () => {
      expect(sandbox.toTrimmedString('   test   ')).toBe('test');
      expect(sandbox.toTrimmedString(null)).toBe('');
      expect(sandbox.toTrimmedString(undefined)).toBe('');
      expect(sandbox.toTrimmedString(123)).toBe('123');
    });
  });

  describe('sanitizeComicTitle', () => {
    it('removes file extensions, tags, and cleans string', () => {
      expect(sandbox.sanitizeComicTitle('Batman 001 [Scanner].cbz')).toBe('Batman 001');
      expect(sandbox.sanitizeComicTitle('Batman_001.cbz')).toBe('Batman 001');
      expect(sandbox.sanitizeComicTitle('01 - Superman.cbr')).toBe('Superman');
    });
  });

  describe('pickMetadataValue', () => {
    it('pulls prioritized values', () => {
      const metadata = { Title: 'Main Title', Secondary: 'Alt Title' };
      expect(sandbox.pickMetadataValue(metadata, ['Unknown', 'Title'])).toBe('Main Title');
      expect(sandbox.pickMetadataValue(metadata, ['Unknown'])).toBe('');
      expect(sandbox.pickMetadataValue(metadata, [])).toBe('');
    });
  });
});
