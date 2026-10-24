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
        const result = await checkComicAccess({ userId: 1, userRole: 'admin', comicPath: '', publisher: '', series: '', rootFolders: [], comicId: null, preFetchedAccessList: null, dbAllFunc: mockDbAll });
        expect(result).toBe(true);
        expect(mockDbAll).not.toHaveBeenCalled();
    });

    test('user with root_folder child_access gets access', async () => {
        const accessList = [{ accessType: 'root_folder', accessValue: METADATA_ROOT, direct_access: 0, child_access: 1 }];
        const result = await checkComicAccess({
            userId: 2, userRole: 'user', comicPath: `${METADATA_ROOT}/Marvel/Spider-Man/issue1.cbz`, publisher: 'Marvel', series: 'Spider-Man', rootFolders: ROOT_FOLDERS, comicId: null, preFetchedAccessList: accessList, dbAllFunc: mockDbAll
        });
        expect(result).toBe(true);
    });

    test('user with publisher child_access plus root direct_access gets access', async () => {
        const accessList = [
            { accessType: 'root_folder', accessValue: METADATA_ROOT, direct_access: 1, child_access: 0 },
            { accessType: 'publisher', accessValue: 'Marvel', direct_access: 0, child_access: 1 }
        ];
        const result = await checkComicAccess({
            userId: 3, userRole: 'user', comicPath: `${METADATA_ROOT}/Marvel/Spider-Man/issue1.cbz`, publisher: 'Marvel', series: 'Spider-Man', rootFolders: ROOT_FOLDERS, comicId: null, preFetchedAccessList: accessList, dbAllFunc: mockDbAll
        });
        expect(result).toBe(true);
    });

    // --- FOLDER MODE TEST CASES ---

    test('folder mode: user with direct comic access gets access', async () => {
        const accessList = [
            { accessType: 'root_folder', accessValue: FOLDER_ROOT, direct_access: 1, child_access: 0 },
            { accessType: 'comic', accessValue: 'comic123', direct_access: 1, child_access: 0 }
        ];
        const result = await checkComicAccess({
            userId: 4, userRole: 'user', comicPath: `${FOLDER_ROOT}/Marvel/Avengers/issue1.cbz`, publisher: null, series: null, rootFolders: ROOT_FOLDERS, comicId: 'comic123', preFetchedAccessList: accessList, dbAllFunc: mockDbAll
        });
        expect(result).toBe(true);
    });

    test('folder mode: user with recursive parent folder access gets access', async () => {
        const accessList = [
            { accessType: 'root_folder', accessValue: FOLDER_ROOT, direct_access: 1, child_access: 0 },
            { accessType: 'folder', accessValue: `${FOLDER_ROOT}/Marvel`, direct_access: 0, child_access: 1 }
        ];
        const result = await checkComicAccess({
            userId: 5, userRole: 'user', comicPath: `${FOLDER_ROOT}/Marvel/Avengers/issue1.cbz`, publisher: null, series: null, rootFolders: ROOT_FOLDERS, comicId: 'comic123', preFetchedAccessList: accessList, dbAllFunc: mockDbAll
        });
        expect(result).toBe(true);
    });

    test('folder mode: user with direct parent folder access gets access', async () => {
        const accessList = [
            { accessType: 'root_folder', accessValue: FOLDER_ROOT, direct_access: 1, child_access: 0 },
            { accessType: 'folder', accessValue: `${FOLDER_ROOT}/Marvel/Avengers`, direct_access: 1, child_access: 0 }
        ];
        const result = await checkComicAccess({
            userId: 6, userRole: 'user', comicPath: `${FOLDER_ROOT}/Marvel/Avengers/issue1.cbz`, publisher: null, series: null, rootFolders: ROOT_FOLDERS, comicId: 'comic123', preFetchedAccessList: accessList, dbAllFunc: mockDbAll
        });
        expect(result).toBe(true);
    });

    test('folder mode: user without root folder access is denied', async () => {
        const accessList = [
            { accessType: 'folder', accessValue: `${FOLDER_ROOT}/Marvel/Avengers`, direct_access: 1, child_access: 0 }
        ];
        const result = await checkComicAccess({
            userId: 7, userRole: 'user', comicPath: `${FOLDER_ROOT}/Marvel/Avengers/issue1.cbz`, publisher: null, series: null, rootFolders: ROOT_FOLDERS, comicId: 'comic123', preFetchedAccessList: accessList, dbAllFunc: mockDbAll
        });
        expect(result).toBe(false);
    });

    test('folder mode: user with mismatched folder path is denied', async () => {
        const accessList = [
            { accessType: 'root_folder', accessValue: FOLDER_ROOT, direct_access: 1, child_access: 0 },
            { accessType: 'folder', accessValue: `${FOLDER_ROOT}/DC`, direct_access: 0, child_access: 1 }
        ];
        const result = await checkComicAccess({
            userId: 8, userRole: 'user', comicPath: `${FOLDER_ROOT}/Marvel/Avengers/issue1.cbz`, publisher: null, series: null, rootFolders: ROOT_FOLDERS, comicId: 'comic123', preFetchedAccessList: accessList, dbAllFunc: mockDbAll
        });
        expect(result).toBe(false);
    });
});
