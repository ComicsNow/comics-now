const { openArchive, listPages, getEntryBuffer } = require('../../../server/services/archive-utils');
const path = require('path');
const fs = require('fs');
const { createExtractorFromData } = require('node-unrar-js');

jest.mock('node-unrar-js', () => ({
    createExtractorFromData: jest.fn()
}));

jest.mock('fs', () => ({
    ...jest.requireActual('fs'),
    readFileSync: jest.fn()
}));

describe('archive-utils', () => {
    const sampleZip = path.join(__dirname, '../../fixtures/sample.cbz');

    beforeEach(() => {
        jest.clearAllMocks();
        // Default readFileSync behavior
        fs.readFileSync.mockImplementation((path) => {
            if (path.endsWith('.cbz')) {
                return jest.requireActual('fs').readFileSync(path);
            }
            return Buffer.from('fake data');
        });
    });

    describe('openArchive (ZIP)', () => {
        test('lists entries in a ZIP file', async () => {
            const archive = await openArchive(sampleZip);
            const entries = await archive.listEntries();
            expect(entries).toContain('opt/comics-now-dev/tests/fixtures/test.txt');
            await archive.close();
        });

        test('readBuffer reads entry content', async () => {
            const archive = await openArchive(sampleZip);
            const buffer = await archive.readBuffer('opt/comics-now-dev/tests/fixtures/test.txt');
            expect(buffer.toString()).toBe('test content\n');
            await archive.close();
        });
    });

    describe('openArchive (RAR Mocked)', () => {
        test('lists entries in a RAR file', async () => {
            const mockExtractor = {
                getFileList: jest.fn().mockReturnValue({
                    arcHeader: [],
                    fileHeaders: [
                        { name: 'page1.jpg', flags: { directory: false } },
                        { name: 'page2.jpg', flags: { directory: false } },
                        { name: 'some_dir', flags: { directory: true } }
                    ]
                }),
                extract: jest.fn()
            };
            createExtractorFromData.mockResolvedValue(mockExtractor);
            
            const archive = await openArchive('dummy.cbr'); 
            const entries = await archive.listEntries();
            expect(entries).toEqual(['page1.jpg', 'page2.jpg']);
            expect(createExtractorFromData).toHaveBeenCalled();
        });

        test('readBuffer in a RAR file', async () => {
            const mockExtractor = {
                getFileList: jest.fn().mockReturnValue({
                    arcHeader: [],
                    fileHeaders: [{ name: 'page1.jpg', flags: { directory: false } }]
                }),
                extract: jest.fn().mockReturnValue({
                    files: [{ extraction: Buffer.from('fake image data') }]
                })
            };
            createExtractorFromData.mockResolvedValue(mockExtractor);

            const archive = await openArchive('dummy.cbr');
            const buffer = await archive.readBuffer('page1.jpg');
            expect(buffer.toString()).toBe('fake image data');
            expect(mockExtractor.extract).toHaveBeenCalledWith({ files: ['page1.jpg'] });
        });
    });

    describe('listPages', () => {
        test('lists sorted image entries, excluding hidden ones', async () => {
            const pages = await listPages(sampleZip);
            expect(pages).toEqual([]);
        });

        test('lists sorted image entries from RAR', async () => {
            const mockExtractor = {
                getFileList: jest.fn().mockReturnValue({
                    arcHeader: [],
                    fileHeaders: [
                        { name: '02.jpg', flags: { directory: false } },
                        { name: '01.jpg', flags: { directory: false } },
                        { name: 'thumb.db', flags: { directory: false } },
                        { name: '.hidden.jpg', flags: { directory: false } },
                        { name: '10.jpg', flags: { directory: false } }
                    ]
                }),
                extract: jest.fn()
            };
            createExtractorFromData.mockResolvedValue(mockExtractor);

            const pages = await listPages('dummy.cbr');
            expect(pages).toEqual(['01.jpg', '02.jpg', '10.jpg']);
        });
    });

    describe('getEntryBuffer', () => {
        test('returns buffer for a specific entry', async () => {
            const buffer = await getEntryBuffer(sampleZip, 'opt/comics-now-dev/tests/fixtures/test.txt');
            expect(buffer.toString()).toBe('test content\n');
        });

        test('throws error for path traversal attempts (..)', async () => {
            await expect(getEntryBuffer(sampleZip, '../etc/passwd')).rejects.toThrow('Potential path traversal attempt');
            await expect(getEntryBuffer(sampleZip, 'some/dir/../../etc/passwd')).rejects.toThrow('Potential path traversal attempt');
        });

        test('throws error for absolute path attempts', async () => {
            await expect(getEntryBuffer(sampleZip, '/etc/passwd')).rejects.toThrow('Potential path traversal attempt');
        });
    });
});
