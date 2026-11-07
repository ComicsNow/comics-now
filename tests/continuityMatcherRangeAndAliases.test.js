const {
  isIssueInRange,
  normalizeSeries,
  createContinuityMatcher
} = require('../server/services/continuityMatcher');
const { initReadingOrdersDb } = require('../server/readingOrdersDb');

describe('Continuity Matcher: Range Matching & Series Aliases', () => {
  describe('isIssueInRange', () => {
    test('matches exact single issue number', () => {
      expect(isIssueInRange('1', '1')).toBe(true);
      expect(isIssueInRange('38', '38')).toBe(true);
      expect(isIssueInRange('01', '1')).toBe(true);
      expect(isIssueInRange('1', '01')).toBe(true);
      expect(isIssueInRange('2', '1')).toBe(false);
    });

    test('matches comic issue number within a range span', () => {
      expect(isIssueInRange('1', '1-5')).toBe(true);
      expect(isIssueInRange('2', '1-5')).toBe(true);
      expect(isIssueInRange('5', '1-5')).toBe(true);
      expect(isIssueInRange('03', '1-5')).toBe(true);
      expect(isIssueInRange('6', '1-5')).toBe(false);
      expect(isIssueInRange('0', '1-5')).toBe(false);
    });

    test('matches high-numbered range spans (e.g. Amazing Spider-Man 529-530)', () => {
      expect(isIssueInRange('529', '529-530')).toBe(true);
      expect(isIssueInRange('530', '529-530')).toBe(true);
      expect(isIssueInRange('528', '529-530')).toBe(false);
      expect(isIssueInRange('531', '529-530')).toBe(false);
    });

    test('handles invalid or empty inputs safely', () => {
      expect(isIssueInRange('', '1-5')).toBe(false);
      expect(isIssueInRange('abc', '1-5')).toBe(false);
      expect(isIssueInRange('1', '')).toBe(false);
      expect(isIssueInRange(null, undefined)).toBe(false);
    });
  });

  describe('normalizeSeries', () => {
    test('normalizes curly apostrophes to standard quotes', () => {
      expect(normalizeSeries("Batman/Superman: World’s Finest")).toBe(
        normalizeSeries("Batman/Superman: World's Finest")
      );
    });

    test('strips year indicators', () => {
      expect(normalizeSeries("Batman (2016)")).toBe("batman");
      expect(normalizeSeries("Action Comics (2024)")).toBe("action comics");
    });

    test('strips recognized event prefixes from tie-ins', () => {
      expect(normalizeSeries("DC K.O. Justice League Unlimited")).toBe("justice league unlimited");
      expect(normalizeSeries("DC K.O. Titans")).toBe("titans");
      expect(normalizeSeries("Civil War: Front Line")).toBe("front line");
    });

    test('normalizes slashes and hyphens', () => {
      expect(normalizeSeries("Batman/Superman: World's Finest")).toBe(
        normalizeSeries("Batman-Superman: World's Finest")
      );
    });
  });

  describe('findArcForIssue with Range & Normalized Series', () => {
    let readingDb;

    beforeEach(() => {
      readingDb = initReadingOrdersDb(':memory:');
      readingDb.upsertReadingOrder({
        id: 'test-arc',
        title: 'Test Story Arc',
        publisher: 'DC Comics'
      });
      readingDb.upsertIssues('test-arc', [
        {
          position: 1,
          seriesName: 'Justice League Unlimited',
          issueNumber: '1-5',
          importance: 'Recommended'
        },
        {
          position: 2,
          seriesName: "Batman/Superman: World's Finest",
          issueNumber: '38',
          importance: 'Essential'
        }
      ]);
    });

    test('matches comic with issue within range', () => {
      const match1 = readingDb.findArcForIssue('Justice League Unlimited', '1');
      expect(match1).not.toBeNull();
      expect(match1.readingOrderId).toBe('test-arc');
      expect(match1.position).toBe(1);

      const match3 = readingDb.findArcForIssue('Justice League Unlimited', '3');
      expect(match3).not.toBeNull();
      expect(match3.position).toBe(1);

      const match6 = readingDb.findArcForIssue('Justice League Unlimited', '6');
      expect(match6).toBeNull();
    });

    test('matches comic with event prefix in series name', () => {
      const match = readingDb.findArcForIssue('DC K.O. Justice League Unlimited', '2');
      expect(match).not.toBeNull();
      expect(match.position).toBe(1);
    });

    test('matches comic with delimiter and curly quote variance', () => {
      const match = readingDb.findArcForIssue('Batman-Superman: World’s Finest', '38');
      expect(match).not.toBeNull();
      expect(match.position).toBe(2);
    });
  });

  describe('findArcForCollection with Volumes, Deluxe & DC Finest', () => {
    let readingDb;

    beforeEach(() => {
      readingDb = initReadingOrdersDb(':memory:');
      readingDb.upsertReadingOrder({
        id: 'crisis-on-infinite-earths',
        title: 'Crisis on Infinite Earths',
        publisher: 'DC Comics'
      });
      readingDb.upsertCollections('crisis-on-infinite-earths', [
        {
          position: 1,
          title: 'Crisis on Infinite Earths',
          subtitle: '35th Anniversary Deluxe Edition',
          contentsRaw: 'Crisis on Infinite Earths #1-12'
        },
        {
          position: 4,
          title: 'Crisis on Infinite Earths Companion: Deluxe Edition: Volume 1',
          subtitle: '',
          contentsRaw: 'DC Comics Presents #78, All-Star Squadron #50-60'
        },
        {
          position: 11,
          title: 'DC Finest: Batman: Red Skies',
          subtitle: '',
          contentsRaw: 'Batman #386-400'
        }
      ]);
    });

    test('matches main Crisis Deluxe Edition to position 1', () => {
      const match = readingDb.findArcForCollection({
        series: 'Crisis On Infinite Earths: 35th Anniversary Deluxe Edition',
        name: '01 Crisis On Infinite Earths: 35th Anniversary Deluxe Edition - HC [DC Comics] (2019) #461.cbz'
      });
      expect(match).not.toBeNull();
      expect(match.readingOrderId).toBe('crisis-on-infinite-earths');
      expect(match.position).toBe(1);
    });

    test('matches Companion Volume 1 to position 4', () => {
      const match = readingDb.findArcForCollection({
        series: 'Crisis On Infinite Earths Companion Deluxe Edition',
        name: '01 Crisis On Infinite Earths Companion Deluxe Edition - Volume 1 [DC Comics] (2018) #506.cbz'
      });
      expect(match).not.toBeNull();
      expect(match.readingOrderId).toBe('crisis-on-infinite-earths');
      expect(match.position).toBe(4);
    });

    test('matches DC Finest volume to position 11', () => {
      const match = readingDb.findArcForCollection({
        series: 'DC Finest: Batman: Red Skies',
        name: '01 DC Finest: Batman: Red Skies - Batman Red Skies [DC Comics] (2025) #630.cbz'
      });
      expect(match).not.toBeNull();
      expect(match.readingOrderId).toBe('crisis-on-infinite-earths');
      expect(match.position).toBe(11);
    });

    test('does not match unrelated comic series', () => {
      const match = readingDb.findArcForCollection({
        series: 'Assorted Crisis Events',
        name: '01 Assorted Crisis Events - Volume 1 [Image] (2025) #160.cbz'
      });
      expect(match).toBeNull();
    });
  });
});
