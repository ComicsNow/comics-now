const path = require('path');
const guidedReader = require('../server/services/guided-reader');
const modalDetector = require('../server/services/modal-detector');
const panelDetector = require('../server/services/panel-detector');
const { dbRun } = require('../server/db');

describe('Guided Reader Parallel Processing and Dynamic Concurrency', () => {
  let ensureSpy;

  beforeEach(async () => {
    await dbRun("DELETE FROM settings WHERE key LIKE 'guided.%'");
    jest.clearAllMocks();
    ensureSpy = jest.spyOn(modalDetector, 'ensureEnvironmentReady').mockResolvedValue({
      ok: true,
      ready: true
    });
  });

  afterEach(async () => {
    await guidedReader.cancelAll();
    await dbRun("DELETE FROM settings WHERE key LIKE 'guided.%'");
    if (ensureSpy) ensureSpy.mockRestore();
  });

  test('default concurrency is 2 when useModal is true, but 1 when useModal is false', async () => {
    await dbRun("INSERT INTO settings (key, value) VALUES ('guided.useModal', 'false')");
    let settings = await guidedReader.getSettings();
    expect(guidedReader.getEffectiveConcurrency(settings)).toBe(1);

    await dbRun("INSERT OR REPLACE INTO settings (key, value) VALUES ('guided.useModal', 'true')");
    settings = await guidedReader.getSettings();
    expect(guidedReader.getEffectiveConcurrency(settings)).toBe(2);
  });

  test('runs 2 comics in parallel when concurrency is 2 with Modal', async () => {
    await dbRun("INSERT INTO settings (key, value) VALUES ('guided.useModal', 'true')");
    await dbRun("INSERT INTO settings (key, value) VALUES ('guided.concurrency', '2')");

    let activeCount = 0;
    let maxParallel = 0;

    const mockModalProcess = jest.fn().mockImplementation(async (id) => {
      activeCount++;
      if (activeCount > maxParallel) maxParallel = activeCount;
      // Small delay to simulate in-flight concurrency
      await new Promise(r => setTimeout(r, 60));
      activeCount--;
      return {
        panels: 10,
        pagesProcessed: 5,
        pageCount: 5,
        outputPath: path.resolve(__dirname, `../metadata/guided_view/${id}.json`)
      };
    });

    const spyModal = jest.spyOn(modalDetector, 'processComic').mockImplementation(mockModalProcess);

    const testQueue = [
      { id: 'comic-p1', name: 'Comic 1.cbz', path: path.join(__dirname, 'fixtures/comic1.cbz'), type: 'western' },
      { id: 'comic-p2', name: 'Comic 2.cbz', path: path.join(__dirname, 'fixtures/comic2.cbz'), type: 'western' },
      { id: 'comic-p3', name: 'Comic 3.cbz', path: path.join(__dirname, 'fixtures/comic3.cbz'), type: 'western' }
    ];

    guidedReader.setQueueForTest(testQueue);
    await guidedReader.runWorker();

    expect(maxParallel).toBe(2);
    expect(spyModal).toHaveBeenCalledTimes(3);

    spyModal.mockRestore();
  });

  test('clamps concurrency to 1 when useModal is false even if concurrency setting is 2', async () => {
    await dbRun("INSERT INTO settings (key, value) VALUES ('guided.useModal', 'false')");
    await dbRun("INSERT INTO settings (key, value) VALUES ('guided.concurrency', '2')");

    let activeCount = 0;
    let maxParallel = 0;

    const mockCpuProcess = jest.fn().mockImplementation(async (id) => {
      activeCount++;
      if (activeCount > maxParallel) maxParallel = activeCount;
      await new Promise(r => setTimeout(r, 40));
      activeCount--;
      return {
        panels: 10,
        pagesProcessed: 5,
        pageCount: 5,
        outputPath: path.resolve(__dirname, `../metadata/guided_view/${id}.json`)
      };
    });

    const spyCpu = jest.spyOn(panelDetector, 'processComic').mockImplementation(mockCpuProcess);

    const testQueue = [
      { id: 'comic-cpu-1', name: 'Comic 1.cbz', path: path.join(__dirname, 'fixtures/comic1.cbz'), type: 'western' },
      { id: 'comic-cpu-2', name: 'Comic 2.cbz', path: path.join(__dirname, 'fixtures/comic2.cbz'), type: 'western' }
    ];

    guidedReader.setQueueForTest(testQueue);
    await guidedReader.runWorker();

    expect(maxParallel).toBe(1);
    expect(spyCpu).toHaveBeenCalledTimes(2);

    spyCpu.mockRestore();
  });

  test('getStatus returns active array of currently processing comics', async () => {
    await dbRun("INSERT INTO settings (key, value) VALUES ('guided.useModal', 'true')");
    await dbRun("INSERT INTO settings (key, value) VALUES ('guided.concurrency', '2')");

    let resolveComic1;
    const p1 = new Promise(r => { resolveComic1 = r; });

    const spyModal = jest.spyOn(modalDetector, 'processComic').mockImplementation(async (id) => {
      if (id === 'comic-wait-1') {
        await p1;
      }
      return {
        panels: 10,
        pagesProcessed: 5,
        pageCount: 5,
        outputPath: path.resolve(__dirname, `../metadata/guided_view/${id}.json`)
      };
    });

    const testQueue = [
      { id: 'comic-wait-1', name: 'Comic Wait 1.cbz', path: path.join(__dirname, 'fixtures/comic1.cbz'), type: 'western' },
      { id: 'comic-quick-2', name: 'Comic Quick 2.cbz', path: path.join(__dirname, 'fixtures/comic2.cbz'), type: 'western' }
    ];

    guidedReader.setQueueForTest(testQueue);
    const workerPromise = guidedReader.runWorker();

    // Give worker time to spin up both slots
    await new Promise(r => setTimeout(r, 30));

    const status = await guidedReader.getStatus();
    expect(Array.isArray(status.active)).toBe(true);
    expect(status.active.length).toBeGreaterThanOrEqual(1);
    expect(status.active.some(c => c.id === 'comic-wait-1')).toBe(true);

    resolveComic1();
    await workerPromise;

    spyModal.mockRestore();
  });
});
