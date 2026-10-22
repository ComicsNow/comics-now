const http = require('http');
const { createApp } = require('../server');

describe('Standalone Character & Event Graph API (TDD)', () => {
  let app;
  let server;
  let baseUrl;

  beforeAll((done) => {
    const mockComics = [
      {
        id: 'c1',
        name: 'World\'s Finest #1',
        series: 'World\'s Finest',
        publisher: 'DC Comics',
        metadata: JSON.stringify({
          Characters: 'Batman, Superman, Robin',
          Teams: 'Justice League',
          Year: '2024'
        })
      },
      {
        id: 'c2',
        name: 'World\'s Finest #2',
        series: 'World\'s Finest',
        publisher: 'DC Comics',
        metadata: JSON.stringify({
          Characters: 'Batman, Superman',
          Teams: 'Justice League',
          Year: '2024'
        })
      },
      {
        id: 'c3',
        name: 'Detective Comics #1000',
        series: 'Detective Comics',
        publisher: 'DC Comics',
        metadata: JSON.stringify({
          Characters: 'Batman, Joker',
          Year: '2024'
        })
      }
    ];

    const mockDb = {
      prepare: (sql) => ({
        all: () => mockComics
      })
    };

    app = createApp({ db: mockDb });
    // Bind to ephemeral port
    server = app.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
      done();
    });
  });

  afterAll((done) => {
    if (server) {
      server.close(done);
    } else {
      done();
    }
  });

  async function getJson(path) {
    const res = await fetch(`${baseUrl}${path}`);
    const data = await res.json();
    return { status: res.status, data };
  }

  test('GET /api/health returns ok and port 3021', async () => {
    const { status, data } = await getJson('/api/health');
    expect(status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.port).toBe(3021);
  });

  test('GET /api/graph returns nodes and links with chronology and continuity friction', async () => {
    const { status, data } = await getJson('/api/graph?entityType=characters&minAppearances=1');
    expect(status).toBe(200);
    expect(data.ok).toBe(true);
    expect(Array.isArray(data.nodes)).toBe(true);
    expect(Array.isArray(data.links)).toBe(true);
    expect(data.nodes.some(n => n.id === 'Batman')).toBe(true);
    expect(data.nodes.some(n => n.id === 'Superman')).toBe(true);
    expect(data.meta.yearRange).toBeDefined();

    const batman = data.nodes.find(n => n.id === 'Batman');
    expect(batman.frictionScore).toBeDefined();
    expect(batman.frictionLevel).toBeDefined();
  });

  test('GET /api/entity/:name/details returns entity relationships and connected targets', async () => {
    const { status, data } = await getJson('/api/entity/Batman/details?entityType=characters');
    expect(status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.entity.id).toBe('Batman');
    expect(data.entity.appearances).toBe(3);
    expect(Array.isArray(data.connectedEntities)).toBe(true);
    expect(data.connectedEntities.some(c => c.target === 'Superman')).toBe(true);
    expect(data.connectedEntities.some(c => c.target === 'Joker')).toBe(true);
  });

  test('GET /api/publishers returns distinct publisher list', async () => {
    const { status, data } = await getJson('/api/publishers');
    expect(status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.publishers).toContain('DC Comics');
  });
});
