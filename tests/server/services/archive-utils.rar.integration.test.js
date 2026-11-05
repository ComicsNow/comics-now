const fs = require('fs');
const os = require('os');
const path = require('path');
const { openArchive, listPages } = require('../../../server/services/archive-utils');

const FIXTURE = path.join(__dirname, '..', '..', 'fixtures', 'rar', 'node-unrar-js-FolderTest.rar');

function rarTempDirs() {
  return fs.readdirSync(os.tmpdir())
    .filter((name) => name.startsWith('comics-now-rar-'));
}

describe('archive-utils RAR integration', () => {
  beforeAll(() => {
    expect(fs.existsSync(FIXTURE)).toBe(true);
  });

  test('reads the same entry twice from one opened RAR without leaving temp dirs', async () => {
    const before = new Set(rarTempDirs());
    const archive = await openArchive(FIXTURE);
    const entries = archive.listEntries();
    expect(entries).toContain('Folder1/Folder Space/long.txt');
    expect(entries).toContain('Folder1/Folder 中文/2中文.txt');

    try {
      const first = await archive.readBuffer('Folder1/Folder Space/long.txt');
      const second = await archive.readBuffer('Folder1/Folder Space/long.txt');
      expect(first.length).toBeGreaterThan(0);
      expect(second.length).toBe(first.length);
      expect(first.equals(second)).toBe(true);
    } finally {
      archive.close();
    }

    const leftovers = rarTempDirs().filter((name) => !before.has(name));
    expect(leftovers).toEqual([]);
  });

  test('listPages returns no images for the text-only fixture', async () => {
    await expect(listPages(FIXTURE)).resolves.toEqual([]);
  });
});
