const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  countSidecarPanels,
  isUsableGuidedSidecarData,
  readGuidedSidecar,
  hasUsableGuidedSidecar
} = require('../../../server/services/guided/sidecar');

describe('guided sidecar validation', () => {
  let dir;

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'guided-sidecar-'));
  });

  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function writeSidecar(name, data) {
    const filePath = path.join(dir, name);
    fs.writeFileSync(filePath, typeof data === 'string' ? data : JSON.stringify(data));
    return filePath;
  }

  test('counts panels and tolerates malformed page entries', () => {
    expect(countSidecarPanels({ pages: { '1.jpg': { panels: [[1, 2, 3, 4]] } } })).toBe(1);
    expect(countSidecarPanels({
      pages: {
        '1.jpg': { panels: [[1, 2, 3, 4], [5, 6, 7, 8]] },
        '2.jpg': { panels: null },
        '3.jpg': {}
      }
    })).toBe(2);
    expect(countSidecarPanels(null)).toBe(0);
    expect(countSidecarPanels({ pages: [] })).toBe(0);
  });

  test('rejects missing, corrupt, and non-object data', async () => {
    expect(isUsableGuidedSidecarData(null)).toBe(false);
    expect(isUsableGuidedSidecarData([])).toBe(false);
    expect(isUsableGuidedSidecarData({})).toBe(false);
    expect(isUsableGuidedSidecarData({ pages: {} })).toBe(false);
    expect(isUsableGuidedSidecarData({ pages: [] })).toBe(false);
    expect(await readGuidedSidecar(path.join(dir, 'missing.json'))).toBeNull();
    expect(await readGuidedSidecar(writeSidecar('corrupt.json', '{not json'))).toBeNull();
  });

  test('rejects a sidecar whose pages all have zero panels', async () => {
    const filePath = writeSidecar('empty.json', {
      comicId: 'synthetic-id',
      pages: { '01.jpg': { panels: [], bubbles: [], sequence: [] } }
    });
    expect(isUsableGuidedSidecarData(await readGuidedSidecar(filePath))).toBe(false);
    expect(await hasUsableGuidedSidecar(filePath)).toBe(false);
  });

  test('accepts a sidecar with at least one panel', async () => {
    const filePath = writeSidecar('valid.json', {
      comicId: 'synthetic-id',
      pages: {
        '01.jpg': { panels: [[10, 20, 100, 100]], bubbles: [], sequence: [] },
        '02.jpg': { panels: [], bubbles: [[1, 2, 3, 4]], sequence: [] }
      }
    });
    expect(isUsableGuidedSidecarData(await readGuidedSidecar(filePath))).toBe(true);
    expect(await hasUsableGuidedSidecar(filePath)).toBe(true);
  });

  test('treats bubble-only pages as unusable (matches the detection worker rule)', async () => {
    const filePath = writeSidecar('bubbles-only.json', {
      pages: { '01.jpg': { panels: [], bubbles: [[1, 2, 3, 4]], sequence: [] } }
    });
    expect(await hasUsableGuidedSidecar(filePath)).toBe(false);
  });
});
