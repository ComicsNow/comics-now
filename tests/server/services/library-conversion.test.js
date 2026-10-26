const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { log } = require('../../../server/logger');
const { t0, ms } = require('../../../server/utils');
const { convertCbrToCbz, convertPdfToCbz } = require('../../../server/services/library-conversion');
const EventEmitter = require('events');

jest.mock('fs');
jest.mock('child_process');
jest.mock('../../../server/logger', () => ({
  log: jest.fn()
}));
jest.mock('../../../server/utils', () => ({
  t0: jest.fn(() => 1000),
  ms: jest.fn(() => 500)
}));

describe('library-conversion', () => {
  let mockProcess;
  let originalDateNow;

  beforeEach(() => {
    jest.clearAllMocks();

    mockProcess = new EventEmitter();
    mockProcess.stdout = new EventEmitter();
    mockProcess.stderr = new EventEmitter();
    spawn.mockReturnValue(mockProcess);

    fs.existsSync.mockReturnValue(true);

    originalDateNow = Date.now;
  });

  afterEach(() => {
    Date.now = originalDateNow;
  });

  describe('convertCbrToCbz', () => {
    it('should return cbz path on successful conversion', async () => {
      const promise = convertCbrToCbz('/fake/path/comic.cbr');
      mockProcess.emit('close', 0);

      const result = await promise;
      expect(result).toBe('/fake/path/comic.cbz');
      expect(spawn).toHaveBeenCalledWith(
        expect.stringContaining('convert_cbr_to_cbz.sh'),
        ['/fake/path/comic.cbr'],
        expect.objectContaining({ cwd: '/fake/path' })
      );
      expect(log).toHaveBeenCalledWith('INFO', 'CONVERT', '✅ Created: comic.cbz in 500 ms');
    });

    it('should return null if script not found', async () => {
      const promise = convertCbrToCbz('/fake/path/comic.cbr');

      const error = new Error('ENOENT');
      error.code = 'ENOENT';
      mockProcess.emit('error', error);

      const result = await promise;
      expect(result).toBeNull();
      expect(log).toHaveBeenCalledWith('ERROR', 'CONVERT', expect.stringContaining('Conversion script not found'));
    });

    it('should return null if conversion script fails', async () => {
      const promise = convertCbrToCbz('/fake/path/comic.cbr');

      mockProcess.stderr.emit('data', 'Some error message');
      mockProcess.emit('close', 1);

      const result = await promise;
      expect(result).toBeNull();
      expect(log).toHaveBeenCalledWith('ERROR', 'CONVERT', '❌ Failed comic.cbr: Some error message after 500 ms');
    });

    it('should return null if cbz file is not created despite exit code 0', async () => {
      fs.existsSync.mockReturnValue(false);

      const promise = convertCbrToCbz('/fake/path/comic.cbr');
      mockProcess.emit('close', 0);

      const result = await promise;
      expect(result).toBeNull();
      expect(log).toHaveBeenCalledWith('ERROR', 'CONVERT', '❌ Failed comic.cbr: CBZ file not created after 500 ms');
    });

    it('should log progress periodically', async () => {
      let currentTime = 10000;
      Date.now = jest.fn(() => currentTime);

      const promise = convertCbrToCbz('/fake/path/comic.cbr');

      // first chunk, no progress logged yet because it's the exact same time
      mockProcess.stdout.emit('data', 'chunk 1');

      // advance time by more than 5000ms
      currentTime = 16000;
      mockProcess.stdout.emit('data', 'chunk 2');

      mockProcess.emit('close', 0);
      await promise;

      expect(log).toHaveBeenCalledWith('INFO', 'CONVERT', 'Progress: comic.cbr');
    });
  });

  describe('convertPdfToCbz', () => {
    it('should return cbz path on successful conversion', async () => {
      const promise = convertPdfToCbz('/fake/path/document.pdf');
      mockProcess.emit('close', 0);

      const result = await promise;
      expect(result).toBe('/fake/path/document.cbz');
      expect(spawn).toHaveBeenCalledWith(
        expect.stringContaining('pdf2cbz.sh'),
        ['/fake/path/document.pdf'],
        expect.objectContaining({ cwd: '/fake/path' })
      );
      expect(log).toHaveBeenCalledWith('INFO', 'CONVERT', '✅ Created: document.cbz in 500 ms');
    });

    it('should return null if script not found', async () => {
      const promise = convertPdfToCbz('/fake/path/document.pdf');

      const error = new Error('ENOENT');
      error.code = 'ENOENT';
      mockProcess.emit('error', error);

      const result = await promise;
      expect(result).toBeNull();
      expect(log).toHaveBeenCalledWith('ERROR', 'CONVERT', expect.stringContaining('Conversion script not found'));
    });

    it('should return null if conversion script fails', async () => {
      const promise = convertPdfToCbz('/fake/path/document.pdf');

      mockProcess.stderr.emit('data', 'pdf error');
      mockProcess.emit('close', 1);

      const result = await promise;
      expect(result).toBeNull();
      expect(log).toHaveBeenCalledWith('ERROR', 'CONVERT', '❌ Failed document.pdf: pdf error after 500 ms');
    });

    it('should return null if cbz file is not created despite exit code 0', async () => {
      fs.existsSync.mockReturnValue(false);

      const promise = convertPdfToCbz('/fake/path/document.pdf');
      mockProcess.emit('close', 0);

      const result = await promise;
      expect(result).toBeNull();
      expect(log).toHaveBeenCalledWith('ERROR', 'CONVERT', '❌ Failed document.pdf: CBZ file not created after 500 ms');
    });

    it('should log progress periodically', async () => {
      let currentTime = 10000;
      Date.now = jest.fn(() => currentTime);

      const promise = convertPdfToCbz('/fake/path/document.pdf');

      mockProcess.stdout.emit('data', 'chunk 1');

      // advance time by more than 5000ms
      currentTime = 16000;
      mockProcess.stdout.emit('data', 'chunk 2');

      mockProcess.emit('close', 0);
      await promise;

      expect(log).toHaveBeenCalledWith('INFO', 'CONVERT', 'Progress: document.pdf');
    });
  });
});
