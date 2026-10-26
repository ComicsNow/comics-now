const { runComicTagger } = require('./server/services/tagger');
const db = require('./server/db');
const fs = require('fs');
const path = require('path');

async function setup() {
  const dir = './test_comics';
  if (!fs.existsSync(dir)) fs.mkdirSync(dir);
  for (let i = 0; i < 2000; i++) {
    fs.writeFileSync(path.join(dir, `comic_${i}.cbz`), 'dummy content');
  }

  // Mock config
  jest.mock('./server/config', () => ({
    getConfig: () => ({ comicsLocation: './test_comics', allowed_formats: 'cbz' }),
    getTaggerServiceUrl: () => 'http://127.0.0.1:5000',
    getTaggerForceReprocess: () => false,
  }));
}

// ... wait, it's easier to just run a quick manual script mocking what's needed.
