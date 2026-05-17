const { createApiRouter } = require('../server/routes');

describe('Server Initialization', () => {
  test('should load all routes without syntax errors', () => {
    // Mock dependencies needed by createApiRouter
    const mockDeps = {
      log: jest.fn(),
      getComicsDirectories: jest.fn(() => []),
      getPathFromLibraryId: jest.fn(),
      getLibraryIdFromPath: jest.fn(),
      requireAuth: jest.fn(),
      requireAdmin: jest.fn()
    };

    expect(() => {
      createApiRouter(mockDeps);
    }).not.toThrow();
  });
});
