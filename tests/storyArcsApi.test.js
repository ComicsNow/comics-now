/**
 * Story Arcs & Continuity API Tests
 */
const { initReadingOrdersDb } = require('../server/readingOrdersDb');
const { createContinuityMatcher } = require('../server/services/continuityMatcher');
const { createStoryArcsRouter } = require('../server/routes/storyArcs');

describe('Story Arcs & Continuity API', () => {
  let dbService;
  let matcher;
  let router;
  let routeHandlers;

  const mockLibraryComics = [
    {
      id: 'comic-1',
      publisher: 'Marvel Comics',
      series: 'Civil War',
      name: 'Civil War (2006) #1.cbz',
      metadata: JSON.stringify({ Series: 'Civil War', Number: '1', Year: '2006' })
    },
    {
      id: 'comic-2',
      publisher: 'Marvel Comics',
      series: 'Civil War',
      name: 'Civil War (2006) #2.cbz',
      metadata: JSON.stringify({ Series: 'Civil War', Number: '2', Year: '2006' })
    }
  ];

  beforeEach(() => {
    dbService = initReadingOrdersDb(':memory:');

    // Seed test reading order
    dbService.upsertReadingOrder({
      id: 'civil-war',
      title: 'Civil War',
      publisher: 'Marvel Comics',
      description: 'The landmark crossover event.',
      coverImage: 'https://readingorders.com/images/issues/4228.png'
    });

    dbService.upsertIssues('civil-war', [
      {
        position: 1,
        seriesName: 'Civil War',
        issueNumber: '1',
        importance: 'Essential',
        storyParts: 'Part 1',
        publicationDate: 'May 2006'
      },
      {
        position: 2,
        seriesName: 'Civil War: Front Line',
        issueNumber: '1',
        importance: 'Tie-In',
        storyParts: 'Embedded: Part 1',
        publicationDate: 'May 2006'
      },
      {
        position: 3,
        seriesName: 'Civil War',
        issueNumber: '2',
        importance: 'Essential',
        storyParts: 'Part 2',
        publicationDate: 'Jun 2006'
      }
    ]);

    matcher = createContinuityMatcher({
      readingOrdersDb: dbService,
      getComics: () => mockLibraryComics
    });

    routeHandlers = {};
    router = {
      get: jest.fn((routePath, handler) => {
        routeHandlers[routePath] = handler;
      })
    };

    createStoryArcsRouter(router, { continuityMatcher: matcher });
  });

  afterEach(() => {
    if (dbService && dbService.db) {
      dbService.db.close();
    }
  });

  describe('GET /', () => {
    it('returns story arcs for a publisher with library completeness', async () => {
      const handler = routeHandlers['/'];
      expect(handler).toBeDefined();

      const req = { query: { publisher: 'Marvel Comics' } };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn()
      };

      await handler(req, res);

      expect(res.json).toHaveBeenCalled();
      const body = res.json.mock.calls[0][0];
      expect(body.ok).toBe(true);
      expect(body.storyArcs).toHaveLength(1);

      const arc = body.storyArcs[0];
      expect(arc.id).toBe('civil-war');
      expect(arc.title).toBe('Civil War');
      expect(arc.totalIssues).toBe(3);
      expect(arc.ownedCount).toBe(2);
      expect(arc.missingCount).toBe(1);
      expect(arc.completenessPercent).toBe(67);
    });
  });

  describe('GET /:arcId', () => {
    it('returns full arc details with issue owned status and gaps', async () => {
      const handler = routeHandlers['/:arcId'];
      expect(handler).toBeDefined();

      const req = { params: { arcId: 'civil-war' } };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn()
      };

      await handler(req, res);

      expect(res.json).toHaveBeenCalled();
      const body = res.json.mock.calls[0][0];
      expect(body.ok).toBe(true);
      expect(body.storyArc.issues).toHaveLength(3);

      const issues = body.storyArc.issues;
      expect(issues[0].isOwned).toBe(true);
      expect(issues[0].comicId).toBe('comic-1');
      expect(issues[1].isOwned).toBe(false); // Front Line #1 is missing
      expect(issues[1].comicId).toBeNull();
      expect(issues[2].isOwned).toBe(true);
      expect(issues[2].comicId).toBe('comic-2');
    });
  });

  describe('Continuity Matcher', () => {
    it('computes contextual continuity for an owned issue', async () => {
      const continuity = await matcher.getComicContinuity('Civil War', '1');
      expect(continuity).toBeDefined();
      expect(continuity.arcTitle).toBe('Civil War');
      expect(continuity.position).toBe(1);
      expect(continuity.nextIssue).toBeDefined();
      expect(continuity.nextIssue.seriesName).toBe('Civil War: Front Line');
      expect(continuity.nextIssue.issueNumber).toBe('1');
      expect(continuity.nextIssue.isOwned).toBe(false);
    });

    it('generates standard ComicInfo XML tags for an issue', () => {
      const xmlMeta = matcher.getComicInfoMetadata('Civil War', '1');
      expect(xmlMeta).toEqual({
        StoryArc: 'Civil War',
        StoryArcNumber: '1',
        SeriesGroup: 'Marvel Comics Events'
      });
    });
  });
});
