// Auto-on-add: when the "run automatically when new comics are added" setting is
// on, a completed library scan should run guided detection ONLY on the comics that
// were newly added by that scan — never the whole pending backlog.

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

const { dbAll, dbGet } = require('../server/db');
const guided = require('../server/services/guided-reader');

// Settings are read live via dbGet('SELECT value FROM settings WHERE key = ?').
function setAutoOnAdd(on) {
  dbGet.mockImplementation((sql, params) => {
    if (sql.includes('FROM settings') && params && params[0] === guided.SETTINGS_KEYS.autoOnAdd) {
      return Promise.resolve(on ? { value: 'true' } : null);
    }
    return Promise.resolve(null);
  });
}

describe('guided-reader: auto-on-add scopes to newly-added comics', () => {
  beforeEach(() => {
    dbAll.mockClear();
    dbAll.mockResolvedValue([]);
    setAutoOnAdd(true);
  });

  test('does nothing when there are no newly-added comics', async () => {
    await guided.onLibraryScanComplete([]);
    expect(dbAll).not.toHaveBeenCalled();
  });

  test('does nothing when the setting is off, even with new comics', async () => {
    setAutoOnAdd(false);
    await guided.onLibraryScanComplete(['id-a', 'id-b']);
    expect(dbAll).not.toHaveBeenCalled();
  });

  test('queries only the newly-added comic ids (not the whole backlog)', async () => {
    await guided.onLibraryScanComplete(['id-a', 'id-b']);
    expect(dbAll).toHaveBeenCalled();
    const [sql, params] = dbAll.mock.calls[0];
    expect(sql).toContain('id IN');
    expect(params).toContain('id-a');
    expect(params).toContain('id-b');
  });

  test('is incremental — only pending/failed new comics, never completed', async () => {
    await guided.onLibraryScanComplete(['id-a']);
    const params = dbAll.mock.calls[0][1];
    expect(params).toContain('pending');
    expect(params).toContain('failed');
    expect(params).not.toContain('completed');
  });
});
