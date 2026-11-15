const {
    ALL_COMIC_FORMATS,
    SUPPORTED_COMIC_EXTENSIONS,
    normalizeAllowedFormats,
    isComicFormatAllowed
} = require('../../../server/services/comic-formats');

describe('comic-formats', () => {
    test('exports ALL_COMIC_FORMATS and SUPPORTED_COMIC_EXTENSIONS with cbz, cbr, pdf, epub', () => {
        expect(ALL_COMIC_FORMATS).toEqual(['cbz', 'cbr', 'pdf', 'epub']);
        expect(SUPPORTED_COMIC_EXTENSIONS).toEqual(['.cbz', '.cbr', '.pdf', '.epub']);
    });

    test.each([
        ['single cbz', 'cbz', ['cbz']],
        ['single cbr', 'cbr', ['cbr']],
        ['single pdf', 'pdf', ['pdf']],
        ['single epub', 'epub', ['epub']],
        ['legacy both', 'both', ['cbz', 'cbr']],
        ['legacy all', 'all', ['cbz', 'cbr', 'pdf', 'epub']],
        ['csv string', 'cbz, pdf, epub', ['cbz', 'pdf', 'epub']],
        ['array input', ['EPUB', 'cbz', 'invalid', 'cbz'], ['epub', 'cbz']],
        ['empty array defaults to cbz', [], ['cbz']],
        ['undefined defaults to cbz', undefined, ['cbz']]
    ])('normalizeAllowedFormats(%s)', (_label, input, expected) => {
        expect(normalizeAllowedFormats(input)).toEqual(expected);
    });
});

describe('isComicFormatAllowed', () => {
    test.each([
        ['.cbz under cbz', 'mock-comic-001.cbz', 'cbz', true],
        ['.cbr under cbz', 'mock-comic-002.cbr', 'cbz', false],
        ['.pdf under cbz', 'mock-comic-003.pdf', 'cbz', false],
        ['.epub under cbz', 'mock-comic-004.epub', 'cbz', false],
        ['.cbz under cbr', 'mock-comic-001.cbz', 'cbr', false],
        ['.cbr under cbr', 'mock-comic-002.cbr', 'cbr', true],
        ['.pdf under pdf', 'mock-comic-003.pdf', 'pdf', true],
        ['.epub under epub', 'mock-comic-004.epub', 'epub', true],
        ['.cbz under both', 'mock-comic-001.cbz', 'both', true],
        ['.cbr under both', 'mock-comic-002.cbr', 'both', true],
        ['.pdf under both', 'mock-comic-003.pdf', 'both', false],
        ['.pdf under array', 'mock-comic-003.pdf', ['cbz', 'pdf'], true],
        ['.epub under all', 'mock-comic-004.epub', 'all', true],
        ['uppercase CBZ under cbz', 'MOCK-COMIC.CBZ', 'cbz', true],
        ['uppercase CBR under cbz', 'MOCK-COMIC.CBR', 'cbz', false],
        ['uppercase PDF under pdf', 'MOCK-COMIC.PDF', ['pdf'], true],
        ['uppercase EPUB under epub', 'MOCK-COMIC.EPUB', ['epub'], true],
        ['mode is case-insensitive', 'mock-comic-001.cbz', 'CBZ', true],
        ['dotted directory segment', 'library/Vol.1/mock-comic-001.cbz', 'cbz', true],
        ['extensionless entry stays visible', 'README', 'cbz', true],
        ['non-comic extensions stay visible', 'notes.txt', 'cbz', true],
        ['undefined mode defaults to cbz (cbz)', 'mock-comic-001.cbz', undefined, true],
        ['undefined mode defaults to cbz (cbr)', 'mock-comic-002.cbr', undefined, false],
        ['invalid mode defaults to cbz (cbz)', 'mock-comic-001.cbz', 'unexpected', true],
        ['invalid mode defaults to cbz (cbr)', 'mock-comic-002.cbr', 'unexpected', false],
        ['empty name stays visible', '', 'cbz', true]
    ])('%s', (_label, fileName, mode, expected) => {
        expect(isComicFormatAllowed(fileName, mode)).toBe(expected);
    });
});
