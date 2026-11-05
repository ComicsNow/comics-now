const fs = require('fs');
const os = require('os');
const path = require('path');

jest.mock('../../../server/logger', () => ({ log: jest.fn() }));

const { reconcileGuidedView } = require('../../../server/services/scan/guided-reconcile');

describe('reconcileGuidedView', () => {
  let dir;
  const opts = () => ({ guidedViewDir: dir });

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'guided-reconcile-'));
  });

  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function writeSidecar(id, pages) {
    const filePath = path.join(dir, `${id}.json`);
    fs.writeFileSync(filePath, JSON.stringify({ comicId: id, pages }));
    return filePath;
  }

  const emptyPages = { '01.jpg': { panels: [], bubbles: [], sequence: [] } };
  const validPages = { '01.jpg': { panels: [[1, 2, 3, 4]], bubbles: [], sequence: [] } };

  test('keeps completed when the sidecar exists', async () => {
    const sidecar = writeSidecar('c1', validPages);
    const res = await reconcileGuidedView('c1', '/lib/c1.cbz', {
      guidedViewStatus: 'completed',
      guidedViewPath: sidecar
    }, new Map(), opts());
    expect(res.guidedViewStatus).toBe('completed');
    expect(res.guidedViewPath).toBe(sidecar);
  });

  test('resets completed to pending when the sidecar is missing', async () => {
    const res = await reconcileGuidedView('c2', '/lib/c2.cbz', {
      guidedViewStatus: 'completed',
      guidedViewPath: path.join(dir, 'c2.json')
    }, new Map(), opts());
    expect(res.guidedViewStatus).toBe('pending');
    expect(res.guidedViewPath).toBeNull();
  });

  test('leaves processing untouched', async () => {
    writeSidecar('c3', validPages);
    const res = await reconcileGuidedView('c3', '/lib/c3.cbz', {
      guidedViewStatus: 'processing',
      guidedViewPath: null,
      guidedViewError: null
    }, new Map(), opts());
    expect(res.guidedViewStatus).toBe('processing');
    expect(res.guidedViewPath).toBeNull();
  });

  test('keeps failed status when the existing sidecar has zero panels', async () => {
    writeSidecar('c4', emptyPages);
    const res = await reconcileGuidedView('c4', '/lib/c4.cbr', {
      guidedViewStatus: 'failed',
      guidedViewPath: null,
      guidedViewError: 'Detection completed with 0 panels'
    }, new Map(), opts());
    expect(res.guidedViewStatus).toBe('failed');
    expect(res.guidedViewPath).toBeNull();
    expect(res.guidedViewError).toBe('Detection completed with 0 panels');
  });

  test('keeps failed status when the existing sidecar is corrupt', async () => {
    fs.writeFileSync(path.join(dir, 'c5.json'), '{broken');
    const res = await reconcileGuidedView('c5', '/lib/c5.cbr', {
      guidedViewStatus: 'failed',
      guidedViewPath: null,
      guidedViewError: 'boom'
    }, new Map(), opts());
    expect(res.guidedViewStatus).toBe('failed');
    expect(res.guidedViewError).toBe('boom');
  });

  test('promotes failed to completed when a usable sidecar exists', async () => {
    const sidecar = writeSidecar('c6', validPages);
    const res = await reconcileGuidedView('c6', '/lib/c6.cbz', {
      guidedViewStatus: 'failed',
      guidedViewPath: null,
      guidedViewError: 'old error'
    }, new Map(), opts());
    expect(res.guidedViewStatus).toBe('completed');
    expect(res.guidedViewPath).toBe(sidecar);
    expect(res.guidedViewError).toBeNull();
  });

  test('keeps skipped status when the sidecar is unusable', async () => {
    writeSidecar('c7', emptyPages);
    const res = await reconcileGuidedView('c7', '/lib/c7.cbz', {
      guidedViewStatus: 'skipped',
      guidedViewPath: null,
      guidedViewError: null
    }, new Map(), opts());
    expect(res.guidedViewStatus).toBe('skipped');
  });

  test('migrates a usable sidecar from a moved comic', async () => {
    const oldPath = path.join(os.tmpdir(), 'old-location', 'moved.cbz');
    const newPath = path.join(os.tmpdir(), 'new-location', 'moved.cbz');
    writeSidecar('old-id', validPages);
    const dbComicsMap = new Map([[oldPath, { id: 'old-id' }]]);

    const res = await reconcileGuidedView('new-id', newPath, {
      guidedViewStatus: 'pending',
      guidedViewPath: null
    }, dbComicsMap, opts());

    expect(res.guidedViewStatus).toBe('completed');
    expect(res.guidedViewPath).toBe(path.join(dir, 'new-id.json'));
    const migrated = JSON.parse(fs.readFileSync(res.guidedViewPath, 'utf8'));
    expect(migrated.comicId).toBe('new-id');
    expect(fs.existsSync(path.join(dir, 'old-id.json'))).toBe(false);
  });

  test('does not migrate an unusable sidecar from a moved comic', async () => {
    const oldPath = path.join(os.tmpdir(), 'old-location-2', 'moved-empty.cbz');
    const newPath = path.join(os.tmpdir(), 'new-location-2', 'moved-empty.cbz');
    writeSidecar('old-empty-id', emptyPages);
    const dbComicsMap = new Map([[oldPath, { id: 'old-empty-id' }]]);

    const res = await reconcileGuidedView('new-empty-id', newPath, {
      guidedViewStatus: 'pending',
      guidedViewPath: null
    }, dbComicsMap, opts());

    expect(res.guidedViewStatus).toBe('pending');
    expect(res.guidedViewPath).toBeNull();
    expect(fs.existsSync(path.join(dir, 'old-empty-id.json'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'new-empty-id.json'))).toBe(false);
  });
});
