const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { log } = require('../../../server/logger');
const { convertCbrToCbz, convertPdfToCbz } = require('../../../server/services/library-conversion');
const EventEmitter = require('events');

jest.mock('child_process');
jest.mock('../../../server/logger', () => ({
  log: jest.fn()
}));
jest.mock('../../../server/utils', () => ({
  t0: jest.fn(() => 1000),
  ms: jest.fn(() => 500)
}));

function makeMockProc(onSpawn) {
  const proc = new EventEmitter();
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.kill = jest.fn();
  if (onSpawn) {
    process.nextTick(() => onSpawn(proc));
  }
  return proc;
}

describe('library-conversion', () => {
  let originalDateNow;

  beforeEach(() => {
    jest.clearAllMocks();
    originalDateNow = Date.now;

    jest.spyOn(fs, 'existsSync').mockReturnValue(true);
    jest.spyOn(fs.promises, 'mkdtemp').mockResolvedValue('/tmp/comics-now-conv-123');
    jest.spyOn(fs.promises, 'readdir').mockResolvedValue([]);
    jest.spyOn(fs.promises, 'unlink').mockResolvedValue(undefined);
    jest.spyOn(fs.promises, 'rm').mockResolvedValue(undefined);
  });

  afterEach(() => {
    Date.now = originalDateNow;
    jest.restoreAllMocks();
  });

  describe('convertCbrToCbz', () => {
    it('extracts with unrar, strips symlinks, packs with zip (archive before --), and cleans temp dir', async () => {
      spawn
        .mockImplementationOnce(() => makeMockProc((p) => p.emit('close', 0)))
        .mockImplementationOnce(() => makeMockProc((p) => p.emit('close', 0)));

      fs.promises.readdir.mockResolvedValueOnce([
        { name: 'page01.jpg', isSymbolicLink: () => false, isDirectory: () => false },
        { name: 'evil-link', isSymbolicLink: () => true, isDirectory: () => false }
      ]);

      const result = await convertCbrToCbz('/fake/path/comic.cbr');
      expect(result).toBe('/fake/path/comic.cbz');

      expect(spawn).toHaveBeenNthCalledWith(
        1,
        'unrar',
        ['x', '-o+', '-y', '-ol-', '--', '/fake/path/comic.cbr', `/tmp/comics-now-conv-123${path.sep}`],
        expect.objectContaining({ cwd: '/fake/path' })
      );
      expect(fs.promises.unlink).toHaveBeenCalledWith('/tmp/comics-now-conv-123/evil-link');
      expect(spawn).toHaveBeenNthCalledWith(
        2,
        'zip',
        ['-0', '-r', '-q', '-y', '/fake/path/comic.cbz', '--', '.'],
        expect.objectContaining({ cwd: '/tmp/comics-now-conv-123' })
      );
      expect(fs.promises.rm).toHaveBeenCalledWith('/tmp/comics-now-conv-123', { recursive: true, force: true });
      expect(log).toHaveBeenCalledWith('INFO', 'CONVERT', '✅ Created: comic.cbz in 500 ms');
    });

    it('deletes original cbr when deleteOriginals is true', async () => {
      spawn
        .mockImplementationOnce(() => makeMockProc((p) => p.emit('close', 0)))
        .mockImplementationOnce(() => makeMockProc((p) => p.emit('close', 0)));

      const result = await convertCbrToCbz('/fake/path/comic.cbr', { deleteOriginals: true });
      expect(result).toBe('/fake/path/comic.cbz');
      expect(fs.promises.unlink).toHaveBeenCalledWith('/fake/path/comic.cbr');
    });

    it('returns null and cleans temp dir if unrar binary is missing (ENOENT)', async () => {
      spawn.mockImplementationOnce(() => makeMockProc((p) => {
        const error = new Error('spawn unrar ENOENT');
        error.code = 'ENOENT';
        p.emit('error', error);
      }));

      const result = await convertCbrToCbz('/fake/path/comic.cbr');
      expect(result).toBeNull();
      expect(fs.promises.rm).toHaveBeenCalledWith('/tmp/comics-now-conv-123', { recursive: true, force: true });
      expect(log).toHaveBeenCalledWith('ERROR', 'CONVERT', expect.stringContaining('unrar'));
    });

    it('returns null if zip fails', async () => {
      spawn
        .mockImplementationOnce(() => makeMockProc((p) => p.emit('close', 0)))
        .mockImplementationOnce(() => makeMockProc((p) => {
          p.stderr.emit('data', 'zip error: Invalid command arguments');
          p.emit('close', 16);
        }));

      const result = await convertCbrToCbz('/fake/path/comic.cbr');
      expect(result).toBeNull();
      expect(fs.promises.rm).toHaveBeenCalledWith('/tmp/comics-now-conv-123', { recursive: true, force: true });
      expect(log).toHaveBeenCalledWith('ERROR', 'CONVERT', '❌ Failed comic.cbr: zip error: Invalid command arguments after 500 ms');
    });

    it('returns null if cbz file is not created despite exit code 0', async () => {
      fs.existsSync.mockReturnValue(false);
      spawn
        .mockImplementationOnce(() => makeMockProc((p) => p.emit('close', 0)))
        .mockImplementationOnce(() => makeMockProc((p) => p.emit('close', 0)));

      const result = await convertCbrToCbz('/fake/path/comic.cbr');
      expect(result).toBeNull();
      expect(log).toHaveBeenCalledWith('ERROR', 'CONVERT', '❌ Failed comic.cbr: CBZ file not created after 500 ms');
    });

    it('logs progress periodically during conversion', async () => {
      let currentTime = 10000;
      Date.now = jest.fn(() => currentTime);

      spawn
        .mockImplementationOnce(() => makeMockProc((p) => {
          p.stdout.emit('data', 'chunk 1');
          currentTime = 16000;
          p.stdout.emit('data', 'chunk 2');
          p.emit('close', 0);
        }))
        .mockImplementationOnce(() => makeMockProc((p) => p.emit('close', 0)));

      await convertCbrToCbz('/fake/path/comic.cbr');
      expect(log).toHaveBeenCalledWith('INFO', 'CONVERT', 'Progress: comic.cbr');
    });
  });

  describe('convertPdfToCbz', () => {
    it('renders pages with pdftoppm, packs with zip (archive before --), and cleans temp dir', async () => {
      spawn
        .mockImplementationOnce(() => makeMockProc((p) => p.emit('close', 0)))
        .mockImplementationOnce(() => makeMockProc((p) => p.emit('close', 0)));

      fs.promises.readdir.mockResolvedValueOnce([
        { name: 'page-02.jpg', isFile: () => true },
        { name: 'page-01.jpg', isFile: () => true }
      ]);

      const result = await convertPdfToCbz('/fake/path/document.pdf');
      expect(result).toBe('/fake/path/document.cbz');

      expect(spawn).toHaveBeenNthCalledWith(
        1,
        'pdftoppm',
        ['-r', '300', '-jpeg', '-jpegopt', 'quality=100', '--', '/fake/path/document.pdf', '/tmp/comics-now-conv-123/page'],
        expect.objectContaining({ cwd: '/fake/path' })
      );
      expect(spawn).toHaveBeenNthCalledWith(
        2,
        'zip',
        ['-j', '-y', '/fake/path/document.cbz', '--', 'page-01.jpg', 'page-02.jpg'],
        expect.objectContaining({ cwd: '/tmp/comics-now-conv-123' })
      );
      expect(fs.promises.rm).toHaveBeenCalledWith('/tmp/comics-now-conv-123', { recursive: true, force: true });
      expect(log).toHaveBeenCalledWith('INFO', 'CONVERT', '✅ Created: document.cbz in 500 ms');
    });

    it('returns null if pdftoppm produces no images', async () => {
      spawn.mockImplementationOnce(() => makeMockProc((p) => p.emit('close', 0)));
      fs.promises.readdir.mockResolvedValueOnce([]);

      const result = await convertPdfToCbz('/fake/path/document.pdf');
      expect(result).toBeNull();
      expect(spawn).toHaveBeenCalledTimes(1);
      expect(fs.promises.rm).toHaveBeenCalledWith('/tmp/comics-now-conv-123', { recursive: true, force: true });
      expect(log).toHaveBeenCalledWith('ERROR', 'CONVERT', '❌ Failed document.pdf: No images were created by pdftoppm after 500 ms');
    });

    it('returns null if pdftoppm fails', async () => {
      spawn.mockImplementationOnce(() => makeMockProc((p) => {
        p.stderr.emit('data', 'pdf error');
        p.emit('close', 1);
      }));

      const result = await convertPdfToCbz('/fake/path/document.pdf');
      expect(result).toBeNull();
      expect(fs.promises.rm).toHaveBeenCalledWith('/tmp/comics-now-conv-123', { recursive: true, force: true });
      expect(log).toHaveBeenCalledWith('ERROR', 'CONVERT', '❌ Failed document.pdf: pdf error after 500 ms');
    });

    it('returns null if cbz file is not created despite exit code 0', async () => {
      fs.existsSync.mockReturnValue(false);
      spawn
        .mockImplementationOnce(() => makeMockProc((p) => p.emit('close', 0)))
        .mockImplementationOnce(() => makeMockProc((p) => p.emit('close', 0)));
      fs.promises.readdir.mockResolvedValueOnce([{ name: 'page-01.jpg', isFile: () => true }]);

      const result = await convertPdfToCbz('/fake/path/document.pdf');
      expect(result).toBeNull();
      expect(log).toHaveBeenCalledWith('ERROR', 'CONVERT', '❌ Failed document.pdf: CBZ file not created after 500 ms');
    });

    it('logs progress periodically during PDF conversion', async () => {
      let currentTime = 10000;
      Date.now = jest.fn(() => currentTime);

      spawn
        .mockImplementationOnce(() => makeMockProc((p) => {
          p.stdout.emit('data', 'chunk 1');
          currentTime = 16000;
          p.stdout.emit('data', 'chunk 2');
          p.emit('close', 0);
        }))
        .mockImplementationOnce(() => makeMockProc((p) => p.emit('close', 0)));
      fs.promises.readdir.mockResolvedValueOnce([{ name: 'page-01.jpg', isFile: () => true }]);

      await convertPdfToCbz('/fake/path/document.pdf');
      expect(log).toHaveBeenCalledWith('INFO', 'CONVERT', 'Progress: document.pdf');
    });
  });

  it('keeps os.tmpdir available', () => {
    expect(typeof os.tmpdir()).toBe('string');
  });
});
