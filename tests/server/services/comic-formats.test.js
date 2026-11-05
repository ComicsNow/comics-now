const { isComicFormatAllowed } = require('../../../server/services/comic-formats');

describe('isComicFormatAllowed', () => {
    test.each([
        ['.cbz under cbz', 'mock-comic-001.cbz', 'cbz', true],
        ['.cbr under cbz', 'mock-comic-002.cbr', 'cbz', false],
        ['.cbz under cbr', 'mock-comic-001.cbz', 'cbr', false],
        ['.cbr under cbr', 'mock-comic-002.cbr', 'cbr', true],
        ['.cbz under both', 'mock-comic-001.cbz', 'both', true],
        ['.cbr under both', 'mock-comic-002.cbr', 'both', true],
        ['uppercase CBZ under cbz', 'MOCK-COMIC.CBZ', 'cbz', true],
        ['uppercase CBR under cbz', 'MOCK-COMIC.CBR', 'cbz', false],
        ['uppercase CBR under cbr', 'MOCK-COMIC.CBR', 'cbr', true],
        ['mode is case-insensitive', 'mock-comic-001.cbz', 'CBZ', true],
        ['dotted directory segment', 'library/Vol.1/mock-comic-001.cbz', 'cbz', true],
        ['extensionless entry stays visible', 'README', 'cbz', true],
        ['other extensions stay visible', 'notes.pdf', 'cbz', true],
        ['other extensions stay visible in cbr mode', 'notes.pdf', 'cbr', true],
        ['undefined mode defaults to cbz (cbz)', 'mock-comic-001.cbz', undefined, true],
        ['undefined mode defaults to cbz (cbr)', 'mock-comic-002.cbr', undefined, false],
        ['invalid mode defaults to cbz (cbz)', 'mock-comic-001.cbz', 'unexpected', true],
        ['invalid mode defaults to cbz (cbr)', 'mock-comic-002.cbr', 'unexpected', false],
        ['empty name stays visible', '', 'cbz', true]
    ])('%s', (_label, fileName, mode, expected) => {
        expect(isComicFormatAllowed(fileName, mode)).toBe(expected);
    });
});
