const fs = require('fs');
const path = require('path');
const vm = require('vm');

describe('globals.js', () => {
  let sandbox;
  let globals;

  beforeAll(() => {
    const globalsPath = path.resolve(__dirname, '..', 'public', 'js', 'globals.js');
    let code = fs.readFileSync(globalsPath, 'utf8');
    // Strip export keywords for vm execution
    code = code.replace(/export\s+(async\s+)?(function|const|let|var)\s+/g, '$1$2 ');
    code = code.replace(/export\s+\{[^}]*\};?/g, '');

    sandbox = {
      window: {},
      document: {
        getElementById: () => null,
        querySelector: () => null,
        documentElement: {},
        body: {},
        createElement: () => ({ className: '', innerHTML: '' })
      },
      console: {
        log: () => {},
        warn: () => {},
        error: () => {}
      },
      state: {},
      localStorage: {
        getItem: () => null,
        setItem: () => {}
      },
      navigator: {
        userAgent: ''
      },
      fetch: async () => ({ ok: true, json: async () => ({}) }),
      TextEncoder: class {
        encode(str) {
          const arr = new Uint8Array(str.length);
          for (let i = 0; i < str.length; i++) arr[i] = str.charCodeAt(i);
          return arr;
        }
      },
      btoa: (str) => Buffer.from(str, 'binary').toString('base64'),
      setTimeout: setTimeout
    };
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    new vm.Script(code).runInContext(sandbox);

    globals = sandbox;
  });

  describe('escapeHtml', () => {
    it('returns empty string for null or undefined', () => {
      expect(globals.escapeHtml(null)).toBe('');
      expect(globals.escapeHtml(undefined)).toBe('');
    });

    it('escapes HTML special characters', () => {
      expect(globals.escapeHtml('<div class="test">Foo & Bar\'s</div>'))
        .toBe('&lt;div class=&quot;test&quot;&gt;Foo &amp; Bar&#39;s&lt;/div&gt;');
    });

    it('converts non-string values to string before escaping', () => {
      expect(globals.escapeHtml(123)).toBe('123');
      expect(globals.escapeHtml(true)).toBe('true');
    });
  });

  describe('safeDirName', () => {
    it('replaces backslashes and forward slashes with underscores', () => {
      expect(globals.safeDirName('foo/bar\\baz')).toBe('foo_bar_baz');
    });

    it('replaces multiple consecutive whitespace with a single space', () => {
      expect(globals.safeDirName('a   b\tc')).toBe('a b c');
    });

    it('trims whitespace', () => {
      expect(globals.safeDirName('  foo bar  ')).toBe('foo bar');
    });
  });

  describe('encodePath', () => {
    it('encodes a string to base64', () => {
      expect(globals.encodePath('foo/bar')).toBe(Buffer.from('foo/bar').toString('base64'));
    });
  });

  describe('toTrimmedString', () => {
    it('returns empty string for null or undefined', () => {
      expect(globals.toTrimmedString(null)).toBe('');
      expect(globals.toTrimmedString(undefined)).toBe('');
    });

    it('returns trimmed string representation', () => {
      expect(globals.toTrimmedString('  foo  ')).toBe('foo');
      expect(globals.toTrimmedString(123)).toBe('123');
    });
  });

  describe('pickMetadataValue', () => {
    it('returns the first matching value from metadata based on keys', () => {
      const metadata = { Title: 'Batman', IssueNumber: '2' };
      expect(globals.pickMetadataValue(metadata, ['StoryTitle', 'Title'])).toBe('Batman');
      expect(globals.pickMetadataValue(metadata, ['IssueNumber', 'Number'])).toBe('2');
    });

    it('returns empty string if no keys match', () => {
      const metadata = { Title: 'Batman' };
      expect(globals.pickMetadataValue(metadata, ['Series', 'Publisher'])).toBe('');
    });

    it('returns empty string if metadata is empty or keys are empty', () => {
      expect(globals.pickMetadataValue({}, ['Title'])).toBe('');
      expect(globals.pickMetadataValue({ Title: 'Batman' }, [])).toBe('');
    });
  });

  describe('sanitizeComicTitle', () => {
    it('strips common extensions', () => {
      expect(globals.sanitizeComicTitle('Batman 01.cbz')).toBe('Batman 01');
      expect(globals.sanitizeComicTitle('Superman.pdf')).toBe('Superman');
    });

    it('strips bracketed tags', () => {
      expect(globals.sanitizeComicTitle('Batman 01 [Digital-HD]')).toBe('Batman 01');
      expect(globals.sanitizeComicTitle('[Scanner] Batman 01')).toBe('Batman 01');
    });

    it('strips leading sorting indices', () => {
      expect(globals.sanitizeComicTitle('01 - Batman 01')).toBe('Batman 01');
      expect(globals.sanitizeComicTitle('001 Batman 01')).toBe('Batman 01');
    });

    it('replaces underscores and collapses spaces', () => {
      expect(globals.sanitizeComicTitle('Batman_01   (2022)')).toBe('Batman 01 (2022)');
    });

    it('returns original trimmed string if empty after cleaning', () => {
      // Just brackets that get removed
      expect(globals.sanitizeComicTitle('[brackets]')).toBe('[brackets]');
    });
  });
});
