/**
 * Frontend-Backend API Route Contract Integrity Test
 * Automatically validates that any /api/v1/... endpoint invoked in frontend files
 * exists and is registered in the backend Express createApiRouter table.
 * Prevents phantom endpoint 404s falling back to HTML index.html.
 */
const fs = require('fs');
const path = require('path');
const { createApiRouter } = require('../server/routes');

describe('Frontend API Route Contract Integrity', () => {
  let registeredRoutes = new Set();

  beforeAll(() => {
    const mockDeps = {
      log: jest.fn(),
      dbAll: () => [],
      dbGet: () => null,
      dbRun: () => ({ changes: 0 }),
      requireAuth: (req, res, next) => next(),
      requireAdmin: (req, res, next) => next(),
      isAuthEnabled: () => false,
      config: {
        readingOrdersIntervalDays: 7,
        readingOrdersMode: 'both'
      }
    };

    const router = createApiRouter(mockDeps);

    function collectRoutes(layer) {
      if (layer.route && layer.route.path) {
        const methods = Object.keys(layer.route.methods || {});
        for (const m of methods) {
          registeredRoutes.add(`${m.toUpperCase()} ${layer.route.path}`);
        }
      } else if (layer.name === 'router' && layer.handle && layer.handle.stack) {
        for (const sub of layer.handle.stack) {
          collectRoutes(sub);
        }
      }
    }

    for (const l of router.stack) {
      collectRoutes(l);
    }
  });

  test('Story Arcs frontend (/public/js/settings/story-arcs-tab.js) calls only registered backend endpoints', () => {
    const filePath = path.join(__dirname, '../public/js/settings/story-arcs-tab.js');
    const content = fs.readFileSync(filePath, 'utf8');

    // Extract fetch calls like fetch(`${...}/api/v1/...`, { method: 'POST' })
    const fetchMatches = [...content.matchAll(/fetch\s*\(\s*`?\${?[^`]*?}?(\/api\/v1\/[^`"'\s?]+)[^)]*\)/g)];
    expect(fetchMatches.length).toBeGreaterThan(0);

    for (const match of fetchMatches) {
      const fullCall = match[0];
      const routePath = match[1];

      // Determine HTTP method from fetch call
      let method = 'GET';
      if (/method:\s*['"]POST['"]/i.test(fullCall)) method = 'POST';
      else if (/method:\s*['"]DELETE['"]/i.test(fullCall)) method = 'DELETE';
      else if (/method:\s*['"]PUT['"]/i.test(fullCall)) method = 'PUT';

      const key = `${method} ${routePath}`;
      expect(registeredRoutes.has(key)).toBe(true);
    }
  });

  test('Story Arcs Batch Tagger frontend (/public/js/settings/story-arcs-batch-tagger.js) calls only registered backend endpoints', () => {
    const filePath = path.join(__dirname, '../public/js/settings/story-arcs-batch-tagger.js');
    const content = fs.readFileSync(filePath, 'utf8');

    const fetchMatches = [...content.matchAll(/fetch\s*\(\s*`?\${?[^`]*?}?(\/api\/v1\/[^`"'\s?]+)[^)]*\)/g)];
    expect(fetchMatches.length).toBeGreaterThan(0);

    for (const match of fetchMatches) {
      const fullCall = match[0];
      const routePath = match[1];

      let method = 'GET';
      if (/method:\s*['"]POST['"]/i.test(fullCall)) method = 'POST';
      else if (/method:\s*['"]DELETE['"]/i.test(fullCall)) method = 'DELETE';
      else if (/method:\s*['"]PUT['"]/i.test(fullCall)) method = 'PUT';

      const key = `${method} ${routePath}`;
      expect(registeredRoutes.has(key)).toBe(true);
    }
  });
});
