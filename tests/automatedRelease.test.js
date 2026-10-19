const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const {
  determineBump,
  calculateNextVersion,
  generateChangelog,
} = require('../scripts/release');

describe('Automated CI/CD Release & SemVer Logic', () => {
  describe('determineBump()', () => {
    test('detects major bump from BREAKING CHANGE in commit message', () => {
      const commits = [
        'feat: add standard viewer',
        'feat!: overhaul database architecture with breaking change',
      ];
      expect(determineBump(commits)).toBe('major');
    });

    test('detects major bump from feat! syntax', () => {
      const commits = [
        'fix: minor styling issue',
        'feat!(modal): migrate GPU pipeline',
      ];
      expect(determineBump(commits)).toBe('major');
    });

    test('detects minor bump when feat is present and no breaking changes', () => {
      const commits = [
        'fix(viewer): fix zoom level',
        'feat(dag): add reading list DAG view',
        'docs: update manual',
      ];
      expect(determineBump(commits)).toBe('minor');
    });

    test('detects patch bump when only fixes or security commits are present', () => {
      const commits = [
        'fix: sanitize reading list import',
        'security: enforce LAN-safe SSRF check',
      ];
      expect(determineBump(commits)).toBe('patch');
    });

    test('returns null when only chore/docs/test commits are present', () => {
      const commits = [
        'chore: update dependencies',
        'docs: update readme',
        'test: add unit tests',
      ];
      expect(determineBump(commits)).toBeNull();
    });

    test('honors manual override when provided', () => {
      const commits = ['fix: quick typo'];
      expect(determineBump(commits, 'major')).toBe('major');
      expect(determineBump(commits, 'minor')).toBe('minor');
      expect(determineBump(commits, 'patch')).toBe('patch');
    });
  });

  describe('calculateNextVersion()', () => {
    test('increments major correctly', () => {
      expect(calculateNextVersion('1.3.3', 'major')).toBe('2.0.0');
    });

    test('increments minor correctly', () => {
      expect(calculateNextVersion('1.3.3', 'minor')).toBe('1.4.0');
    });

    test('increments patch correctly', () => {
      expect(calculateNextVersion('1.3.3', 'patch')).toBe('1.3.4');
    });

    test('accepts explicit semver string as override', () => {
      expect(calculateNextVersion('1.3.3', '2.0.0')).toBe('2.0.0');
    });
  });

  describe('generateChangelog()', () => {
    test('categorizes commits into Features, Bug Fixes, Security, and Maintenance', () => {
      const commits = [
        'feat(dag): interactive DAG view',
        'fix(viewer): fix scrubber layout',
        'security: patch SSRF in cover fetch',
        'chore(deps): update sharp',
      ];
      const changelog = generateChangelog(commits);
      expect(changelog).toContain('### Features');
      expect(changelog).toContain('interactive DAG view');
      expect(changelog).toContain('### Bug Fixes');
      expect(changelog).toContain('fix scrubber layout');
      expect(changelog).toContain('### Security');
      expect(changelog).toContain('patch SSRF in cover fetch');
    });
  });

  describe('Unified CI/CD Workflow Specification', () => {
    const rootDir = path.resolve(__dirname, '..');
    const wfPath = path.join(rootDir, '.github/workflows/docker-publish.yml');
    const npmWfPath = path.join(rootDir, '.github/workflows/npm-publish.yml');

    test('redundant standalone npm-publish.yml workflow is removed', () => {
      expect(fs.existsSync(npmWfPath)).toBe(false);
    });

    test('unified workflow gates both Docker and npm publishing with the single test job', () => {
      const wf = yaml.load(fs.readFileSync(wfPath, 'utf8'));
      expect(wf.jobs.test).toBeDefined();

      // Docker publish must depend on test
      const dockerJob = wf.jobs['build-and-push-image'];
      expect(dockerJob).toBeDefined();
      const dockerNeeds = Array.isArray(dockerJob.needs) ? dockerJob.needs : [dockerJob.needs];
      expect(dockerNeeds).toContain('test');

      // npm publish must also be part of the unified workflow and depend on test
      const npmJob = wf.jobs['publish-npm'];
      expect(npmJob).toBeDefined();
      const npmNeeds = Array.isArray(npmJob.needs) ? npmJob.needs : [npmJob.needs];
      expect(npmNeeds).toContain('test');

      // npm publish must NOT duplicate the test suite step
      const npmSteps = npmJob.steps || [];
      const hasDuplicateTestStep = npmSteps.some((s) => /npm test|jest/.test(s.run || ''));
      expect(hasDuplicateTestStep).toBe(false);
    });
  });
});
