const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { spawn } = require('child_process');

jest.mock('fs');
jest.mock('child_process');
jest.mock('../server/logger', () => ({
  log: jest.fn()
}));
jest.mock('../server/utils', () => ({
  t0: jest.fn(() => Date.now()),
  ms: jest.fn(() => 100)
}));

const { convertCbrToCbz, convertPdfToCbz } = require('../server/services/library-conversion');

describe('library-conversion', () => {
  let mockProcess;

  beforeEach(() => {
    jest.clearAllMocks();

    mockProcess = new EventEmitter();
    mockProcess.stdout = new EventEmitter();
    mockProcess.stderr = new EventEmitter();

    spawn.mockReturnValue(mockProcess);
  });

  describe('convertCbrToCbz', () => {
    it('should successfully convert a CBR to CBZ', async () => {
      const cbrPath = '/path/to/comic.cbr';
      const expectedCbzPath = '/path/to/comic.cbz';
      fs.existsSync.mockReturnValue(true);

      const promise = convertCbrToCbz(cbrPath);

      // Simulate successful close
      mockProcess.emit('close', 0);

      const result = await promise;
      expect(result).toBe(expectedCbzPath);
      expect(spawn).toHaveBeenCalledWith(
        expect.stringContaining('convert_cbr_to_cbz.sh'),
        [cbrPath],
        expect.any(Object)
      );
    });

    it('should return null if the conversion script fails with non-zero exit code', async () => {
      const cbrPath = '/path/to/comic.cbr';
      fs.existsSync.mockReturnValue(true);

      const promise = convertCbrToCbz(cbrPath);

      mockProcess.emit('close', 1);

      const result = await promise;
      expect(result).toBeNull();
    });

    it('should return null if script succeeds but CBZ is not created', async () => {
      const cbrPath = '/path/to/comic.cbr';
      fs.existsSync.mockReturnValue(false); // file not created

      const promise = convertCbrToCbz(cbrPath);

      mockProcess.emit('close', 0);

      const result = await promise;
      expect(result).toBeNull();
    });

    it('should return null if spawn emits ENOENT error (command not found)', async () => {
      const cbrPath = '/path/to/comic.cbr';

      const promise = convertCbrToCbz(cbrPath);

      const error = new Error('spawn ENOENT');
      error.code = 'ENOENT';
      mockProcess.emit('error', error);

      const result = await promise;
      expect(result).toBeNull();
    });

    it('should return null for other spawn errors', async () => {
      const cbrPath = '/path/to/comic.cbr';

      const promise = convertCbrToCbz(cbrPath);

      const error = new Error('Some other error');
      mockProcess.emit('error', error);

      const result = await promise;
      expect(result).toBeNull();
    });

    it('should handle stdout and stderr data correctly', async () => {
      const cbrPath = '/path/to/comic.cbr';
      fs.existsSync.mockReturnValue(true);

      const promise = convertCbrToCbz(cbrPath);

      mockProcess.stdout.emit('data', Buffer.from('some stdout'));
      mockProcess.stderr.emit('data', Buffer.from('some stderr'));
      mockProcess.emit('close', 0);

      const result = await promise;
      expect(result).toBe('/path/to/comic.cbz');
    });
  });

  describe('convertPdfToCbz', () => {
    it('should successfully convert a PDF to CBZ', async () => {
      const pdfPath = '/path/to/document.pdf';
      const expectedCbzPath = '/path/to/document.cbz';
      fs.existsSync.mockReturnValue(true);

      const promise = convertPdfToCbz(pdfPath);

      mockProcess.emit('close', 0);

      const result = await promise;
      expect(result).toBe(expectedCbzPath);
      expect(spawn).toHaveBeenCalledWith(
        expect.stringContaining('pdf2cbz.sh'),
        [pdfPath],
        expect.any(Object)
      );
    });

    it('should return null if the conversion script fails with non-zero exit code', async () => {
      const pdfPath = '/path/to/document.pdf';
      fs.existsSync.mockReturnValue(true);

      const promise = convertPdfToCbz(pdfPath);

      mockProcess.emit('close', 1);

      const result = await promise;
      expect(result).toBeNull();
    });

    it('should return null if script succeeds but CBZ is not created', async () => {
      const pdfPath = '/path/to/document.pdf';
      fs.existsSync.mockReturnValue(false); // file not created

      const promise = convertPdfToCbz(pdfPath);

      mockProcess.emit('close', 0);

      const result = await promise;
      expect(result).toBeNull();
    });

    it('should return null if spawn emits ENOENT error (command not found)', async () => {
      const pdfPath = '/path/to/document.pdf';

      const promise = convertPdfToCbz(pdfPath);

      const error = new Error('spawn ENOENT');
      error.code = 'ENOENT';
      mockProcess.emit('error', error);

      const result = await promise;
      expect(result).toBeNull();
    });

    it('should return null for other spawn errors', async () => {
      const pdfPath = '/path/to/document.pdf';

      const promise = convertPdfToCbz(pdfPath);

      const error = new Error('Some other error');
      mockProcess.emit('error', error);

      const result = await promise;
      expect(result).toBeNull();
    });
  });
});
