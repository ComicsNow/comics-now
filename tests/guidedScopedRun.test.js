// Scoped guided-detection runs: incremental by default (skip already-detected),
// force to re-run everything including completed.

jest.mock('../server/db', () => ({
  dbAll: jest.fn().mockResolvedValue([]),
  dbGet: jest.fn().mockResolvedValue(null),
  dbRun: jest.fn().mockResolvedValue({}),
  getReadingPrefMaps: jest.fn().mockResolvedValue({}),
  resolveReadingModes: jest.fn(() => ({ mangaMode: false, continuousMode: false }))
}));
jest.mock('../server/logger', () => ({ log: jest.fn(), guidedLog: jest.fn() }));
jest.mock('../server/config', () => ({ getComicsDirectories: jest.fn(() => ['/comics']) }));
jest.mock('../server/services/panel-detector', () => ({ processComic: jest.fn().mockResolvedValue({ pagesProcessed: 0, pageCount: 0, panels: 0 }) }));

const { dbAll } = require('../server/db');
const guided = require('../server/services/guided-reader');

describe('guided-reader: scoped run status selection', () => {
  beforeEach(() => { dbAll.mockClear(); });

  test('getScopeStatuses(false) is incremental — pending + failed only (skips completed)', () => {
    expect(guided.getScopeStatuses(false)).toEqual(['pending', 'failed']);
  });

  test('getScopeStatuses(true) forces re-run — includes completed', () => {
    expect(guided.getScopeStatuses(true)).toEqual(['pending', 'failed', 'completed']);
  });

  test('buildQueue defaults to incremental statuses (no "completed" in the query)', async () => {
    await guided.buildQueue({ type: 'publisher', target: 'DC' });
    const params = dbAll.mock.calls[0][1];
    expect(params).toContain('pending');
    expect(params).toContain('failed');
    expect(params).not.toContain('completed');
  });

  test('buildQueue includes "completed" when statuses request it (force)', async () => {
    await guided.buildQueue({ type: 'publisher', target: 'DC', statuses: ['pending', 'failed', 'completed'] });
    const params = dbAll.mock.calls[0][1];
    expect(params).toContain('completed');
  });

  test('startRunForScope without force queries incrementally (no completed)', async () => {
    await guided.startRunForScope('series', 'Batman');
    const params = dbAll.mock.calls[0][1];
    expect(params).not.toContain('completed');
  });

  test('startRunForScope with force re-runs completed too', async () => {
    await guided.startRunForScope('series', 'Batman', { force: true });
    const params = dbAll.mock.calls[0][1];
    expect(params).toContain('completed');
  });
});
