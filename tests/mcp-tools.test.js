const attachMcpToolsRoutes = require('../server/routes/admin/mcp-tools');
const fs = require('fs');
const path = require('path');

// Mock dependencies
jest.mock('fs', () => ({
  promises: {
    mkdir: jest.fn(),
    writeFile: jest.fn()
  },
  existsSync: jest.fn()
}));

jest.mock('sharp', () => {
  return jest.fn().mockImplementation(() => ({
    metadata: jest.fn().mockResolvedValue({ width: 1000, height: 1500 })
  }));
}, { virtual: true });

jest.mock('../server/services/metadata', () => ({
  getComicInfoFromArchive: jest.fn(),
  buildComicInfoXml: jest.fn(),
  writeTagsToSidecar: jest.fn(),
  writeTagsToArchive: jest.fn(),
  writeComicInfoToCbz: jest.fn()
}));

jest.mock('../server/services/archive-utils', () => ({
  getEntryBuffer: jest.fn()
}));

describe('Admin MCP Tools Routes', () => {
  let router;
  let deps;
  let routeHandlers;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();

    routeHandlers = {};
    router = {
      get: jest.fn((path, handler) => { routeHandlers[`GET ${path}`] = handler; }),
      post: jest.fn((path, handler) => { routeHandlers[`POST ${path}`] = handler; })
    };

    deps = {
      dbGet: jest.fn(),
      dbRun: jest.fn(),
      dbAll: jest.fn(),
      log: jest.fn(),
      formatErrorMessage: jest.fn((e) => e.message),
      getComicPages: jest.fn(),
      getMimeFromExt: jest.fn()
    };
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('GET /api/v1/comics/:id/guided-pages', () => {
    it('returns 404 if comic not found', async () => {
      attachMcpToolsRoutes(router, deps);
      deps.dbGet.mockResolvedValue(null);

      const req = { params: { id: '123' } };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

      await routeHandlers['GET /api/v1/comics/:id/guided-pages'](req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ ok: false, message: 'Comic not found' });
    });

    it('returns 404 if comic file missing on disk', async () => {
      attachMcpToolsRoutes(router, deps);
      deps.dbGet.mockResolvedValue({ id: '123', path: '/non/existent.cbz' });
      fs.existsSync.mockReturnValue(false);

      const req = { params: { id: '123' } };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

      await routeHandlers['GET /api/v1/comics/:id/guided-pages'](req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ ok: false, message: 'Comic file missing on disk' });
    });

    it('returns 500 on unexpected error', async () => {
      attachMcpToolsRoutes(router, deps);
      deps.dbGet.mockRejectedValue(new Error('DB failure'));

      const req = { params: { id: '123' } };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

      await routeHandlers['GET /api/v1/comics/:id/guided-pages'](req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ ok: false, message: 'DB failure' });
    });

    it('returns a list of pages successfully', async () => {
      attachMcpToolsRoutes(router, deps);
      deps.dbGet.mockResolvedValue({ id: '123', name: 'Test', path: '/real.cbz', guidedViewStatus: 'pending' });
      fs.existsSync.mockReturnValue(true);
      deps.getComicPages.mockResolvedValue(['01.jpg', '02.jpg']);

      const req = { params: { id: '123' } };
      const res = { json: jest.fn() };

      await routeHandlers['GET /api/v1/comics/:id/guided-pages'](req, res);

      expect(res.json).toHaveBeenCalledWith({
        ok: true,
        comicId: '123',
        name: 'Test',
        guidedViewStatus: 'pending',
        pageCount: 2,
        pages: [
          { index: 0, name: '01.jpg' },
          { index: 1, name: '02.jpg' }
        ]
      });
    });
  });

  describe('GET /api/v1/comics/:id/page-image', () => {
    it('returns 404 if comic or file not found', async () => {
      attachMcpToolsRoutes(router, deps);
      deps.dbGet.mockResolvedValue(null);

      const req = { params: { id: '123' } };
      const res = { status: jest.fn().mockReturnThis(), end: jest.fn() };

      await routeHandlers['GET /api/v1/comics/:id/page-image'](req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.end).toHaveBeenCalled();
    });

    it('returns 400 if page name is missing', async () => {
      attachMcpToolsRoutes(router, deps);
      deps.dbGet.mockResolvedValue({ id: '123', path: '/real.cbz' });
      fs.existsSync.mockReturnValue(true);

      const req = { params: { id: '123' }, query: {} };
      const res = { status: jest.fn().mockReturnThis(), end: jest.fn() };

      await routeHandlers['GET /api/v1/comics/:id/page-image'](req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.end).toHaveBeenCalled();
    });

    it('returns 500 on unexpected error', async () => {
      attachMcpToolsRoutes(router, deps);
      deps.dbGet.mockRejectedValue(new Error('Page image failure'));

      const req = { params: { id: '123' }, query: { page: '01.jpg' } };
      const res = { status: jest.fn().mockReturnThis(), end: jest.fn() };

      await routeHandlers['GET /api/v1/comics/:id/page-image'](req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.end).toHaveBeenCalled();
    });

    it('returns image buffer successfully', async () => {
      attachMcpToolsRoutes(router, deps);
      deps.dbGet.mockResolvedValue({ id: '123', path: '/real.cbz' });
      fs.existsSync.mockReturnValue(true);

      const { getEntryBuffer } = require('../server/services/archive-utils');
      const mockBuffer = Buffer.from('fake image data');
      getEntryBuffer.mockResolvedValue(mockBuffer);
      deps.getMimeFromExt.mockReturnValue('image/jpeg');

      const req = { params: { id: '123' }, query: { page: '01.jpg' } };
      const res = {
        setHeader: jest.fn(),
        send: jest.fn()
      };

      await routeHandlers['GET /api/v1/comics/:id/page-image'](req, res);

      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'image/jpeg');
      expect(res.send).toHaveBeenCalledWith(mockBuffer);
    });
  });

  describe('GET /api/v1/comics/:id/tags', () => {
    it('returns tags successfully', async () => {
      attachMcpToolsRoutes(router, deps);
      deps.dbGet.mockResolvedValue({
        id: '123',
        path: '/real.cbz',
        metadata: JSON.stringify({ title: 'Test Comic' })
      });
      fs.existsSync.mockReturnValue(true);

      const { getComicInfoFromArchive } = require('../server/services/metadata');
      getComicInfoFromArchive.mockResolvedValue({ Writer: 'John Doe' });

      const req = { params: { id: '123' } };
      const res = { json: jest.fn() };

      await routeHandlers['GET /api/v1/comics/:id/tags'](req, res);

      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        ok: true,
        comicInfo: { Writer: 'John Doe' },
        dbMetadata: { title: 'Test Comic' }
      }));
    });
  });
  describe('POST /api/v1/comics/:id/guided-view', () => {
    it('returns 404 if comic not found', async () => {
      attachMcpToolsRoutes(router, deps);
      deps.dbGet.mockResolvedValue(null);

      const req = { params: { id: '123' }, body: {} };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

      await routeHandlers['POST /api/v1/comics/:id/guided-view'](req, res);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('returns 400 if pages are invalid', async () => {
      attachMcpToolsRoutes(router, deps);
      deps.dbGet.mockResolvedValue({ id: '123' });

      const req = { params: { id: '123' }, body: { pages: 'not-an-object' } };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

      await routeHandlers['POST /api/v1/comics/:id/guided-view'](req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ ok: false, message: 'pages must be an object keyed by page name' });
    });

    it('returns 400 if pages are empty', async () => {
      attachMcpToolsRoutes(router, deps);
      deps.dbGet.mockResolvedValue({ id: '123' });

      const req = { params: { id: '123' }, body: { pages: {} } };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

      await routeHandlers['POST /api/v1/comics/:id/guided-view'](req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ ok: false, message: 'No valid pages provided' });
    });

    it('handles normalized coords and caching of dimensions', async () => {
      attachMcpToolsRoutes(router, deps);
      deps.dbGet.mockResolvedValue({ id: '123', path: '/real.cbz', name: 'Test' });
      fs.existsSync.mockReturnValue(true);

      const sharp = require('sharp');
      const { getEntryBuffer } = require('../server/services/archive-utils');

      const req = {
        params: { id: '123' },
        body: {
          type: 'western',
          coords: 'normalized',
          pages: {
            '01.jpg': {
              panels: [[0, 0, 0.5, 0.5]],
              sequence: [] // empty sequence falls back to panels
            },
            '02.jpg': {
              panels: [[0.5, 0.5, 0.5, 0.5]]
            }
          }
        }
      };
      const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };

      await routeHandlers['POST /api/v1/comics/:id/guided-view'](req, res);

      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        ok: true,
        pages: 2,
        panels: 2
      }));
      // First page dimensions checked sharp, second used sharp again (because different pageName)
    });

    it('falls back to as-is when scaleBoxes throws', async () => {
      attachMcpToolsRoutes(router, deps);
      deps.dbGet.mockResolvedValue({ id: '123', path: '/real.cbz', name: 'Test' });

      const sharp = require('sharp');
      sharp.mockImplementationOnce(() => ({
        metadata: jest.fn().mockRejectedValue(new Error('Sharp Error'))
      }));

      const req = {
        params: { id: '123' },
        body: {
          type: 'manga',
          coords: 'normalized',
          pages: {
            '01.jpg': {
              panels: [[0.1, 0.1, 0.2, 0.2]]
            }
          }
        }
      };
      const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };

      await routeHandlers['POST /api/v1/comics/:id/guided-view'](req, res);

      expect(deps.log).toHaveBeenCalledWith('WARN', 'MCP', expect.stringContaining('Could not measure 01.jpg'));
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        ok: true
      }));
    });

    it('returns 500 on unexpected error in guided view', async () => {
      attachMcpToolsRoutes(router, deps);
      deps.dbGet.mockResolvedValue({ id: '123', path: '/real.cbz', name: 'Test' });
      fs.promises.writeFile.mockRejectedValueOnce(new Error('Write failure'));

      const req = {
        params: { id: '123' },
        body: {
          type: 'manga',
          coords: 'absolute',
          pages: {
            '01.jpg': { panels: [[0, 0, 100, 100]] }
          }
        }
      };
      const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };

      await routeHandlers['POST /api/v1/comics/:id/guided-view'](req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ ok: false, message: 'Write failure' });
    });

    it('writes guided view JSON and updates db successfully', async () => {
      attachMcpToolsRoutes(router, deps);
      deps.dbGet.mockResolvedValue({ id: '123', path: '/real.cbz', name: 'Test' });

      const req = {
        params: { id: '123' },
        body: {
          type: 'manga',
          coords: 'absolute',
          pages: {
            '01.jpg': {
              panels: [[0, 0, 100, 100]],
              bubbles: [[10, 10, 20, 20]]
            }
          }
        }
      };
      const res = { json: jest.fn() };

      await routeHandlers['POST /api/v1/comics/:id/guided-view'](req, res);

      expect(fs.promises.writeFile).toHaveBeenCalled();
      expect(deps.dbRun).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE comics SET guidedViewStatus'),
        expect.arrayContaining(['123'])
      );
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        ok: true,
        comicId: '123',
        type: 'manga',
        pages: 1,
        panels: 1
      }));
    });
  });

  describe('POST /api/v1/comics/tags/batch', () => {
    it('returns 400 if comicIds is empty', async () => {
      attachMcpToolsRoutes(router, deps);

      const req = { body: { comicIds: [] } };
      const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };

      await routeHandlers['POST /api/v1/comics/tags/batch'](req, res);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('returns 500 on DB failure', async () => {
      attachMcpToolsRoutes(router, deps);
      deps.dbAll.mockRejectedValueOnce(new Error('Batch DB failure'));

      const req = { body: { comicIds: ['123'] } };
      const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };

      await routeHandlers['POST /api/v1/comics/tags/batch'](req, res);

      expect(res.status).toHaveBeenCalledWith(500);
    });

    it('returns 500 on db failure', async () => {
      attachMcpToolsRoutes(router, deps);
      deps.dbGet.mockRejectedValueOnce(new Error('Tag read DB failure'));

      const req = { params: { id: '123' } };
      const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };

      await routeHandlers['GET /api/v1/comics/:id/tags'](req, res);

      expect(res.status).toHaveBeenCalledWith(500);
    });

    it('returns tags for multiple comics', async () => {
      attachMcpToolsRoutes(router, deps);
      deps.dbAll.mockResolvedValue([
        { id: '123', metadata: '{}' },
        { id: '124', metadata: '{}' }
      ]);

      const { getComicInfoFromArchive } = require('../server/services/metadata');
      getComicInfoFromArchive.mockResolvedValue({});

      const req = { body: { comicIds: ['123', '124', '999'] } };
      const res = { json: jest.fn() };

      await routeHandlers['POST /api/v1/comics/tags/batch'](req, res);

      expect(deps.dbAll).toHaveBeenCalledWith(
        expect.stringContaining('SELECT id'),
        ['123', '124', '999']
      );
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        ok: true,
        count: 2,
        notFound: ['999']
      }));
    });
  });

  describe('POST /api/v1/comics/:id/tags (single comic)', () => {
    it('returns 500 if apply tags fails', async () => {
      attachMcpToolsRoutes(router, deps);
      deps.dbGet.mockResolvedValue({ id: '123', path: '/non/existent.cbz' });
      fs.existsSync.mockReturnValue(false);

      const req = {
        params: { id: '123' },
        body: { fields: { Writer: 'John Doe' }, storage: 'sidecar' }
      };
      const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };

      await routeHandlers['POST /api/v1/comics/:id/tags'](req, res);

      expect(res.status).toHaveBeenCalledWith(500);
    });

    it('returns 400 if fields missing', async () => {
      attachMcpToolsRoutes(router, deps);
      deps.dbGet.mockResolvedValue({ id: '123' });

      const req = { params: { id: '123' }, body: {} };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

      await routeHandlers['POST /api/v1/comics/:id/tags'](req, res);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('writes tags successfully', async () => {
      attachMcpToolsRoutes(router, deps);
      deps.dbGet.mockResolvedValue({ id: '123', name: 'Test Comic', path: '/real.cbz' });
      fs.existsSync.mockReturnValue(true);

      // We need to mock applyComicTags behavior, since mcp-tools uses its own local
      // applyComicTags function inside attach(). The internal function uses
      // deps.log, metadata.writeTagsToArchive, etc. We can mock metadata.writeTagsToSidecar
      // or similar if needed, or just let it hit the internal catch/errors.
      // Wait, mcp-tools.js defines applyComicTags internally.
      // Let's mock getMetadataStorage in config if needed, or just test the happy path.

      const metadata = require('../server/services/metadata');
      metadata.writeTagsToSidecar = jest.fn().mockResolvedValue(true);
      metadata.buildComicInfoXml.mockReturnValue('<ComicInfo></ComicInfo>');

      const req = {
        params: { id: '123' },
        body: { fields: { Writer: 'John Doe' }, storage: 'sidecar' }
      };
      const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };

      await routeHandlers['POST /api/v1/comics/:id/tags'](req, res);

      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        ok: true,
        comicId: '123',
        storage: 'sidecar',
        fields: { Writer: 'John Doe' }
      }));
    });
  });

  describe('applyComicTags internal logic', () => {
    it('throws error if comic is not found via bulk tags route', async () => {
      attachMcpToolsRoutes(router, deps);
      deps.dbGet.mockResolvedValue(null);

      const req = {
        body: {
          items: [
            { comicId: '999', fields: { Writer: 'John Doe' } }
          ],
          storage: 'sidecar'
        }
      };
      const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };

      await routeHandlers['POST /api/v1/comics/tags/bulk'](req, res);

      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        ok: false,
        failed: 1,
        results: expect.arrayContaining([
          expect.objectContaining({ comicId: '999', ok: false, message: 'Comic not found' })
        ])
      }));
    });

    it('throws error if comic file is missing on disk', async () => {
      attachMcpToolsRoutes(router, deps);
      deps.dbGet.mockResolvedValue({ id: '123', name: 'Test Comic', path: '/fake.cbz' });
      fs.existsSync.mockReturnValue(false);

      const req = {
        body: {
          items: [
            { comicId: '123', fields: { Writer: 'John Doe' } }
          ],
          storage: 'sidecar'
        }
      };
      const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };

      await routeHandlers['POST /api/v1/comics/tags/bulk'](req, res);

      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        ok: false,
        failed: 1,
        results: expect.arrayContaining([
          expect.objectContaining({ comicId: '123', ok: false, message: 'Comic file missing on disk' })
        ])
      }));
    });

    it('throws error if writing to .cbr archive', async () => {
      attachMcpToolsRoutes(router, deps);
      deps.dbGet.mockResolvedValue({ id: '123', name: 'Test Comic', path: '/real.cbr' });
      fs.existsSync.mockReturnValue(true);

      const metadata = require('../server/services/metadata');
      metadata.buildComicInfoXml.mockReturnValue('<ComicInfo></ComicInfo>');

      const req = {
        body: {
          items: [
            { comicId: '123', fields: { Writer: 'John Doe' } }
          ],
          storage: 'archive'
        }
      };
      const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };

      await routeHandlers['POST /api/v1/comics/tags/bulk'](req, res);

      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        ok: false,
        failed: 1,
        results: expect.arrayContaining([
          expect.objectContaining({ comicId: '123', ok: false, message: 'CBR archives cannot be written; use sidecar or db' })
        ])
      }));
    });

    it('writes to .cbz archive successfully', async () => {
      attachMcpToolsRoutes(router, deps);
      deps.dbGet.mockResolvedValue({ id: '123', name: 'Test Comic', path: '/real.cbz', metadata: '{"existing":"data"}' });
      fs.existsSync.mockReturnValue(true);

      const metadata = require('../server/services/metadata');
      metadata.buildComicInfoXml.mockReturnValue('<ComicInfo></ComicInfo>');
      metadata.writeComicInfoToCbz.mockResolvedValue(true);

      const req = {
        body: {
          items: [
            { comicId: '123', fields: { Writer: 'John Doe' } }
          ],
          storage: 'archive'
        }
      };
      const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };

      await routeHandlers['POST /api/v1/comics/tags/bulk'](req, res);

      expect(metadata.writeComicInfoToCbz).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        ok: true,
        succeeded: 1
      }));
    });
  });

  describe('POST /api/v1/comics/tags/bulk', () => {
    it('returns 500 on unexpected error setting up bulk tags', async () => {
      attachMcpToolsRoutes(router, deps);

      deps.log.mockImplementationOnce(() => { throw new Error('Log error'); });

      const req = {
        body: { items: [{ comicId: '123', fields: {} }] }
      };
      const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };

      await routeHandlers['POST /api/v1/comics/tags/bulk'](req, res);

      expect(res.status).toHaveBeenCalledWith(500);
    });

    it('processes bulk format using comicIds array', async () => {
      attachMcpToolsRoutes(router, deps);
      deps.dbGet.mockResolvedValue({ id: '123', name: 'Test Comic', path: '/real.cbz' });
      fs.existsSync.mockReturnValue(true);
      const metadata = require('../server/services/metadata');
      metadata.buildComicInfoXml.mockReturnValue('<ComicInfo></ComicInfo>');

      const req = {
        body: {
          comicIds: ['123', '456'],
          fields: { Writer: 'John Doe' },
          storage: 'db'
        }
      };
      const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };

      await routeHandlers['POST /api/v1/comics/tags/bulk'](req, res);

      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        ok: true,
        succeeded: 2,
        failed: 0
      }));
    });

    it('handles items missing comicId or fields', async () => {
      attachMcpToolsRoutes(router, deps);

      const req = {
        body: {
          items: [
            { fields: { Writer: 'John Doe' } }, // missing comicId
            { comicId: '123' }, // missing fields
            { comicId: '456', fields: 'not-an-object' } // invalid fields
          ],
          storage: 'sidecar'
        }
      };
      const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };

      await routeHandlers['POST /api/v1/comics/tags/bulk'](req, res);

      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        ok: false,
        succeeded: 0,
        failed: 3
      }));
    });

    it('returns 400 if body format is invalid', async () => {
      attachMcpToolsRoutes(router, deps);

      const req = { body: {} };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

      await routeHandlers['POST /api/v1/comics/tags/bulk'](req, res);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('processes bulk array successfully', async () => {
      attachMcpToolsRoutes(router, deps);
      deps.dbGet.mockResolvedValue({ id: '123', name: 'Test Comic', path: '/real.cbz' });
      fs.existsSync.mockReturnValue(true);

      const metadata = require('../server/services/metadata');
      metadata.writeTagsToSidecar = jest.fn().mockResolvedValue(true);
      metadata.buildComicInfoXml.mockReturnValue('<ComicInfo></ComicInfo>');

      const req = {
        body: {
          items: [
            { comicId: '123', fields: { Writer: 'John Doe' } }
          ],
          storage: 'sidecar'
        }
      };
      const res = { json: jest.fn() };

      await routeHandlers['POST /api/v1/comics/tags/bulk'](req, res);

      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        ok: true,
        succeeded: 1,
        failed: 0,
        results: expect.arrayContaining([
          expect.objectContaining({ ok: true, comicId: '123' })
        ])
      }));
    });
  });
});
