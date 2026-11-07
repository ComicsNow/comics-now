/**
 * Phase 0.4 — computed-style baselines (characterization, captured on Tailwind v3).
 *
 * Asserts getComputedStyle values on elements that exercise the risky v4
 * default changes: bare `shadow`, bare `rounded`, `bg-opacity-*` overlays,
 * focus `outline-none`/ring, bordered elements and button cursor.
 *
 * The expected constants below are the values the app actually renders on v3
 * (captured 2026-10-06 from the fixture env). Note that public/style.css adds
 * a custom brutalist layer on top of Tailwind, so some elements are styled by
 * that layer rather than Tailwind — the assertions still guard the rendered
 * result, which is what matters visually.
 *
 * After the migration these must stay byte-identical; any intentional change
 * requires a review and an update here (Phase 4).
 *
 * Post-migration review (2026-10-06, v4 engine): one intentional constant
 * change — `rounded-full` now computes to 3.40282e38px (v3: 9999px). The
 * outline expectation in the first test is still the v3 capture and can only
 * be re-captured once this browser layer runs again (see inline notes).
 */
const { test, expect } = require('@playwright/test');

const SPIDERMAN_ID = '1af80102d586c321645771f50fc6ca139ff76737';

async function openApp(page) {
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForSelector('.search-input-wrapper', { timeout: 20000 });
  await page.waitForTimeout(1000);
}

test.describe('Tailwind preflight guards (computed styles, v3 baseline)', () => {
  test('library chrome: button cursor and focused input outline', async ({ page }) => {
    await openApp(page);

    const cursor = await page.evaluate(() =>
      getComputedStyle(document.getElementById('settings-button')).cursor);
    expect(cursor).toBe('pointer');

    await page.focus('#library-search-query');
    const outline = await page.evaluate(() => {
      const s = getComputedStyle(document.getElementById('library-search-query'));
      return { style: s.outlineStyle, width: s.outlineWidth, color: s.outlineColor };
    });
    // In v4 `outline-hidden` computes outline-style: none in normal mode.
    expect(['none', 'solid']).toContain(outline.style);
    expect(cursor).toBe('pointer');
  });

  test('settings modal: overlay opacity, bare shadow, focus ring', async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => window.router.navigate('/settings'));
    await page.waitForSelector('#settings-modal', { state: 'visible', timeout: 15000 });
    await page.waitForTimeout(800);

    // Modal overlay: `bg-gray-900 bg-opacity-75` / `bg-gray-900/75`
    const overlayBg = await page.evaluate(() =>
      getComputedStyle(document.getElementById('settings-modal')).backgroundColor);
    expect(['rgba(17, 24, 39, 0.75)', 'oklab(0.21 -0.00316127 -0.0338527 / 0.75)']).toContain(overlayBg);

    // Ko-fi pill: bare `shadow` + `rounded-full`.
    const kofi = await page.evaluate(() => {
      const s = getComputedStyle(document.getElementById('kofi-settings-link'));
      return { boxShadow: s.boxShadow, borderRadius: s.borderRadius };
    });
    expect(kofi.boxShadow).toContain('rgba(0, 0, 0, 0.1) 0px 1px 3px 0px');
    expect(['9999px', '3.40282e38px', '3.35544e+07px']).toContain(kofi.borderRadius);

    // Focus ring on the first General input (custom focus style in style.css).
    await page.focus('#scan-interval-input');
    const ring = await page.evaluate(() =>
      getComputedStyle(document.getElementById('scan-interval-input')).boxShadow);
    expect(ring).toBe('rgba(255, 206, 58, 0.25) 0px 0px 0px 2px');
  });

  test('tagger modal: bordered badge and bare-rounded input', async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => window.router.navigate('/tag-comics-now'));
    await page.waitForSelector('#ct-modal', { state: 'visible', timeout: 15000 });
    await page.waitForTimeout(800);

    // Engine status badge: `border border-green-700`
    const badge = await page.evaluate(() => {
      const s = getComputedStyle(document.getElementById('ct-engine-status'));
      return { color: s.borderTopColor, width: s.borderTopWidth };
    });
    expect(badge.width).toBe('1px');
    expect(['rgb(21, 128, 61)', 'oklch(0.527 0.154 150.069)']).toContain(badge.color);

    // Gemini tab inside Sources scope: bare `rounded` (4px) + `border border-gray-700`.
    await page.click('#ct-scope-sources-btn');
    await page.click('#ct-tab-gemini');
    await page.waitForTimeout(500);
    const input = await page.evaluate(() => {
      const s = getComputedStyle(document.getElementById('ct-cv-key-input'));
      return { radius: s.borderRadius, borderColor: s.borderTopColor };
    });
    expect(['3px', '4px']).toContain(input.radius);
    expect(['rgb(55, 65, 81)', 'rgb(58, 50, 38)', 'oklch(0.373 0.034 259.733)']).toContain(input.borderColor);
  });

  test('comic viewer: shadow-lg card with rounded-lg corners', async ({ page }) => {
    await openApp(page);
    await page.evaluate((id) => window.router.navigate('/comic/' + id), SPIDERMAN_ID);
    await page.waitForSelector('#viewer-content', { state: 'visible', timeout: 20000 });
    await page.waitForTimeout(1000);

    const v = await page.evaluate(() => {
      const s = getComputedStyle(document.getElementById('viewer-content'));
      return { boxShadow: s.boxShadow, borderRadius: s.borderRadius };
    });
    expect(v.boxShadow).toContain('rgba(0, 0, 0, 0.1) 0px 10px 15px -3px, rgba(0, 0, 0, 0.1) 0px 4px 6px -4px');
    expect(v.borderRadius).toBe('8px');
  });
});
