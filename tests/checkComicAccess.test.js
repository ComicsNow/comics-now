const { checkComicAccess } = require('../server/db');

const ROOT = '/comics/library';
const ROOT_FOLDERS = [ROOT];

describe('checkComicAccess', () => {
  test('admin gets access regardless of paths or access list', async () => {
    const result = await checkComicAccess(
      1,
      'admin',
      `${ROOT}/Marvel/Spider-Man/issue1.cbz`,
      'Marvel',
      'Spider-Man',
      ROOT_FOLDERS,
      null,
      [] // empty access list, should still be true for admin
    );
    expect(result).toBe(true);
  });

  test('non-admin user with root_folder direct_access alone is denied (needs publisher + series too)', async () => {
    const accessList = [
      { accessType: 'root_folder', accessValue: ROOT, direct_access: 1, child_access: 0 },
    ];
    const result = await checkComicAccess(
      2,
      'user',
      `${ROOT}/Marvel/Spider-Man/issue1.cbz`,
      'Marvel',
      'Spider-Man',
      ROOT_FOLDERS,
      null,
      accessList
    );
    expect(result).toBe(false);
  });

  test('user with root_folder child_access gets access to everything under it', async () => {
    const accessList = [
      { accessType: 'root_folder', accessValue: ROOT, direct_access: 0, child_access: 1 },
    ];
    const result = await checkComicAccess(
      3,
      'user',
      `${ROOT}/Marvel/Spider-Man/issue1.cbz`,
      'Marvel',
      'Spider-Man',
      ROOT_FOLDERS,
      null,
      accessList
    );
    expect(result).toBe(true);
  });

  test('user with publisher child_access plus root direct_access gets access', async () => {
    const accessList = [
      { accessType: 'root_folder', accessValue: ROOT, direct_access: 1, child_access: 0 },
      { accessType: 'publisher', accessValue: 'Marvel', direct_access: 0, child_access: 1 },
    ];
    const result = await checkComicAccess(
      4,
      'user',
      `${ROOT}/Marvel/Spider-Man/issue1.cbz`,
      'Marvel',
      'Spider-Man',
      ROOT_FOLDERS,
      null,
      accessList
    );
    expect(result).toBe(true);
  });

  test('user with no relevant entries is denied', async () => {
    const accessList = [
      { accessType: 'publisher', accessValue: 'DC', direct_access: 1, child_access: 0 },
    ];
    const result = await checkComicAccess(
      5,
      'user',
      `${ROOT}/Marvel/Spider-Man/issue1.cbz`,
      'Marvel',
      'Spider-Man',
      ROOT_FOLDERS,
      null,
      accessList
    );
    expect(result).toBe(false);
  });

  test('user with full direct_access chain (root + publisher + series) gets access', async () => {
    const accessList = [
      { accessType: 'root_folder', accessValue: ROOT, direct_access: 1, child_access: 0 },
      { accessType: 'publisher', accessValue: 'Marvel', direct_access: 1, child_access: 0 },
      { accessType: 'series', accessValue: 'Spider-Man', direct_access: 1, child_access: 0 },
    ];
    const result = await checkComicAccess(
      6,
      'user',
      `${ROOT}/Marvel/Spider-Man/issue1.cbz`,
      'Marvel',
      'Spider-Man',
      ROOT_FOLDERS,
      null,
      accessList
    );
    expect(result).toBe(true);
  });

  // Close the sqlite connection opened by requiring db.js so jest can exit cleanly.
  afterAll(async () => {
    try {
      const db = require('../server/db');
      if (db && typeof db.closeDb === 'function') {
        await db.closeDb();
      }
    } catch (_e) {
      // best-effort
    }
  });
});
