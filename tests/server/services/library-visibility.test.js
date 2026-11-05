jest.mock('../../../server/db', () => ({
    dbGet: jest.fn(),
    dbAll: jest.fn(),
    getReadingPrefMaps: jest.fn(),
    resolveReadingModes: jest.fn(),
    checkComicAccess: jest.fn()
}));

jest.mock('../../../server/config', () => ({
    getAllowedFormats: jest.fn(),
    getComicsDirectories: jest.fn(),
    getLibraries: jest.fn(),
    getConfig: jest.fn(),
    getLibraryIdFromPath: jest.fn()
}));

jest.mock('../../../server/logger', () => ({ log: jest.fn() }));
jest.mock('../../../server/services/library-logos', () => ({ resolveLogo: jest.fn() }));
jest.mock('../../../server/services/library-pages', () => ({
    getComicPages: jest.fn(),
    extractPageBuffer: jest.fn()
}));
jest.mock('../../../server/services/library-metadata', () => ({ generateVirtualMetadata: jest.fn() }));
jest.mock('../../../server/services/library-scan', () => ({
    scanLibrary: jest.fn(),
    scheduleNextScan: jest.fn(),
    isScanning: jest.fn()
}));

const db = require('../../../server/db');
const config = require('../../../server/config');
const { resolveLogo } = require('../../../server/services/library-logos');
const { buildLibrary } = require('../../../server/services/library');

const INBOX_ROOT = '/synthetic/inbox';
const ROWS = [
    {
        id: 'mock-cbz-1',
        name: 'mock-comic-001.cbz',
        path: `${INBOX_ROOT}/DC/Batman/mock-comic-001.cbz`,
        publisher: 'DC',
        series: 'Batman',
        metadata: '{}'
    },
    {
        id: 'mock-cbr-1',
        name: 'mock-comic-002.cbr',
        path: `${INBOX_ROOT}/DC/Batman/mock-comic-002.cbr`,
        publisher: 'DC',
        series: 'Batman',
        metadata: '{}'
    }
];

function visibleIds(lib) {
    const ids = [];
    for (const root of Object.values(lib)) {
        for (const publisher of Object.values(root.publishers)) {
            for (const series of Object.values(publisher.series)) {
                for (const comic of series) {
                    ids.push(comic.id);
                }
            }
        }
    }
    return ids;
}

describe('buildLibrary allowed-format visibility', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        db.dbGet.mockResolvedValue({ role: 'admin' });
        db.dbAll.mockResolvedValue(ROWS);
        db.getReadingPrefMaps.mockResolvedValue({});
        db.resolveReadingModes.mockReturnValue({ mangaMode: false, continuousMode: false });
        db.checkComicAccess.mockResolvedValue(true);

        config.getAllowedFormats.mockReturnValue('cbz');
        config.getComicsDirectories.mockReturnValue([INBOX_ROOT]);
        config.getLibraries.mockReturnValue([]);
        config.getConfig.mockReturnValue({ comicsLocation: INBOX_ROOT });
        config.getLibraryIdFromPath.mockReturnValue('Library');

        resolveLogo.mockResolvedValue({ logoFile: null, needsBackground: false, needsDarkBackground: false });
    });

    it('hides CBR rows in Smart Inbox when allowed formats is cbz', async () => {
        config.getAllowedFormats.mockReturnValue('cbz');

        const lib = await buildLibrary('mock-user');

        expect(visibleIds(lib)).toEqual(['mock-cbz-1']);
        expect(JSON.stringify(lib)).not.toContain('mock-comic-002.cbr');
    });

    it('shows only CBR rows when allowed formats is cbr', async () => {
        config.getAllowedFormats.mockReturnValue('cbr');

        const lib = await buildLibrary('mock-user');

        expect(visibleIds(lib)).toEqual(['mock-cbr-1']);
        expect(JSON.stringify(lib)).not.toContain('mock-comic-001.cbz');
    });

    it('shows both formats when allowed formats is both', async () => {
        config.getAllowedFormats.mockReturnValue('both');

        const lib = await buildLibrary('mock-user');

        expect(visibleIds(lib)).toEqual(['mock-cbz-1', 'mock-cbr-1']);
    });
});
