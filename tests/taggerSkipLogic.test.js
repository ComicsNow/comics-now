const fs = require('fs');
const db = require('../server/db');
const { getCtLogs } = require('../server/logger');
const metadataService = require('../server/services/metadata');
const { runComicTagger, cancelComicTagger, isTaggerRunning, applyUserSelection, skipCurrentMatch, getPendingMatch } = require('../server/services/tagger');

describe('runComicTagger - Skip & Tagging Logic', () => {
  const originalFetch = global.fetch;
  let dbGetSpy;
  let dbRunSpy;
  let metaSpy;

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn().mockImplementation(async (url) => {
      if (typeof url === 'string' && url.includes('/api/health')) {
        return {
          ok: true,
          json: async () => ({ status: 'ok', version: '1.0' })
        };
      }
      return {
        ok: true,
        json: async () => ({})
      };
    });
    dbGetSpy = jest.spyOn(db, 'dbGet').mockResolvedValue(null);
    dbRunSpy = jest.spyOn(db, 'dbRun').mockResolvedValue();
    metaSpy = jest.spyOn(metadataService, 'getComicInfoFromArchive').mockResolvedValue({});
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  test('skips book if already scanned and tagged successfully with unmodified file mtime', async () => {
    jest.spyOn(fs, 'existsSync').mockReturnValue(true);
    jest.spyOn(fs.promises, 'readdir').mockResolvedValue([
      { name: 'Batman 01.cbz', isFile: () => true }
    ]);
    jest.spyOn(fs.promises, 'stat').mockResolvedValue({ mtimeMs: 10000 });

    // DB already contains this comic with matching mtimeMs and successful tagStatus
    dbGetSpy.mockResolvedValueOnce({
      id: 'mock-id',
      updatedAt: 10000,
      tagStatus: 'successful',
      series: 'Batman',
      publisher: 'DC'
    });

    await runComicTagger();

    // /api/tag-file should NOT be called
    expect(global.fetch).not.toHaveBeenCalledWith(
      expect.stringContaining('/api/tag-file'),
      expect.any(Object)
    );
    const logs = getCtLogs().map(l => l.message);
    expect(logs.some(m => m.includes('Already scanned and tagged'))).toBe(true);
  });

  test('processes book if file was modified on disk even if previously tagged', async () => {
    jest.spyOn(fs, 'existsSync').mockReturnValue(true);
    jest.spyOn(fs.promises, 'readdir').mockResolvedValue([
      { name: 'Batman 01.cbz', isFile: () => true }
    ]);
    // Disk has newer mtimeMs
    jest.spyOn(fs.promises, 'stat').mockResolvedValue({ mtimeMs: 20000 });

    // Custom tag-file response
    global.fetch.mockImplementation(async (url) => {
      if (typeof url === 'string' && url.includes('/api/health')) {
        return { ok: true, json: async () => ({ status: 'ok', version: '1.0' }) };
      }
      if (typeof url === 'string' && url.includes('/api/tag-file')) {
        return {
          ok: true,
          json: async () => ({
            status: 'tagged',
            matched_title: 'Batman (2016) #1',
            confidence: 95,
            metadata: { series: 'Batman', publisher: 'DC Comics', number: '1', year: '2016' }
          })
        };
      }
      return { ok: true, json: async () => ({}) };
    });

    // DB contains older mtimeMs
    dbGetSpy.mockResolvedValueOnce({
      id: 'mock-id',
      updatedAt: 10000,
      tagStatus: 'successful',
      series: 'Batman',
      publisher: 'DC'
    });

    // Archive check for checkFileSuccess
    metaSpy
      .mockResolvedValueOnce({}) // Before tagging / checkFileSuccess check
      .mockResolvedValueOnce({ Series: 'Batman', Publisher: 'DC Comics', Number: '1', Year: '2016' }) // checkFileSuccess after tag
      .mockResolvedValueOnce({ Series: 'Batman', Publisher: 'DC Comics', Number: '1', Year: '2016' }); // get db meta

    await runComicTagger();

    // /api/tag-file SHOULD be called because file was modified
    expect(global.fetch).toHaveBeenCalledWith('http://127.0.0.1:5000/api/tag-file', expect.any(Object));
    expect(dbRunSpy).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO comics'),
      expect.arrayContaining(['successful'])
    );
  });

  test('skips calling external APIs if archive file on disk already contains complete metadata', async () => {
    jest.spyOn(fs, 'existsSync').mockReturnValue(true);
    jest.spyOn(fs.promises, 'readdir').mockResolvedValue([
      { name: 'Superman 01.cbz', isFile: () => true }
    ]);
    jest.spyOn(fs.promises, 'stat').mockResolvedValue({ mtimeMs: 15000 });

    // Comic is not in DB or pending
    dbGetSpy.mockResolvedValueOnce(null);

    // Archive already has complete metadata
    metaSpy.mockResolvedValue({
      Series: 'Superman',
      Publisher: 'DC Comics',
      Number: '1',
      Year: '2018'
    });

    await runComicTagger();

    // /api/tag-file should NOT be called
    expect(global.fetch).not.toHaveBeenCalledWith(
      expect.stringContaining('/api/tag-file'),
      expect.any(Object)
    );
    expect(dbRunSpy).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO comics'),
      expect.arrayContaining(['Superman', 'DC Comics', 'successful'])
    );
    const logs = getCtLogs().map(l => l.message);
    expect(logs.some(m => m.includes('Already contains complete metadata'))).toBe(true);
  });

  test('force scan re-evaluates and calls external APIs even if archive file on disk already contains complete metadata', async () => {
    jest.spyOn(fs, 'existsSync').mockReturnValue(true);
    jest.spyOn(fs.promises, 'readdir').mockResolvedValue([
      { name: 'Superman 01.cbz', isFile: () => true }
    ]);
    jest.spyOn(fs.promises, 'stat').mockResolvedValue({ mtimeMs: 15000 });

    global.fetch.mockImplementation(async (url) => {
      if (typeof url === 'string' && url.includes('/api/health')) {
        return { ok: true, json: async () => ({ status: 'ok', version: '1.0' }) };
      }
      if (typeof url === 'string' && url.includes('/api/tag-file')) {
        return {
          ok: true,
          json: async () => ({
            status: 'tagged',
            matched_title: 'Superman (2018) #1',
            confidence: 98,
            metadata: { series: 'Superman', publisher: 'DC Comics', number: '1', year: '2018' }
          })
        };
      }
      return { ok: true, json: async () => ({}) };
    });

    dbGetSpy.mockResolvedValueOnce(null);

    // Archive already has complete metadata
    metaSpy.mockResolvedValue({
      Series: 'Superman',
      Publisher: 'DC Comics',
      Number: '1',
      Year: '2018'
    });

    // Run with force: true
    await runComicTagger({ force: true });

    // /api/tag-file MUST be called because force: true was requested
    expect(global.fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:5000/api/tag-file',
      expect.objectContaining({
        body: expect.stringContaining('"force_reprocess":true')
      })
    );
  });

  test('skips previously failed comic if file is unmodified unless force is specified', async () => {
    jest.spyOn(fs, 'existsSync').mockReturnValue(true);
    jest.spyOn(fs.promises, 'readdir').mockResolvedValue([
      { name: 'Unknown 01.cbz', isFile: () => true }
    ]);
    jest.spyOn(fs.promises, 'stat').mockResolvedValue({ mtimeMs: 10000 });

    // DB has failed comic with matching mtimeMs
    dbGetSpy.mockResolvedValueOnce({
      id: 'mock-id',
      updatedAt: 10000,
      tagStatus: 'failed'
    });

    metaSpy.mockResolvedValue({});

    await runComicTagger({ force: false });

    // External tagger not called
    expect(global.fetch).not.toHaveBeenCalledWith(
      expect.stringContaining('/api/tag-file'),
      expect.any(Object)
    );
    const logs = getCtLogs().map(l => l.message);
    expect(logs.some(m => m.includes('Previously scanned with no match (file unmodified)'))).toBe(true);
  });

  test('processes previously failed comic when force is true', async () => {
    jest.spyOn(fs, 'existsSync').mockReturnValue(true);
    jest.spyOn(fs.promises, 'readdir').mockResolvedValue([
      { name: 'Unknown 01.cbz', isFile: () => true }
    ]);
    jest.spyOn(fs.promises, 'stat').mockResolvedValue({ mtimeMs: 10000 });

    global.fetch.mockImplementation(async (url) => {
      if (typeof url === 'string' && url.includes('/api/health')) {
        return { ok: true, json: async () => ({ status: 'ok', version: '1.0' }) };
      }
      if (typeof url === 'string' && url.includes('/api/tag-file')) {
        return {
          ok: true,
          json: async () => ({
            status: 'failed',
            matched_title: null,
            confidence: 0,
            metadata: null
          })
        };
      }
      return { ok: true, json: async () => ({}) };
    });

    // DB has failed comic with matching mtimeMs
    dbGetSpy.mockResolvedValueOnce({
      id: 'mock-id',
      updatedAt: 10000,
      tagStatus: 'failed'
    });

    metaSpy.mockResolvedValue({});

    await runComicTagger({ force: true });

    // External tagger MUST be called because force: true
    expect(global.fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:5000/api/tag-file',
      expect.objectContaining({
        body: expect.stringContaining('"force_reprocess":true')
      })
    );
  });

  test('buildComicInfoXml correctly serializes list fields into comma-separated strings', () => {
    const xml = metadataService.buildComicInfoXml({
      Series: 'Green Lantern',
      Number: '1',
      Publisher: 'DC Comics',
      Characters: ['Hal Jordan', 'Sinestro', 'Carol Ferris'],
      Teams: ['Green Lantern Corps', 'Justice League'],
      Genre: ['Superhero', 'Sci-Fi'],
      Writer: 'Geoff Johns'
    });

    expect(xml).toContain('<Series>Green Lantern</Series>');
    expect(xml).toContain('<Characters>Hal Jordan, Sinestro, Carol Ferris</Characters>');
    expect(xml).toContain('<Teams>Green Lantern Corps, Justice League</Teams>');
    expect(xml).toContain('<Genre>Superhero, Sci-Fi</Genre>');
  });

  test('buildComicInfoXml retains Series and strips Title when Title and Series match', () => {
    const xml = metadataService.buildComicInfoXml({
      Title: 'Batman: Year One',
      Series: 'Batman: Year One',
      Number: '1',
      Publisher: 'DC Comics'
    });

    expect(xml).toContain('<Series>Batman: Year One</Series>');
    expect(xml).not.toContain('<Title>');
  });

  test('buildComicInfoXml strips format tags (TPB, HC, HB, Paperback, Digital) from Title and Series', () => {
    const xml = metadataService.buildComicInfoXml({
      Title: 'DC Finest: War – The Big Five (digital)',
      Series: 'DC Finest: War – The Big Five TPB',
      Number: '1',
      Publisher: 'DC Comics'
    });

    // Since Title and Series both resolve to 'DC Finest: War – The Big Five', Title is stripped and Series is retained
    expect(xml).toContain('<Series>DC Finest: War – The Big Five</Series>');
    expect(xml).not.toContain('<Title>');
    expect(xml).not.toContain('TPB');
    expect(xml).not.toContain('digital');
  });

  test('cleanFormatAndEdition correctly strips format terms', () => {
    expect(metadataService.cleanFormatAndEdition('Batman: Year One (TPB)')).toBe('Batman: Year One');
    expect(metadataService.cleanFormatAndEdition('Batman: Year One [HC]')).toBe('Batman: Year One');
    expect(metadataService.cleanFormatAndEdition('Batman: Year One {HB}')).toBe('Batman: Year One');
    expect(metadataService.cleanFormatAndEdition('Batman: Year One (Paperback)')).toBe('Batman: Year One');
    expect(metadataService.cleanFormatAndEdition('Batman: Year One - Hardcover')).toBe('Batman: Year One');
    expect(metadataService.cleanFormatAndEdition('Batman: Year One - Trade Paperback')).toBe('Batman: Year One');
    expect(metadataService.cleanFormatAndEdition('Batman: Year One SC')).toBe('Batman: Year One');
    expect(metadataService.cleanFormatAndEdition('Batman: Year One GN')).toBe('Batman: Year One');
    expect(metadataService.cleanFormatAndEdition('DC Finest - War - TPB')).toBe('DC Finest - War');
    expect(metadataService.cleanFormatAndEdition('Batman: Digital Justice')).toBe('Batman: Digital Justice');
  });

  test('review and candidate selection applies tag and cleanly resolves user selection', async () => {
    jest.spyOn(fs, 'existsSync').mockReturnValue(true);
    jest.spyOn(fs.promises, 'readdir').mockResolvedValue([
      { name: 'DC Finest Green Lantern.cbz', isFile: () => true }
    ]);
    jest.spyOn(fs.promises, 'stat').mockResolvedValue({ mtimeMs: 10000 });
    dbGetSpy.mockResolvedValueOnce(null);

    // Mock review response from tagger engine
    global.fetch.mockImplementation(async (url) => {
      if (typeof url === 'string' && url.includes('/api/health')) {
        return { ok: true, json: async () => ({ status: 'ok', version: '1.0' }) };
      }
      if (typeof url === 'string' && url.includes('/api/tag-file')) {
        return {
          ok: true,
          json: async () => ({
            status: 'review',
            confidence: 65,
            candidates: [
              {
                score: 65,
                source: 'comicvine',
                metadata: {
                  title: 'DC Finest: Green Lantern - The Silver Age Vol 1',
                  publisher: 'DC Comics',
                  number: '1',
                  characters: ['Hal Jordan', 'Guy Gardner']
                }
              }
            ]
          })
        };
      }
      if (typeof url === 'string' && url.includes('/api/apply-tag')) {
        return { ok: true, json: async () => ({ status: 'success' }) };
      }
      return { ok: true, json: async () => ({}) };
    });

    metaSpy
      .mockResolvedValueOnce({}) // Check 2 before tagging (not already complete)
      .mockResolvedValueOnce({ Series: 'DC Finest: Green Lantern - The Silver Age Vol 1', Publisher: 'DC Comics', Number: '1', Year: '2024' }) // checkFileSuccess in applyUserSelection
      .mockResolvedValueOnce({ Series: 'DC Finest: Green Lantern - The Silver Age Vol 1', Publisher: 'DC Comics', Number: '1', Year: '2024' }); // getComicInfoFromArchive in applyUserSelection

    const runPromise = runComicTagger();

    // Wait until tagger enters pending match state
    while (!getPendingMatch()) {
      await new Promise(r => setTimeout(r, 10));
    }

    const pending = getPendingMatch();
    expect(pending).toBeTruthy();
    expect(pending.matches.length).toBe(1);
    expect(pending.matches[0].title).toBe('DC Finest: Green Lantern - The Silver Age Vol 1');

    // Apply selection
    await applyUserSelection(['1']);

    await runPromise;

    expect(dbRunSpy).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO comics'),
      expect.arrayContaining(['DC Finest: Green Lantern - The Silver Age Vol 1', 'DC Comics', 'successful'])
    );
    expect(getPendingMatch()).toBeNull();
  });

  test('cancelling scan during low-confidence review preserves match state and allows user to apply selection after cancellation', async () => {
    jest.spyOn(fs, 'existsSync').mockReturnValue(true);
    jest.spyOn(fs.promises, 'readdir').mockResolvedValue([
      { name: 'Spider-Man 01.cbz', isFile: () => true },
      { name: 'Spider-Man 02.cbz', isFile: () => true }
    ]);
    jest.spyOn(fs.promises, 'stat').mockResolvedValue({ mtimeMs: 10000 });
    dbGetSpy.mockResolvedValue(null);

    global.fetch.mockImplementation(async (url) => {
      if (typeof url === 'string' && url.includes('/api/health')) {
        return { ok: true, json: async () => ({ status: 'ok', version: '1.0' }) };
      }
      if (typeof url === 'string' && url.includes('/api/tag-file')) {
        return {
          ok: true,
          json: async () => ({
            status: 'review',
            confidence: 72,
            candidates: [
              {
                score: 72,
                source: 'comicvine',
                metadata: {
                  title: 'The Amazing Spider-Man #1',
                  publisher: 'Marvel Comics',
                  number: '1',
                  year: '1963'
                }
              }
            ]
          })
        };
      }
      if (typeof url === 'string' && url.includes('/api/apply-tag')) {
        return { ok: true, json: async () => ({ status: 'success' }) };
      }
      return { ok: true, json: async () => ({}) };
    });

    metaSpy
      .mockResolvedValueOnce({}) // Check 2 before tagging (not already complete)
      .mockResolvedValueOnce({ Series: 'The Amazing Spider-Man', Publisher: 'Marvel Comics', Number: '1', Year: '1963' }) // checkFileSuccess in applyUserSelection
      .mockResolvedValueOnce({ Series: 'The Amazing Spider-Man', Publisher: 'Marvel Comics', Number: '1', Year: '1963' }); // getComicInfoFromArchive in applyUserSelection

    const runPromise = runComicTagger();

    // Wait until review required state is reached
    while (!getPendingMatch()) {
      await new Promise(r => setTimeout(r, 10));
    }

    expect(isTaggerRunning()).toBe(true);
    expect(getPendingMatch()).toBeTruthy();
    expect(getPendingMatch().fileName).toBe('Spider-Man 01.cbz');

    // User cancels the scan while review is pending
    const cancelled = cancelComicTagger();
    expect(cancelled).toBe(true);

    // Scan loop should cleanly exit
    await runPromise;
    expect(isTaggerRunning()).toBe(false);

    // CRITICAL: Pending match must STILL be available for review in the Matches tab
    const pendingAfterCancel = getPendingMatch();
    expect(pendingAfterCancel).toBeTruthy();
    expect(pendingAfterCancel.fileName).toBe('Spider-Man 01.cbz');
    expect(pendingAfterCancel.waitingForResponse).toBe(true);
    expect(pendingAfterCancel.matches.length).toBe(1);

    // User now applies candidate #1 from the review tab
    await applyUserSelection(['1']);

    expect(dbRunSpy).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO comics'),
      expect.arrayContaining(['The Amazing Spider-Man', 'Marvel', 'successful'])
    );

    // Once applied, pending match state should be cleared
    expect(getPendingMatch()).toBeNull();
  });

  test('cancelling scan during low-confidence review allows user to skip match after cancellation', async () => {
    jest.spyOn(fs, 'existsSync').mockReturnValue(true);
    jest.spyOn(fs.promises, 'readdir').mockResolvedValue([
      { name: 'X-Men 01.cbz', isFile: () => true }
    ]);
    jest.spyOn(fs.promises, 'stat').mockResolvedValue({ mtimeMs: 10000 });
    dbGetSpy.mockResolvedValue(null);

    global.fetch.mockImplementation(async (url) => {
      if (typeof url === 'string' && url.includes('/api/health')) {
        return { ok: true, json: async () => ({ status: 'ok', version: '1.0' }) };
      }
      if (typeof url === 'string' && url.includes('/api/tag-file')) {
        return {
          ok: true,
          json: async () => ({
            status: 'review',
            confidence: 60,
            candidates: [
              {
                score: 60,
                source: 'gcd',
                metadata: { title: 'Uncanny X-Men #1', publisher: 'Marvel', number: '1' }
              }
            ]
          })
        };
      }
      return { ok: true, json: async () => ({}) };
    });

    metaSpy.mockResolvedValue({});

    const runPromise = runComicTagger();

    while (!getPendingMatch()) {
      await new Promise(r => setTimeout(r, 10));
    }

    expect(getPendingMatch().fileName).toBe('X-Men 01.cbz');

    // Cancel scan
    cancelComicTagger();
    await runPromise;

    expect(isTaggerRunning()).toBe(false);
    expect(getPendingMatch()).not.toBeNull();

    // User skips the match
    await skipCurrentMatch();

    expect(dbRunSpy).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO comics'),
      expect.arrayContaining(['X-Men 01.cbz', 'failed'])
    );
    expect(getPendingMatch()).toBeNull();
  });
});
