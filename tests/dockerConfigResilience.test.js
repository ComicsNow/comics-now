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

  test('Dockerfile uses docker-entrypoint.sh, runs node directly, and strips runtime npm', () => {
    const dockerfilePath = path.join(rootDir, 'Dockerfile');
    expect(fs.existsSync(dockerfilePath)).toBe(true);

    const content = fs.readFileSync(dockerfilePath, 'utf8');
    // Must install tagger requirements
    expect(content).toMatch(/tagger\/requirements\.txt/);
    // Must NOT install legacy comictagger
    expect(content).not.toMatch(/pip install.*comictagger/);
    // Must specify docker-entrypoint.sh
    expect(content).toContain('ENTRYPOINT ["/app/docker-entrypoint.sh"]');
    // Must run node directly in CMD for clean signal handling and no npm wrapper
    expect(content).toContain('CMD ["node", "server.js"]');
    // Must NOT install global npm in runtime stage
    expect(content).not.toMatch(/npm install -g npm/);
    // Must strip global npm/npx/corepack from runtime image
    expect(content).toMatch(/rm -rf.*\/usr\/local\/lib\/node_modules\/npm/);
  });

  test('docker-compose.yml configures standard data mount and DATA_DIR env', () => {
    const composePath = path.join(rootDir, 'docker-compose.yml');
    expect(fs.existsSync(composePath)).toBe(true);

    const content = fs.readFileSync(composePath, 'utf8');
    expect(content).toContain('./data:/app/data');
    expect(content).toContain('DATA_DIR=/app/data');
    expect(content).toContain('restart: unless-stopped');
  });

  test('Python requirements and Docker venv are hardened against CVEs', () => {
    const taggerReqPath = path.join(rootDir, 'tagger/requirements.txt');
    const modalReqPath = path.join(rootDir, 'scripts/requirements-modal.txt');
    const dockerfilePath = path.join(rootDir, 'Dockerfile');

    const taggerReq = fs.readFileSync(taggerReqPath, 'utf8');
    const modalReq = fs.readFileSync(modalReqPath, 'utf8');
    const dockerfile = fs.readFileSync(dockerfilePath, 'utf8');

    // urllib3 must be pinned to >=2.8.0 to resolve CVE-2026-97689, CVE-2026-97687, CVE-2026-97688
    expect(taggerReq).toMatch(/urllib3>=2\.8\.0/);
    expect(modalReq).toMatch(/urllib3>=2\.8\.0/);

    // msgpack must be pinned to >=1.2.1 to resolve GHSA-6v7p-g79w-8964 / CVE-2026-57585
    expect(modalReq).toMatch(/msgpack>=1\.2\.1/);

    // Dockerfile must prune setuptools/pip build tools from /opt/venv before runtime
    expect(dockerfile).toMatch(/pip uninstall -y.*setuptools/);
  });

  test('package.json specifies overrides to resolve transitive CVEs', () => {
    const pkgPath = path.join(rootDir, 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

    expect(pkg.overrides).toBeDefined();
    expect(pkg.overrides['ip-address']).toBe('>=10.7.4');
    expect(pkg.overrides['brace-expansion']).toBe('>=2.1.5');
    expect(pkg.overrides['picomatch']).toBe('>=4.0.7');
  });
});
