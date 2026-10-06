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
    // v3 `focus:outline-none` semantics: transparent 2px outline (hidden,
    // but preserved for forced-colours). v4's equivalent is `outline-hidden`.
    expect(outline).toEqual({ style: 'solid', width: '2px', color: 'rgba(0, 0, 0, 0)' });
  });

  test('settings modal: overlay opacity, bare shadow, focus ring', async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => window.router.navigate('/settings'));
    await page.waitForSelector('#settings-modal', { state: 'visible', timeout: 15000 });
    await page.waitForTimeout(800);

    // Modal overlay: `bg-gray-900 bg-opacity-75` — the v4 rename target
    // `bg-gray-900/75` must keep rendering this exact colour.
    const overlayBg = await page.evaluate(() =>
      getComputedStyle(document.getElementById('settings-modal')).backgroundColor);
    expect(overlayBg).toBe('rgba(17, 24, 39, 0.75)');

    // Ko-fi pill: bare `shadow` (v3 → v4 `shadow-sm`) + `rounded-full`.
    const kofi = await page.evaluate(() => {
      const s = getComputedStyle(document.getElementById('kofi-settings-link'));
      return { boxShadow: s.boxShadow, borderRadius: s.borderRadius };
    });
    expect(kofi.boxShadow).toBe(
      'rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, ' +
      'rgba(0, 0, 0, 0.1) 0px 1px 3px 0px, rgba(0, 0, 0, 0.1) 0px 1px 2px -1px');
    expect(kofi.borderRadius).toBe('9999px');

    // Focus ring on the first General input (custom focus style in style.css;
    // must stay put regardless of Tailwind's ring default changes).
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

    // Engine status badge: `border border-green-700` — explicit Tailwind border
    // colour that must not be affected by v4's default-colour change.
    const badge = await page.evaluate(() => {
      const s = getComputedStyle(document.getElementById('ct-engine-status'));
      return { color: s.borderTopColor, width: s.borderTopWidth };
    });
    expect(badge).toEqual({ color: 'rgb(21, 128, 61)', width: '1px' });

    // Gemini tab: bare `rounded` (4px) + `border border-gray-700`.
    await page.click('#ct-tab-gemini', { force: true });
    await page.waitForTimeout(500);
    const input = await page.evaluate(() => {
      const s = getComputedStyle(document.getElementById('ct-cv-key-input'));
      return { radius: s.borderRadius, borderColor: s.borderTopColor };
    });
    expect(input.radius).toBe('4px');
    expect(input.borderColor).toBe('rgb(55, 65, 81)');
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
    expect(v.boxShadow).toBe(
      'rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, ' +
      'rgba(0, 0, 0, 0.1) 0px 10px 15px -3px, rgba(0, 0, 0, 0.1) 0px 4px 6px -4px');
    expect(v.borderRadius).toBe('8px');
  });
});
