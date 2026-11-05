const fs = require('fs');
const os = require('os');
const path = require('path');

// constants.js reads DATA_DIR at require time; isolate all sidecar writes.
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'panel-detector-data-'));

jest.mock('../../../server/logger', () => ({
  guidedLog: jest.fn(),
  guidedLogUpdate: jest.fn(),
  log: jest.fn()
}));

jest.mock('../../../server/services/panel-detector/inference', () => ({
  detectPanels: jest.fn(),
  detectBubbles: jest.fn()
}));

jest.mock('../../../server/services/archive-utils', () => ({
  openArchiveSession: jest.fn()
}));

const archiveUtils = require('../../../server/services/archive-utils');
const { detectPanels, detectBubbles } = require('../../../server/services/panel-detector/inference');
const {
  processComic,
  withTimeout,
  GUIDED_VIEW_DIR
} = require('../../../server/services/panel-detector/processor');

function mockSession(pages, readBuffer) {
  const close = jest.fn();
  archiveUtils.openArchiveSession.mockResolvedValue({ pages, readBuffer, close });
  return { close };
}

describe('panel-detector processor sidecar handling', () => {
  beforeAll(() => {
    fs.mkdirSync(GUIDED_VIEW_DIR, { recursive: true });
  });

  afterAll(() => {
    fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
  });

  beforeEach(() => {
    jest.clearAllMocks();
    detectPanels.mockResolvedValue([[10, 20, 100, 120]]);
    detectBubbles.mockResolvedValue([]);
  });

  test('writes a valid sidecar atomically when panels are detected', async () => {
    const { close } = mockSession(['01.jpg'], async () => Buffer.from('page'));

    const result = await processComic('synthetic-valid', '/lib/synthetic.cbz', 'western');

    const expectedPath = path.join(GUIDED_VIEW_DIR, 'synthetic-valid.json');
    expect(result.panels).toBe(1);
    expect(result.outputPath).toBe(expectedPath);
    expect(fs.existsSync(expectedPath)).toBe(true);
    expect(fs.existsSync(expectedPath + '.tmp')).toBe(false);
    expect(close).toHaveBeenCalled();
  });

  test('does not write a sidecar when zero panels are detected', async () => {
    const { close } = mockSession(['01.jpg'], async () => Buffer.from('page'));
    detectPanels.mockResolvedValue([]);
    detectBubbles.mockResolvedValue([]);

    const existingPath = path.join(GUIDED_VIEW_DIR, 'synthetic-zero.json');
    const existing = JSON.stringify({ pages: { '01.jpg': { panels: [], bubbles: [], sequence: [] } } });
    fs.writeFileSync(existingPath, existing);

    const result = await processComic('synthetic-zero', '/lib/synthetic.cbr', 'western');

    expect(result.panels).toBe(0);
    expect(result.outputPath).toBeNull();
    expect(fs.readFileSync(existingPath, 'utf8')).toBe(existing);
    expect(close).toHaveBeenCalled();
  });

  test('rejects cancellation and writes no sidecar', async () => {
    const { close } = mockSession(['01.jpg', '02.jpg'], async () => Buffer.from('page'));

    await expect(processComic('synthetic-cancel', '/lib/synthetic.cbz', 'western', {
      isCancelled: () => true
    })).rejects.toThrow('Cancelled');

    expect(fs.existsSync(path.join(GUIDED_VIEW_DIR, 'synthetic-cancel.json'))).toBe(false);
    expect(close).toHaveBeenCalled();
  });

  test('closes the archive session when a page read fails', async () => {
    const { close } = mockSession(['01.jpg'], async () => {
      throw new Error('extract failed');
    });
    detectPanels.mockResolvedValue([]);
    detectBubbles.mockResolvedValue([]);

    const result = await processComic('synthetic-read-fail', '/lib/synthetic.cbr', 'western');

    expect(result.panels).toBe(0);
    expect(result.outputPath).toBeNull();
    expect(close).toHaveBeenCalled();
  });

  test('tags extraction timeouts so the processor can abort the comic', async () => {
    await expect(
      withTimeout(new Promise(() => {}), 10, 'Page extraction timed out')
    ).rejects.toMatchObject({
      message: 'Page extraction timed out',
      code: 'EXTRACTION_TIMEOUT'
    });
  });
});
