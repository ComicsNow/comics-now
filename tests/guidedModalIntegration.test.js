const panelDetector = require('../server/services/panel-detector');
const modalDetector = require('../server/services/modal-detector');
const guidedReader = require('../server/services/guided-reader');
const { dbRun, dbGet } = require('../server/db');

describe('Guided Reader Modal GPU Integration and Fallback', () => {
  const testComic = {
    id: 'test-modal-comic-123',
    name: 'Action Comics #1.cbz',
    path: '/media/test/Action Comics #1.cbz',
    type: 'western'
  };

  let ensureSpy;

  beforeEach(async () => {
    // Reset guided settings in test DB
    await dbRun("DELETE FROM settings WHERE key LIKE 'guided.%'");
    jest.clearAllMocks();
    ensureSpy = jest.spyOn(modalDetector, 'ensureEnvironmentReady').mockResolvedValue({
      ok: true,
      ready: true
    });
  });

  afterEach(async () => {
    await dbRun("DELETE FROM settings WHERE key LIKE 'guided.%'");
    if (ensureSpy) ensureSpy.mockRestore();
  });

  test('default settings have useModal set to false', async () => {
    const settings = await guidedReader.getSettings();
    expect(settings.useModal).toBe(false);
    expect(settings.modalTokenId).toBe('');
    expect(settings.hasModalSecret).toBe(false);
  });

  test('when useModal is false, calls CPU panelDetector directly', async () => {
    const spyCpu = jest.spyOn(panelDetector, 'processComic').mockResolvedValueOnce({
      panels: 12,
      pagesProcessed: 5,
      pageCount: 5,
      outputPath: '/opt/comics-now/metadata/guided_view/test-modal-comic-123.json'
    });
    const spyModal = jest.spyOn(modalDetector, 'processComic').mockResolvedValueOnce({
      panels: 12,
      pagesProcessed: 5,
      pageCount: 5,
      outputPath: '/opt/comics-now/metadata/guided_view/test-modal-comic-123.json'
    });

    const result = await guidedReader.processComic(testComic);

    expect(spyCpu).toHaveBeenCalledTimes(1);
    expect(spyModal).not.toHaveBeenCalled();
    expect(result.panels).toBe(12);

    spyCpu.mockRestore();
    spyModal.mockRestore();
  });

  test('when useModal is true and Modal succeeds, returns Modal result without calling CPU', async () => {
    await dbRun("INSERT INTO settings (key, value) VALUES ('guided.useModal', 'true')");

    const spyCpu = jest.spyOn(panelDetector, 'processComic').mockResolvedValueOnce({
      panels: 10,
      pagesProcessed: 5,
      pageCount: 5,
      outputPath: '/opt/comics-now/metadata/guided_view/test-modal-comic-123.json'
    });
    const spyModal = jest.spyOn(modalDetector, 'processComic').mockResolvedValueOnce({
      panels: 18,
      pagesProcessed: 5,
      pageCount: 5,
      outputPath: '/opt/comics-now/metadata/guided_view/test-modal-comic-123.json'
    });

    const result = await guidedReader.processComic(testComic);

    expect(spyModal).toHaveBeenCalledTimes(1);
    expect(spyCpu).not.toHaveBeenCalled();
    expect(result.panels).toBe(18);

    spyCpu.mockRestore();
    spyModal.mockRestore();
  });

  test('when useModal is true and Modal fails, gracefully falls back to CPU processing', async () => {
    await dbRun("INSERT INTO settings (key, value) VALUES ('guided.useModal', 'true')");

    const spyModal = jest.spyOn(modalDetector, 'processComic').mockRejectedValueOnce(
      new Error('Workspace ac-8MR23th3xSmkHVxqYlEDCw has exceeded its spend limit')
    );
    const spyCpu = jest.spyOn(panelDetector, 'processComic').mockResolvedValueOnce({
      panels: 15,
      pagesProcessed: 5,
      pageCount: 5,
      outputPath: '/opt/comics-now/metadata/guided_view/test-modal-comic-123.json'
    });

    const result = await guidedReader.processComic(testComic);

    expect(spyModal).toHaveBeenCalledTimes(1);
    expect(spyCpu).toHaveBeenCalledTimes(1);
    expect(result.panels).toBe(15);

    spyCpu.mockRestore();
    spyModal.mockRestore();
  });

  test('when useModal is true, ensures environment is ready before processing comic', async () => {
    await dbRun("INSERT INTO settings (key, value) VALUES ('guided.useModal', 'true')");

    const spyEnsure = jest.spyOn(modalDetector, 'ensureEnvironmentReady').mockResolvedValueOnce({
      ok: true,
      ready: true
    });
    const spyModal = jest.spyOn(modalDetector, 'processComic').mockResolvedValueOnce({
      panels: 20,
      pagesProcessed: 5,
      pageCount: 5,
      outputPath: '/opt/comics-now/metadata/guided_view/test-modal-comic-123.json'
    });

    const result = await guidedReader.processComic(testComic);

    expect(spyEnsure).toHaveBeenCalledTimes(1);
    expect(spyModal).toHaveBeenCalledTimes(1);
    expect(result.panels).toBe(20);

    spyEnsure.mockRestore();
    spyModal.mockRestore();
  });
});
