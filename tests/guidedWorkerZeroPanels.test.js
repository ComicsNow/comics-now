jest.mock('../server/db', () => ({
  dbRun: jest.fn().mockResolvedValue({})
}));
jest.mock('../server/logger', () => ({
  log: jest.fn(),
  guidedLog: jest.fn()
}));
jest.mock('../server/services/guided/settings', () => ({
  getSettings: jest.fn(),
  intervalToMs: jest.fn()
}));
jest.mock('../server/services/guided/processor', () => ({
  getEffectiveConcurrency: jest.fn(),
  processComic: jest.fn()
}));
jest.mock('../server/services/guided/queue', () => ({
  buildQueue: jest.fn(),
  getScopeStatuses: jest.fn()
}));

const { dbRun } = require('../server/db');
const { getSettings } = require('../server/services/guided/settings');
const { getEffectiveConcurrency, processComic } = require('../server/services/guided/processor');
const { state } = require('../server/services/guided/state');
const worker = require('../server/services/guided/worker');

function resetState() {
  state.isRunning = false;
  state.isCancelled = false;
  state.queue = [];
  state.activeComics.clear();
  state.activeWorkers = [];
  state.current = null;
  state.spawnWorkers = null;
}

describe('guided worker zero-panel guard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetState();
    getSettings.mockResolvedValue({ autoOnAdd: false, useModal: false, concurrency: 1 });
    getEffectiveConcurrency.mockReturnValue(1);
    dbRun.mockResolvedValue({});
  });

  test('marks failed for a zero-panel result even when page counts are zero', async () => {
    worker.setQueueForTest([{ id: 'synthetic-id', name: 'synthetic.cbr', path: '/lib/synthetic.cbr' }]);
    processComic.mockResolvedValue({
      panels: 0,
      pagesProcessed: 0,
      pageCount: 0,
      outputPath: null
    });

    await worker.runWorker();

    const failed = dbRun.mock.calls.find(([sql]) => sql.includes("guidedViewStatus = 'failed'"));
    expect(failed).toBeDefined();
    expect(failed[1]).toEqual(['Detection completed with 0 panels', 'synthetic-id']);
  });

  test('marks completed when panels are detected', async () => {
    worker.setQueueForTest([{ id: 'synthetic-id', name: 'synthetic.cbz', path: '/lib/synthetic.cbz' }]);
    processComic.mockResolvedValue({
      panels: 3,
      pagesProcessed: 2,
      pageCount: 2,
      outputPath: '/tmp/synthetic-id.json'
    });

    await worker.runWorker();

    const completed = dbRun.mock.calls.find(([sql]) => sql.includes("guidedViewStatus = 'completed'"));
    expect(completed).toBeDefined();
    expect(completed[1]).toEqual(['/tmp/synthetic-id.json', 'synthetic-id']);
  });
});
