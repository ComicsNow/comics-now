import { test, expect } from '@playwright/test';
import { execSync } from 'child_process';

test.use({ browserName: 'firefox' });

const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
);

test('publisher logo upload and canonical URL flow', async ({ page }) => {
  page.on('console', (msg) => console.log('BROWSER CONSOLE:', msg.text()));
  page.on('pageerror', (err) => console.log('BROWSER ERROR:', err.message));
  test.setTimeout(60000);
  await page.goto('/');

  const settingsResponse = page.waitForResponse(
    (res) => res.url().includes('/api/v1/settings') && res.status() === 200
  );

  await page.locator('#settings-button').click();
  await settingsResponse;

  const settingsModal = page.locator('#settings-modal');
  await expect(settingsModal).toBeVisible();

  await page.locator('#settings-scope-server-btn').click();
  await page.locator('#settings-tab-publisher-logos').click();

  const publisherLogosContent = page.locator('#settings-content-publisher-logos');
  await expect(publisherLogosContent).toBeVisible();

  const firstCard = page.locator('.pl-card').first();
  await expect(firstCard).toBeVisible();

  const initialThumbs = page.locator('.pl-card img');
  const initialThumbCount = await initialThumbs.count();
  for (let i = 0; i < initialThumbCount; i += 1) {
    await expect(initialThumbs.nth(i)).toHaveAttribute('src', /^[^?]+$/);
  }

  const thumbnail = firstCard.locator('.relative.h-24').first();
  const box = await thumbnail.boundingBox();
  expect(box).not.toBeNull();
  expect(Math.round(box.height)).toBe(96);

  await thumbnail.click();

  const zoomModal = page.locator('#publisher-logo-zoom-modal');
  await expect(zoomModal).toBeVisible();
  await zoomModal.locator('button[aria-label="Close preview"]').click();
  await expect(zoomModal).toBeHidden();

  const saveBtn = page.locator('#pl-save-btn');

  await firstCard.locator('input[type="file"]').setInputFiles({
    name: 'pixel.png',
    mimeType: 'image/png',
    buffer: ONE_PIXEL_PNG,
  });

  // Verify pending save badge is shown and save button is enabled
  await expect(page.locator('text=● Pending Save').first()).toBeVisible();
  await expect(saveBtn).toBeEnabled();

  // Test Revert so production files are completely untouched
  const revertBtn = firstCard.locator('button[title="Revert pending change"], button:has-text("Revert")').first();
  await revertBtn.click();
  await expect(page.locator('text=● Pending Save')).toHaveCount(0);
  await expect(saveBtn).toBeDisabled();

  const currentThumb = firstCard.locator('img').first();
  await expect(currentThumb).toHaveAttribute('src', /^[^?]+$/);

  const uploadedThumbs = page.locator('.pl-card img');
  const uploadedThumbCount = await uploadedThumbs.count();
  for (let i = 0; i < uploadedThumbCount; i += 1) {
    await expect(uploadedThumbs.nth(i)).toHaveAttribute('src', /^[^?]+$/);
  }

  const closeButton = page.locator('#settings-modal .modal-close-btn, #settings-modal button.close, #settings-modal [aria-label*="lose"]').first();
  if (await closeButton.isVisible()) {
    await closeButton.click();
  } else {
    await page.keyboard.press('Escape');
  }
  await expect(settingsModal).toBeHidden();

  await page.waitForSelector('.folder-card');
  await page.locator('.folder-card', { hasText: 'library' }).first().click();
  await page.waitForSelector('.series-card');
  await expect(page.locator('.series-card').first()).toBeVisible();
});

test.afterAll(async () => {
  const root = process.cwd();
  execSync(`git -C "${root}" checkout -- "logos/DC Comics/logo.svg" 2>/dev/null || true`);
});
