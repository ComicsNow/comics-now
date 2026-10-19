#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

/**
 * Determines SemVer bump type from commit history or manual override.
 * @param {string[]} commits - List of commit subject lines.
 * @param {string} [manualOverride] - Optional manual override ('major', 'minor', 'patch').
 * @returns {'major'|'minor'|'patch'|null}
 */
function determineBump(commits = [], manualOverride = null) {
  if (['major', 'minor', 'patch'].includes(manualOverride)) {
    return manualOverride;
  }

  let hasBreaking = false;
  let hasFeature = false;
  let hasFixOrSec = false;

  for (const commit of commits) {
    const trimmed = commit.trim();
    if (!trimmed) continue;

    // Check for breaking changes
    if (
      /BREAKING CHANGE/i.test(trimmed) ||
      /^(\w+)!(\([^)]+\))?:/i.test(trimmed) ||
      /^feat!/i.test(trimmed) ||
      /^fix!/i.test(trimmed) ||
      /^major:/i.test(trimmed)
    ) {
      hasBreaking = true;
      break;
    }

    // Check for features
    if (/^feat(\([^)]+\))?:/i.test(trimmed) || /^minor:/i.test(trimmed)) {
      hasFeature = true;
      continue;
    }

    // Check for fixes, security, perf, or refactoring
    if (/^(fix|security|perf|refactor)(\([^)]+\))?:/i.test(trimmed) || /^patch:/i.test(trimmed)) {
      hasFixOrSec = true;
      continue;
    }
  }

  if (hasBreaking) return 'major';
  if (hasFeature) return 'minor';
  if (hasFixOrSec) return 'patch';
  return null;
}

/**
 * Calculates next SemVer version string.
 * @param {string} currentVersion - e.g. "1.3.3"
 * @param {'major'|'minor'|'patch'|string} bump - Bump type or exact version
 * @returns {string}
 */
function calculateNextVersion(currentVersion, bump) {
  if (/^\d+\.\d+\.\d+.*$/.test(bump)) {
    return bump;
  }

  const parts = currentVersion.split('.').map(Number);
  const [major, minor, patch] = parts;

  switch (bump) {
    case 'major':
      return `${major + 1}.0.0`;
    case 'minor':
      return `${major}.${minor + 1}.0`;
    case 'patch':
      return `${major}.${minor}.${patch + 1}`;
    default:
      throw new Error(`Invalid bump type: ${bump}`);
  }
}

/**
 * Generates formatted markdown changelog grouped by commit type.
 * @param {string[]} commits - List of commit messages.
 * @returns {string}
 */
function generateChangelog(commits = []) {
  const sections = {
    features: [],
    fixes: [],
    security: [],
    other: [],
  };

  for (const raw of commits) {
    const commit = raw.trim();
    if (!commit) continue;

    if (/^feat(\([^)]+\))?!?:/i.test(commit)) {
      sections.features.push(commit);
    } else if (/^fix(\([^)]+\))?!?:/i.test(commit)) {
      sections.fixes.push(commit);
    } else if (/^security(\([^)]+\))?:/i.test(commit)) {
      sections.security.push(commit);
    } else {
      sections.other.push(commit);
    }
  }

  const output = [];

  if (sections.features.length) {
    output.push('### Features\n' + sections.features.map((c) => `- ${c}`).join('\n'));
  }
  if (sections.fixes.length) {
    output.push('### Bug Fixes\n' + sections.fixes.map((c) => `- ${c}`).join('\n'));
  }
  if (sections.security.length) {
    output.push('### Security\n' + sections.security.map((c) => `- ${c}`).join('\n'));
  }
  if (sections.other.length && !sections.features.length && !sections.fixes.length) {
    output.push('### Maintenance & Other Changes\n' + sections.other.map((c) => `- ${c}`).join('\n'));
  }

  return output.join('\n\n');
}

/**
 * CLI Entrypoint
 */
function main() {
  const rootDir = path.resolve(__dirname, '..');
  const manualArg = process.argv[2] ? process.argv[2].toLowerCase() : null;

  console.log('\n🚀 Comics Now! Automated Release Assistant');
  console.log('============================================\n');

  // Verify git branch
  const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: rootDir }).toString().trim();
  if (branch !== 'main') {
    console.error(`❌ Releases must be cut from the 'main' branch. Current branch: ${branch}`);
    process.exit(1);
  }

  // Find latest release tag
  let lastTag = '';
  try {
    lastTag = execSync('git describe --tags --abbrev=0', { cwd: rootDir }).toString().trim();
  } catch {
    lastTag = '';
  }

  console.log(`📌 Latest Git Tag: ${lastTag || '(None found)'}`);

  // Get commits since last tag
  const gitLogCmd = lastTag ? `git log ${lastTag}..HEAD --oneline` : 'git log -n 50 --oneline';
  const rawCommits = execSync(gitLogCmd, { cwd: rootDir }).toString().trim();
  const commits = rawCommits ? rawCommits.split('\n').map((line) => line.replace(/^[a-f0-9]+\s+/, '')) : [];

  console.log(`📝 Detected ${commits.length} commits since ${lastTag || 'initial commit'}.`);

  // Read current package.json
  const pkgPath = path.join(rootDir, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const currentVersion = pkg.version;
  console.log(`📦 Current package.json Version: ${currentVersion}`);

  // Determine bump
  const bump = determineBump(commits, manualArg);
  if (!bump) {
    console.log('ℹ️ No releasable changes (feat, fix, security, breaking) detected.');
    if (!manualArg) {
      console.log('To force a release, run: node scripts/release.js <major|minor|patch|version>');
      process.exit(0);
    }
  }

  const nextVersion = calculateNextVersion(currentVersion, bump);
  console.log(`✨ Target Release Version: v${nextVersion} (Bump: ${bump})`);

  // Run test suite before releasing
  console.log('\n🧪 Running test suite verification...');
  try {
    execSync('npm test', { cwd: rootDir, stdio: 'inherit' });
    console.log('✅ All tests passed!\n');
  } catch (err) {
    console.error('❌ Test suite failed. Release aborted.');
    process.exit(1);
  }

  // Bump version files
  console.log(`📝 Bumping package.json & package-lock.json to ${nextVersion}...`);
  execSync(`npm --no-git-tag-version version ${nextVersion}`, { cwd: rootDir, stdio: 'inherit' });

  // Commit version bump
  console.log('💾 Committing version bump...');
  execSync('git add package.json package-lock.json', { cwd: rootDir });
  execSync(
    `git commit -m "chore(release): ${nextVersion}" --author="comicsnow <comicsnowdev@gmail.com>"`,
    { cwd: rootDir, stdio: 'inherit' }
  );

  // Create git tag
  const tagName = `v${nextVersion}`;
  console.log(`🏷️ Creating tag ${tagName}...`);
  execSync(`git tag -a "${tagName}" -m "Release ${tagName}"`, { cwd: rootDir });

  // Push to origin
  console.log('📤 Pushing main and release tag to GitHub...');
  execSync(`git push origin main && git push origin ${tagName}`, { cwd: rootDir, stdio: 'inherit' });

  // Create GitHub Release
  console.log('🎉 Creating GitHub Release...');
  const releaseNotesPath = path.join(rootDir, 'RELEASE_NOTES.md');
  let releaseCmd = `gh release create "${tagName}" --title "${tagName} - Comics Now! ${nextVersion}"`;

  if (fs.existsSync(releaseNotesPath)) {
    releaseCmd += ` --notes-file "${releaseNotesPath}"`;
  } else {
    const changelog = generateChangelog(commits);
    const changelogPath = path.join(rootDir, '.temp_changelog.md');
    fs.writeFileSync(changelogPath, changelog || `Release ${tagName}`);
    releaseCmd += ` --notes-file "${changelogPath}"`;
  }

  try {
    execSync(releaseCmd, { cwd: rootDir, stdio: 'inherit' });
    const changelogPath = path.join(rootDir, '.temp_changelog.md');
    if (fs.existsSync(changelogPath)) fs.unlinkSync(changelogPath);
    console.log(`\n🎉 Successfully published release ${tagName} to GitHub!`);
    console.log('⚙️ CI/CD pipeline triggered: npm package and Docker multi-arch images are publishing.');
  } catch (err) {
    console.warn(`⚠️ Warning: GitHub release CLI command returned non-zero exit: ${err.message}`);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  determineBump,
  calculateNextVersion,
  generateChangelog,
  main,
};
