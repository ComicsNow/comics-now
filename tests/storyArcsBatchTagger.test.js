/**
 * Story Arcs Batch ComicInfo.xml Tagger Unit & Integration Tests
 */
const { initReadingOrdersDb } = require('../server/readingOrdersDb');
const { createContinuityMatcher } = require('../server/services/continuityMatcher');
const { createStoryArcsBatchTagger } = require('../server/services/story-arcs-batch-tagger');

describe('Story Arcs Batch ComicInfo Tagger', () => {
  let readingOrdersDb;
  let matcher;
  let mockComics;
  let mockSaveMetadata;
  let mockGetComicInfo;
  let mockDbAll;
  let mockDbRun;
  let batchTagger;

  beforeEach(() => {
    readingOrdersDb = initReadingOrdersDb(':memory:');

    // Seed test reading orders across multiple publishers
    readingOrdersDb.upsertReadingOrder({
      id: 'civil-war',
      title: 'Civil War',
      publisher: 'Marvel Comics',
      description: 'Superhuman Registration Act crossover.',
      category: 'Event'
    });
    readingOrdersDb.upsertIssues('civil-war', [
      { position: 1, seriesName: 'Civil War', issueNumber: '1', importance: 'Essential' },
      { position: 2, seriesName: 'Amazing Spider-Man', issueNumber: '532', importance: 'Tie-In' }
    ]);

    readingOrdersDb.upsertReadingOrder({
      id: 'dc-ko',
      title: 'DC K.O.',
      publisher: 'DC Comics',
      description: 'DC All Fight tournament.',
      category: 'Event'
    });
    readingOrdersDb.upsertIssues('dc-ko', [
      { position: 1, seriesName: 'DC K.O. - All Fight', issueNumber: '1', importance: 'Essential' },
      { position: 2, seriesName: 'DC All In Special', issueNumber: '1', importance: 'Tie-In' }
    ]);

    mockComics = [
      {
        id: 'comic-marvel-1',
        publisher: 'Marvel Comics',
        series: 'Civil War',
        name: 'Civil War (2006) #1.cbz',
        path: '/comics/Marvel/Civil War/Civil War 01.cbz',
        metadata: JSON.stringify({
          Title: 'Civil War #1',
          Series: 'Civil War',
          Number: '1',
          Writer: 'Mark Millar',
          Penciller: 'Steve McNiven',
          Summary: 'The battle begins.',
          Year: '2006',
          Characters: 'Iron Man, Captain America'
        })
      },
      {
        id: 'comic-dc-1',
        publisher: 'DC Comics',
        series: 'DC K.O. - All Fight',
        name: '01 DC K.O. - All Fight.cbz',
        path: '/comics/DC/DC KO/01 DC K.O. - All Fight.cbz',
        metadata: JSON.stringify({
          Title: 'All Fight #1',
          Series: 'DC K.O. - All Fight',
          Number: '1',
          Writer: 'Scott Snyder',
          Summary: 'Tournament commences.',
          Year: '2026',
          StoryArc: 'Old Outdated Arc',
          StoryArcNumber: '99'
        })
      },
      {
        id: 'comic-image-1',
        publisher: 'Image Comics',
        series: 'Spawn',
        name: 'Spawn 001.cbz',
        path: '/comics/Image/Spawn/Spawn 001.cbz',
        metadata: JSON.stringify({
          Series: 'Spawn',
          Number: '1',
          Writer: 'Todd McFarlane'
        })
      }
    ];

    mockDbAll = jest.fn(async (sql, params = []) => {
      if (sql.includes('FROM comics')) {
        if (params.length > 0) {
          return mockComics.filter(c => params.includes(c.publisher));
        }
        return mockComics;
      }
      return [];
    });

    mockDbRun = jest.fn(async () => ({ changes: 1 }));

    matcher = createContinuityMatcher({
      readingOrdersDb,
      getComics: () => mockComics
    });

    mockGetComicInfo = jest.fn(async (filePath) => {
      const found = mockComics.find(c => c.path === filePath);
      return found ? JSON.parse(found.metadata) : null;
    });

    mockSaveMetadata = jest.fn(async (filePath, updatedMeta) => {
      const found = mockComics.find(c => c.path === filePath);
      if (found) {
        found.metadata = JSON.stringify(updatedMeta);
      }
      return true;
    });

    batchTagger = createStoryArcsBatchTagger({
      readingOrdersDb,
      matcher,
      dbAll: mockDbAll,
      dbRun: mockDbRun,
      getComicInfoFromArchive: mockGetComicInfo,
      saveMetadataToComic: mockSaveMetadata
    });
  });

  test('getStoryArcPublishers returns distinct publishers from reading-orders.db', () => {
    const pubs = batchTagger.getStoryArcPublishers();
    expect(pubs).toEqual(expect.arrayContaining(['DC Comics', 'Marvel Comics']));
    expect(pubs).not.toContain('Image Comics');
  });

  test('startBatchTag enriches matching comics and strictly preserves existing creator, summary and date tags', async () => {
    const result = await batchTagger.startBatchTag({ publisher: 'Marvel Comics' });

    expect(result.ok).toBe(true);
    expect(result.updated).toBe(1);

    expect(mockSaveMetadata).toHaveBeenCalledWith(
      '/comics/Marvel/Civil War/Civil War 01.cbz',
      expect.objectContaining({
        // Story Arc Canon populated
        StoryArc: 'Civil War',
        StoryArcNumber: '1',
        SeriesGroup: 'Marvel Comics Events',
        // Existing metadata 100% preserved
        Title: 'Civil War #1',
        Series: 'Civil War',
        Number: '1',
        Writer: 'Mark Millar',
        Penciller: 'Steve McNiven',
        Summary: 'The battle begins.',
        Year: '2006',
        Characters: 'Iron Man, Captain America'
      })
    );

    // Database record updated
    expect(mockDbRun).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE comics SET metadata = ?'),
      expect.arrayContaining(['comic-marvel-1'])
    );
  });

  test('startBatchTag overrides outdated StoryArc tags with canonical database values (Option C)', async () => {
    const result = await batchTagger.startBatchTag({ publisher: 'DC Comics' });

    expect(result.ok).toBe(true);
    expect(result.updated).toBe(1);

    expect(mockSaveMetadata).toHaveBeenCalledWith(
      '/comics/DC/DC KO/01 DC K.O. - All Fight.cbz',
      expect.objectContaining({
        StoryArc: 'DC K.O.',
        StoryArcNumber: '1',
        SeriesGroup: 'DC Comics Events',
        // Existing creator and summary tags preserved
        Writer: 'Scott Snyder',
        Summary: 'Tournament commences.',
        Year: '2026'
      })
    );
  });

  test('startBatchTag skips comics that already have matching canonical StoryArc metadata (zero redundant writes)', async () => {
    // First run updates Marvel comic
    await batchTagger.startBatchTag({ publisher: 'Marvel Comics' });
    expect(mockSaveMetadata).toHaveBeenCalledTimes(1);

    // Second run with identical metadata
    mockSaveMetadata.mockClear();
    const result = await batchTagger.startBatchTag({ publisher: 'Marvel Comics' });

    expect(result.updated).toBe(0);
    expect(result.skipped).toBe(1);
    expect(mockSaveMetadata).not.toHaveBeenCalled();
  });

  test('cancelBatchTag stops an active run cleanly', async () => {
    expect(batchTagger.getStatus().isRunning).toBe(false);
    const cancelResult = batchTagger.cancelBatchTag();
    expect(cancelResult).toBe(true);
  });
});
