const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  selectImagePages,
  openArchiveSession,
  cleanupStaleRarTempDirs
} = require('../../../server/services/archive-utils');
const { createExtractorFromFile } = require('node-unrar-js');

jest.mock('node-unrar-js', () => ({
  createExtractorFromFile: jest.fn()
}));

function installExtractor(headers) {
  const targetDirs = [];
  createExtractorFromFile.mockImplementation(async (options) => {
    targetDirs.push(options.targetPath);
    return {
      getFileList: () => ({ fileHeaders: headers }),
      extract: ({ files }) => ({
        files: (function* () {
          for (const name of files) {
            const flat = path.basename(name.replace(/\\/g, '/'));
            fs.writeFileSync(
              path.join(options.targetPath, flat),
              Buffer.from('content:' + name)
            );
            yield { fileHeader: { name } };
          }
        })()
      })
    };
  });
  return targetDirs;
}

const file = (name) => ({ name, flags: { directory: false } });

describe('archive sessions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('selectImagePages', () => {
    test('filters non-images and hidden parts, then natural-sorts', () => {
      const pages = selectImagePages([
        '10.jpg',
        '2.jpg',
        '1.jpg',
        '.hidden.jpg',
        '__MACOSX/cover.jpg',
        'dir\\.hidden\\3.jpg',
        'sub\\4.jpg',
        'notes.txt'
      ]);
      expect(pages).toEqual(['1.jpg', '2.jpg', '10.jpg', 'sub\\4.jpg']);
    });
  });

  describe('openArchiveSession', () => {
    test('lists pages and reads entries sequentially from one extractor', async () => {
      const headers = [file('dir/page2.jpg'), file('dir/page1.jpg')];
      const targetDirs = installExtractor(headers);

      const session = await openArchiveSession('synthetic.cbr');
      expect(session.pages).toEqual(['dir/page1.jpg', 'dir/page2.jpg']);

      const first = await session.readBuffer('dir/page1.jpg');
      const again = await session.readBuffer('dir/page1.jpg');
      const second = await session.readBuffer('dir/page2.jpg');

      expect(first.toString()).toBe('content:dir/page1.jpg');
      expect(again.toString()).toBe('content:dir/page1.jpg');
      expect(second.toString()).toBe('content:dir/page2.jpg');

      const targetDir = targetDirs[0];
      expect(fs.existsSync(targetDir)).toBe(true);
      session.close();
      expect(fs.existsSync(targetDir)).toBe(false);
    });

    test('is safe for duplicate basenames in different folders', async () => {
      const headers = [file('a/page.jpg'), file('b/page.jpg')];
      installExtractor(headers);

      const session = await openArchiveSession('synthetic.cbr');
      const a = await session.readBuffer('a/page.jpg');
      const b = await session.readBuffer('b/page.jpg');

      expect(a.toString()).toBe('content:a/page.jpg');
      expect(b.toString()).toBe('content:b/page.jpg');
      session.close();
    });

    test('close is idempotent', async () => {
      installExtractor([file('page.jpg')]);
      const session = await openArchiveSession('synthetic.cbr');
      session.close();
      expect(() => session.close()).not.toThrow();
    });
  });

  describe('cleanupStaleRarTempDirs', () => {
    test('removes only old comic RAR temp dirs in the selected base dir', () => {
      const base = fs.mkdtempSync(path.join(os.tmpdir(), 'rar-cleanup-base-'));
      const oldDir = path.join(base, 'comics-now-rar-old');
      const freshDir = path.join(base, 'comics-now-rar-fresh');
      const unrelated = path.join(base, 'other-tool-dir');
      fs.mkdirSync(oldDir);
      fs.mkdirSync(freshDir);
      fs.mkdirSync(unrelated);

      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
      fs.utimesSync(oldDir, twoHoursAgo, twoHoursAgo);

      try {
        const removed = cleanupStaleRarTempDirs(60 * 60 * 1000, base);
        expect(removed).toBe(1);
        expect(fs.existsSync(oldDir)).toBe(false);
        expect(fs.existsSync(freshDir)).toBe(true);
        expect(fs.existsSync(unrelated)).toBe(true);
      } finally {
        fs.rmSync(base, { recursive: true, force: true });
      }
    });
  });
});
