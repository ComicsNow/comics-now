const fs = require('fs');
const path = require('path');

describe('Docker Configuration & Deployment Resilience', () => {
  const rootDir = path.resolve(__dirname, '..');

  test('docker-entrypoint.sh exists and is properly configured', () => {
    const entrypointPath = path.join(rootDir, 'docker-entrypoint.sh');
    expect(fs.existsSync(entrypointPath)).toBe(true);

    const content = fs.readFileSync(entrypointPath, 'utf8');
    // Must handle DATA_DIR fallback
    expect(content).toContain('DATA_DIR=');
    // Must check root privilege before dropping permissions
    expect(content).toContain('id -u');
    // Must switch to node user cleanly
    expect(content).toContain('node');
  });

  test('Dockerfile uses docker-entrypoint.sh and installs python tagger dependencies', () => {
    const dockerfilePath = path.join(rootDir, 'Dockerfile');
    expect(fs.existsSync(dockerfilePath)).toBe(true);

    const content = fs.readFileSync(dockerfilePath, 'utf8');
    // Must install tagger requirements
    expect(content).toMatch(/tagger\/requirements\.txt/);
    // Must NOT install legacy comictagger
    expect(content).not.toMatch(/pip install.*comictagger/);
    // Must specify docker-entrypoint.sh
    expect(content).toContain('ENTRYPOINT ["/app/docker-entrypoint.sh"]');
  });

  test('docker-compose.yml configures standard data mount and DATA_DIR env', () => {
    const composePath = path.join(rootDir, 'docker-compose.yml');
    expect(fs.existsSync(composePath)).toBe(true);

    const content = fs.readFileSync(composePath, 'utf8');
    expect(content).toContain('./data:/app/data');
    expect(content).toContain('DATA_DIR=/app/data');
    expect(content).toContain('restart: unless-stopped');
  });
});
