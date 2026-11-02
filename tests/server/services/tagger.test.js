const { buildTaggedDbMeta, resolveVolumeAndSeries } = require('../../../server/services/tagger/persist');
const { resolveScanMode, SCAN_MODES } = require('../../../server/services/tagger/gates');
const { formatDuration } = require('../../../server/services/tagger/engine-client');
const { getPendingMatch, clearReviewState, buildReviewState } = require('../../../server/services/tagger/review');
const { isTaggerRunning, cancelComicTagger } = require('../../../server/services/tagger/runner');

describe('Tagger Submodules - Unit & Health Verification', () => {
  beforeEach(() => {
    clearReviewState(false);
  });

  describe('persist.js', () => {
    test('buildTaggedDbMeta creates clean object dropping empty fields', () => {
      const info = {
        Writer: 'Grant Morrison',
        Penciller: 'Frank Quitely',
        Summary: 'All-Star Superman run',
        Genre: '',
        Characters: 'Superman, Lois Lane'
      };
      const overrides = {
        title: 'Faster Than a Speeding Bullet',
        series: 'All-Star Superman',
        number: '1',
        publisher: 'DC Comics'
      };

      const result = buildTaggedDbMeta(info, overrides);
      expect(result.Title).toBe('Faster Than a Speeding Bullet');
      expect(result.Series).toBe('All-Star Superman');
      expect(result.Writer).toBe('Grant Morrison');
      expect(result.Penciller).toBe('Frank Quitely');
      expect(result.Characters).toBe('Superman, Lois Lane');
      expect(result.Genre).toBeUndefined();
      expect(result.Imprint).toBeUndefined();
    });

    test('resolveVolumeAndSeries parses volume and series correctly', () => {
      const split = resolveVolumeAndSeries('Batman', 'City of Owls', '1', '2');
      expect(split.series).toBe('Batman');
      expect(split.title).toBe('City of Owls');
      expect(split.number).toBe('1');
      expect(split.volume).toBe('2');
    });
  });

  describe('gates.js', () => {
    test('SCAN_MODES contains expected options', () => {
      expect(SCAN_MODES).toEqual(['default', 'unmatched', 'existing-xml', 'force']);
    });

    test('resolveScanMode prioritizes explicit mode parameter', () => {
      expect(resolveScanMode({ mode: 'unmatched' })).toBe('unmatched');
      expect(resolveScanMode({ mode: 'force' })).toBe('force');
      expect(resolveScanMode({ mode: 'existing-xml' })).toBe('existing-xml');
      expect(resolveScanMode({ force: true })).toBe('force');
      expect(resolveScanMode({ force: false })).toBe('default');
    });
  });

  describe('engine-client.js', () => {
    test('formatDuration formats milliseconds into human-readable duration strings', () => {
      expect(formatDuration(0)).toBe('< 1s');
      expect(formatDuration(-100)).toBe('< 1s');
      expect(formatDuration(45000)).toBe('45s');
      expect(formatDuration(65000)).toBe('1m 05s');
      expect(formatDuration(125000)).toBe('2m 05s');
    });
  });

  describe('review.js', () => {
    test('buildReviewState initializes pending match and handles review candidates', () => {
      const candidates = [
        {
          score: 85,
          source: 'comicvine',
          metadata: {
            title: 'Action Comics #1',
            publisher: 'DC Comics',
            publish_date: '1938-06-01',
            number: '1',
            cover_image_url: 'https://example.com/cover1.jpg'
          }
        }
      ];

      const state = buildReviewState('Action Comics 001.cbz', '/comics/Action Comics 001.cbz', candidates);
      expect(state.fileName).toBe('Action Comics 001.cbz');
      expect(state.matches.length).toBe(1);
      expect(state.matches[0].title).toBe('Action Comics #1');
      expect(state.matches[0].publisher).toBe('DC Comics');
      expect(state.waitingForResponse).toBe(true);
      expect(getPendingMatch()).toBe(state);

      clearReviewState(false);
      expect(getPendingMatch()).toBeNull();
    });
  });

  describe('runner.js', () => {
    test('cancelComicTagger returns false if tagger is not running', () => {
      expect(isTaggerRunning()).toBe(false);
      expect(cancelComicTagger()).toBe(false);
    });
  });
});
