const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

// Issue #8: the Docker image was published to GHCR/Docker Hub on every push to
// main with no test step, so a commit that breaks the suite shipped as the image
// people pull. The publish job must depend on a job that runs `npm ci && npm test`.
describe('docker-publish workflow is gated by tests (Issue #8)', () => {
  const wf = yaml.load(
    fs.readFileSync(path.resolve(__dirname, '../.github/workflows/docker-publish.yml'), 'utf8')
  );

  test('defines a test job that installs deps and runs the suite', () => {
    const jobs = wf.jobs || {};
    const runsTests = Object.values(jobs).some((job) => {
      const steps = job.steps || [];
      const cmds = steps.map((s) => s.run || '').join('\n');
      return /npm ci/.test(cmds) && /npm test|jest/.test(cmds);
    });
    expect(runsTests).toBe(true);
  });

  test('the publish job depends on the test job (needs:)', () => {
    const publish = wf.jobs['build-and-push-image'];
    expect(publish).toBeDefined();
    const needs = Array.isArray(publish.needs) ? publish.needs : [publish.needs];

    // The dependency must be a real job that runs the test suite.
    const testJobNames = Object.entries(wf.jobs)
      .filter(([, job]) => {
        const cmds = (job.steps || []).map((s) => s.run || '').join('\n');
        return /npm ci/.test(cmds) && /npm test|jest/.test(cmds);
      })
      .map(([name]) => name);

    expect(needs.some((n) => testJobNames.includes(n))).toBe(true);
  });

  test('tests also run on pull requests, but the image is never published for a PR', () => {
    // js-yaml parses the YAML `on:` key as boolean true, so read it defensively.
    const on = wf.on || wf[true];
    expect(on.pull_request).toBeDefined();

    const publish = wf.jobs['build-and-push-image'];
    expect(String(publish.if)).toMatch(/pull_request/);
  });
});
