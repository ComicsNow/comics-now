const { checkComicAccess } = require('../server/access-control');

const ROOT = '/comics/library';
const ROOT_FOLDERS = [ROOT];

describe('Access Control Logic (Pure)', () => {
    // Mock dbAllFunc that doesn't actually hit a database
    const mockDbAll = jest.fn();

    test('admin gets access immediately', async () => {
        const result = await checkComicAccess(1, 'admin', '', '', '', [], null, null, mockDbAll);
        expect(result).toBe(true);
        expect(mockDbAll).not.toHaveBeenCalled();
    });

    test('user with root_folder child_access gets access', async () => {
        const accessList = [{ accessType: 'root_folder', accessValue: ROOT, direct_access: 0, child_access: 1 }];
        const result = await checkComicAccess(
            2, 'user', `${ROOT}/Marvel/Spider-Man/issue1.cbz`, 'Marvel', 'Spider-Man', ROOT_FOLDERS, null, accessList, mockDbAll
        );
        expect(result).toBe(true);
    });

    test('user with publisher child_access plus root direct_access gets access', async () => {
        const accessList = [
            { accessType: 'root_folder', accessValue: ROOT, direct_access: 1, child_access: 0 },
            { accessType: 'publisher', accessValue: 'Marvel', direct_access: 0, child_access: 1 }
        ];
        const result = await checkComicAccess(
            3, 'user', `${ROOT}/Marvel/Spider-Man/issue1.cbz`, 'Marvel', 'Spider-Man', ROOT_FOLDERS, null, accessList, mockDbAll
        );
        expect(result).toBe(true);
    });
});
