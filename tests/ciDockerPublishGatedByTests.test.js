const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

// Tests are executed locally via `npm test` (including inside `scripts/release.js`)
// before any release tag is created or pushed. GitHub Actions CI/CD workflows run
// build and publish jobs directly without a redundant CI test job.
describe('CI/CD publish workflows run directly without redundant CI test jobs', () => {
  const dockerWf = yaml.load(
    fs.readFileSync(path.resolve(__dirname, '../.github/workflows/docker-publish.yml'), 'utf8')
  );
  const npmWf = yaml.load(
    fs.readFileSync(path.resolve(__dirname, '../.github/workflows/npm-publish.yml'), 'utf8')
  );

  test('docker-publish workflow defines build-and-push-image without a CI test job', () => {
    const jobs = dockerWf.jobs || {};
    expect(jobs.test).toBeUndefined();
    const publish = jobs['build-and-push-image'];
    expect(publish).toBeDefined();
    expect(publish.needs).toBeUndefined();
  });

  test('npm-publish workflow defines publish-npm without a CI test job', () => {
    const jobs = npmWf.jobs || {};
    expect(jobs.test).toBeUndefined();
    const publish = jobs['publish-npm'];
    expect(publish).toBeDefined();
    expect(publish.needs).toBeUndefined();
  });

  test('scripts/release.js gates releases locally by running npm test before bumping or pushing', () => {
    const releaseScript = fs.readFileSync(
      path.resolve(__dirname, '../scripts/release.js'),
      'utf8'
    );
    expect(releaseScript).toMatch(/npm test/);
  });
});
