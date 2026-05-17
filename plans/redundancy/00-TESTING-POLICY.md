# Shared Testing Policy

Applies to every plan in this directory. Each plan adds its own before/after checks; this file captures the rules they all share so they don't repeat.

## Before/after capture

For each finding:
1. **Capture the "before" state** before any change:
   - Run the full test suite: `npm test -- --silent 2>&1 | tee /tmp/before-tests.txt`.
   - Run any plan-specific manual checks listed in the plan (HTTP curls, browser smoke, file existence).
   - Record line counts / git status / SHA of files that will be touched.
2. **Apply the change** on a branch.
3. **Capture the "after" state**:
   - Re-run the same test command into `/tmp/after-tests.txt`.
   - Re-run the same manual checks.
4. **Diff** before/after to confirm only the intended deltas appear.

## What to do on test failure

In strict order — do not skip steps.

1. **Assume the code change is at fault, not the test.** Read the failing test's expectation and the production diff side-by-side. Look for:
   - Removed exports that the test imports.
   - Renamed identifiers.
   - Behavioral drift in a function the test exercises.
   - Async timing changes (a removed `await`, a new microtask).
   - Module load order changes (especially for browser globals).
2. **Look for newly-introduced bugs in the diff** even if the test passes. Specifically check:
   - Did a deletion remove a side effect (e.g., a global assignment) that other code depended on?
   - Did consolidating a helper change its signature or its handling of `null`/`undefined`?
   - Did a "dead" export turn out to be referenced via dynamic string lookup (`module[name]`)?
3. **Fix the production code, not the test.** Default to repairing whatever the test was guarding.
4. **Only consider fixing the test if you have positive evidence it was wrong** — for example, the test asserts behavior the code never actually had, or it was checking the now-deleted dead code itself.
5. **Always ask the user before modifying any test.** Present:
   - The test name and file.
   - The original assertion and what it was checking.
   - The proposed change.
   - The evidence that the test was incorrect (not just inconvenient).
   Wait for explicit approval. Never silently edit a test.
6. **Never weaken a test** (loosening matchers, removing assertions, adding `.skip`/`.only`, broadening regexes) to make it pass. If a test is genuinely overspecified, raise it with the user as a separate item.

## Manual / UI checks

Where a plan touches frontend code, the unit tests won't catch UI regressions. Each plan's "manual" section lists the browser smoke steps. If a manual check fails: same hierarchy — investigate the diff first, fix the code, ask before changing the check.

## Rollback

Every plan is independently revertable. If a plan can't be made green, revert its commit and move on — don't pile fixes on top.
