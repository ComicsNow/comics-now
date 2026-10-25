const { checkComicAccess } = require('../server/access-control');

jest.mock('../server/config', () => ({
    getLibraries: jest.fn(() => [
        { path: '/comics/library', hierarchyMode: 'metadata' },
        { path: '/comics/folder-library', hierarchyMode: 'folder' }
    ]),
    getConfig: jest.fn(() => ({
        comicsLocation: ''
    }))
}));

const METADATA_ROOT = '/comics/library';
const FOLDER_ROOT = '/comics/folder-library';
const ROOT_FOLDERS = [METADATA_ROOT, FOLDER_ROOT];

describe('Access Control Logic (Pure)', () => {
    const mockDbAll = jest.fn();

    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('admin gets access immediately', async () => {
        const result = await checkComicAccess(1, 'admin', '', '', '', [], null, null, mockDbAll);
        expect(result).toBe(true);
        expect(mockDbAll).not.toHaveBeenCalled();
    });

    test('user with root_folder child_access gets access', async () => {
        const accessList = [{ accessType: 'root_folder', accessValue: METADATA_ROOT, direct_access: 0, child_access: 1 }];
        const result = await checkComicAccess(
            2, 'user', `${METADATA_ROOT}/Marvel/Spider-Man/issue1.cbz`, 'Marvel', 'Spider-Man', ROOT_FOLDERS, null, accessList, mockDbAll
        );
        expect(result).toBe(true);
    });

    test('user with publisher child_access plus root direct_access gets access', async () => {
        const accessList = [
            { accessType: 'root_folder', accessValue: METADATA_ROOT, direct_access: 1, child_access: 0 },
            { accessType: 'publisher', accessValue: 'Marvel', direct_access: 0, child_access: 1 }
        ];
        const result = await checkComicAccess(
            3, 'user', `${METADATA_ROOT}/Marvel/Spider-Man/issue1.cbz`, 'Marvel', 'Spider-Man', ROOT_FOLDERS, null, accessList, mockDbAll
        );
        expect(result).toBe(true);
    });

    // --- FOLDER MODE TEST CASES ---

    test('folder mode: user with direct comic access gets access', async () => {
        const accessList = [
            { accessType: 'root_folder', accessValue: FOLDER_ROOT, direct_access: 1, child_access: 0 },
            { accessType: 'comic', accessValue: 'comic123', direct_access: 1, child_access: 0 }
        ];
        const result = await checkComicAccess(
            4, 'user', `${FOLDER_ROOT}/Marvel/Avengers/issue1.cbz`, null, null, ROOT_FOLDERS, 'comic123', accessList, mockDbAll
        );
        expect(result).toBe(true);
    });

    test('folder mode: user with recursive parent folder access gets access', async () => {
        const accessList = [
            { accessType: 'root_folder', accessValue: FOLDER_ROOT, direct_access: 1, child_access: 0 },
            { accessType: 'folder', accessValue: `${FOLDER_ROOT}/Marvel`, direct_access: 0, child_access: 1 }
        ];
        const result = await checkComicAccess(
            5, 'user', `${FOLDER_ROOT}/Marvel/Avengers/issue1.cbz`, null, null, ROOT_FOLDERS, 'comic123', accessList, mockDbAll
        );
        expect(result).toBe(true);
    });

    test('folder mode: user with direct parent folder access gets access', async () => {
        const accessList = [
            { accessType: 'root_folder', accessValue: FOLDER_ROOT, direct_access: 1, child_access: 0 },
            { accessType: 'folder', accessValue: `${FOLDER_ROOT}/Marvel/Avengers`, direct_access: 1, child_access: 0 }
        ];
        const result = await checkComicAccess(
            6, 'user', `${FOLDER_ROOT}/Marvel/Avengers/issue1.cbz`, null, null, ROOT_FOLDERS, 'comic123', accessList, mockDbAll
        );
        expect(result).toBe(true);
    });

    test('folder mode: user without root folder access is denied', async () => {
        const accessList = [
            { accessType: 'folder', accessValue: `${FOLDER_ROOT}/Marvel/Avengers`, direct_access: 1, child_access: 0 }
        ];
        const result = await checkComicAccess(
            7, 'user', `${FOLDER_ROOT}/Marvel/Avengers/issue1.cbz`, null, null, ROOT_FOLDERS, 'comic123', accessList, mockDbAll
        );
        expect(result).toBe(false);
    });

    test('folder mode: user with mismatched folder path is denied', async () => {
        const accessList = [
            { accessType: 'root_folder', accessValue: FOLDER_ROOT, direct_access: 1, child_access: 0 },
            { accessType: 'folder', accessValue: `${FOLDER_ROOT}/DC`, direct_access: 0, child_access: 1 }
        ];
        const result = await checkComicAccess(
            8, 'user', `${FOLDER_ROOT}/Marvel/Avengers/issue1.cbz`, null, null, ROOT_FOLDERS, 'comic123', accessList, mockDbAll
        );
        expect(result).toBe(false);
    });
});
