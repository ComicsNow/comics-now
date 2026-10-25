const fs = require('fs');
const path = require('path');

jest.mock('fs', () => {
    return {
        existsSync: jest.fn(),
        promises: {
            mkdir: jest.fn(),
            writeFile: jest.fn(),
        }
    };
});

jest.mock('onnxruntime-node', () => ({
    InferenceSession: {
        create: jest.fn()
    },
    Tensor: jest.fn()
}));

jest.mock('sharp', () => {
    const sharpMock = jest.fn();
    sharpMock.mockReturnValue({
        removeAlpha: jest.fn().mockReturnThis(),
        grayscale: jest.fn().mockReturnThis(),
        metadata: jest.fn().mockResolvedValue({ width: 1000, height: 1500 }),
        resize: jest.fn().mockReturnThis(),
        raw: jest.fn().mockReturnThis(),
        toBuffer: jest.fn().mockResolvedValue({ data: Buffer.from('fake image data'), info: { width: 1000, height: 1500 } })
    });
    return sharpMock;
});

jest.mock('../../../server/services/archive-utils', () => ({
    listPages: jest.fn(),
    getEntryBuffer: jest.fn()
}));

jest.mock('../../../server/constants', () => ({
    ROOT_DIR: '/fake/root/dir'
}));

jest.mock('../../../server/logger', () => ({
    guidedLog: jest.fn(),
    guidedLogUpdate: jest.fn(),
    log: jest.fn()
}));

const { processComic, extractPageBuffer, GUIDED_VIEW_DIR } = require('../../../server/services/panel-detector');
const archiveUtils = require('../../../server/services/archive-utils');
const ort = require('onnxruntime-node');

describe('panel-detector', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        fs.existsSync.mockReturnValue(true);
        fs.promises.mkdir.mockResolvedValue();
        fs.promises.writeFile.mockResolvedValue();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });
    describe('extractPageBuffer', () => {
        test('delegates to getEntryBuffer', async () => {
            const buffer = Buffer.from('test buffer');
            archiveUtils.getEntryBuffer.mockResolvedValue(buffer);

            const result = await extractPageBuffer('/path/to/comic.cbz', 'page1.jpg');

            expect(archiveUtils.getEntryBuffer).toHaveBeenCalledWith('/path/to/comic.cbz', 'page1.jpg');
            expect(result).toBe(buffer);
        });
    });

    describe('processComic - error and edge cases', () => {
        test('throws error if no pages are found', async () => {
            archiveUtils.listPages.mockResolvedValue([]);

            await expect(processComic('comic-id-1', '/path/to/comic.cbz', 'western'))
                .rejects.toThrow('No pages found');
        });

        test('throws error if cancelled', async () => {
            archiveUtils.listPages.mockResolvedValue(['page1.jpg']);

            await expect(processComic('comic-id-1', '/path/to/comic.cbz', 'western', { isCancelled: () => true }))
                .rejects.toThrow('Cancelled');
        });

        test('handles page extraction timeout gracefully', async () => {
            jest.useFakeTimers();
            archiveUtils.listPages.mockResolvedValue(['page1.jpg']);
            let resultData;
            fs.promises.writeFile.mockImplementation(async (path, data) => {
                resultData = JSON.parse(data);
            });

            // Make extraction hang forever
            archiveUtils.getEntryBuffer.mockImplementation(() => new Promise(() => {}));

            // Should not throw, should just log a warning and return empty arrays for this page
            const promise = processComic('comic-id-1', '/path/to/comic.cbz', 'western');

            // Allow promises to resolve up to the await withTimeout
            await Promise.resolve();
            await Promise.resolve();
            await Promise.resolve();

            jest.advanceTimersByTime(35000);
            const result = await promise;

            expect(result.pagesProcessed).toBe(0);
            expect(result.panels).toBe(0);
            expect(resultData.pages['page1.jpg']).toEqual({ panels: [], bubbles: [], sequence: [] });

            jest.useRealTimers();
        });
    });

    describe('processComic - happy paths', () => {
        beforeEach(() => {
            archiveUtils.listPages.mockResolvedValue(['page1.jpg']);
            archiveUtils.getEntryBuffer.mockResolvedValue(Buffer.from('fake page data'));

            // Mock YOLO output tensor (boxes)
            ort.InferenceSession.create.mockResolvedValue({
                run: jest.fn().mockResolvedValue({
                    output0: {
                        data: new Float32Array(8400 * 6).fill(0), // Fake tensor data
                        dims: [1, 6, 8400]
                    }
                })
            });
        });

        test('processes a manga comic successfully', async () => {
            let writtenData;
            fs.promises.writeFile.mockImplementation(async (path, data) => {
                writtenData = JSON.parse(data);
            });

            const result = await processComic('comic-123', '/path.cbz', 'manga');

            expect(result.panels).toBeGreaterThanOrEqual(0);
            expect(result.pagesProcessed).toBe(1);
            expect(result.pageCount).toBe(1);
            expect(result.outputPath).toContain('comic-123.json');

            expect(writtenData).toBeDefined();
            expect(writtenData.comicId).toBe('comic-123');
            expect(writtenData.type).toBe('manga');
            expect(writtenData.pages['page1.jpg']).toBeDefined();
        });

        test('processes a western comic successfully', async () => {
            let writtenData;
            fs.promises.writeFile.mockImplementation(async (path, data) => {
                writtenData = JSON.parse(data);
            });

            const result = await processComic('comic-124', '/path.cbz', 'western');

            expect(result.panels).toBeGreaterThanOrEqual(0);
            expect(result.pagesProcessed).toBe(1);
            expect(result.pageCount).toBe(1);
            expect(result.outputPath).toContain('comic-124.json');

            expect(writtenData).toBeDefined();
            expect(writtenData.comicId).toBe('comic-124');
            expect(writtenData.type).toBe('western');
            expect(writtenData.pages['page1.jpg']).toBeDefined();
        });
    });
});
