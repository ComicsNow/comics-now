// Guided detection cancellation — two distinct controls:
//   cancelCurrent(): skip only the in-flight comic, keep processing the rest
//   cancelAll():     drop the whole queue and stop

jest.mock('../server/db', () => ({
  dbAll: jest.fn(),
  dbGet: jest.fn().mockResolvedValue(null),
  dbRun: jest.fn().mockResolvedValue({}),
  getReadingPrefMaps: jest.fn().mockResolvedValue({}),
  resolveReadingModes: jest.fn(() => ({ mangaMode: false, continuousMode: false }))
}));
jest.mock('../server/logger', () => ({ log: jest.fn(), guidedLog: jest.fn() }));
jest.mock('../server/config', () => ({ getComicsDirectories: jest.fn(() => ['/comics']) }));
jest.mock('../server/services/panel-detector', () => ({ processComic: jest.fn() }));

const { dbAll } = require('../server/db');
const panelDetector = require('../server/services/panel-detector');
const guided = require('../server/services/guided-reader');

const tick = () => new Promise((r) => setTimeout(r, 0));
const flush = async () => { await tick(); await tick(); };

// Each processComic call returns a promise we resolve/reject on demand, so we can
// deterministically step the async worker through the queue.
const deferreds = [];
beforeAll(() => {
  panelDetector.processComic.mockImplementation(() => {
    let reject, resolve;
    const p = new Promise((res, rej) => { resolve = res; reject = rej; });
    deferreds.push({ resolve, reject });
    return p;
  });
});

function seedComics(n) {
  const rows = [];
  for (let i = 0; i < n; i++) {
    rows.push({ id: `c${i}`, publisher: 'P', series: 'S', name: `c${i}.cbz`, path: `/comics/c${i}.cbz`, guidedViewStatus: 'pending' });
  }
  dbAll.mockResolvedValue(rows);
}

test('cancelCurrent skips only the in-flight comic; the rest of the queue continues', async () => {
  seedComics(3);
  await guided.startRun();
  await flush(); // worker begins processing c0

  let st = await guided.getStatus();
  expect(st.isRunning).toBe(true);
  expect(st.current.id).toBe('c0');
  expect(panelDetector.processComic).toHaveBeenCalledTimes(1);

  // Skip the current comic.
  expect(guided.cancelCurrent()).toBe(true);
  // The detector aborts the in-flight comic (throws 'Cancelled').
  deferreds[0].reject(new Error('Cancelled'));
  await flush();

  // Worker advanced to the next comic rather than stopping.
  st = await guided.getStatus();
  expect(panelDetector.processComic).toHaveBeenCalledTimes(2);
  expect(st.current.id).toBe('c1');
  expect(st.isRunning).toBe(true);

  // Clean up: cancel the rest.
  guided.cancelAll();
  deferreds[1].reject(new Error('Cancelled'));
  await flush();
});

test('cancelAll drops the entire queue in one call and stops', async () => {
  deferreds.length = 0;
  seedComics(4);
  await guided.startRun();
  await flush(); // worker processing first item, 4 queued

  let st = await guided.getStatus();
  expect(st.isRunning).toBe(true);
  expect(st.queueLength).toBeGreaterThan(1);

  expect(guided.cancelAll()).toBe(true);

  st = await guided.getStatus();
  expect(st.queueLength).toBe(0); // whole batch cancelled at once

  // Let the in-flight comic unwind.
  if (deferreds[0]) deferreds[0].reject(new Error('Cancelled'));
  await flush();
  st = await guided.getStatus();
  expect(st.isRunning).toBe(false);
});
