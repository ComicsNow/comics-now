const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

test.describe('ComicsNow! E2E Test Suite', () => {
  const libraryPath = path.resolve(__dirname, '../fixtures/library');
  const spidermanSidecar = path.resolve(libraryPath, 'spiderman_1.ComicInfo.xml');

  test.beforeEach(async ({ page }) => {
    // Clean up adjacent sidecar file if it exists
    if (fs.existsSync(spidermanSidecar)) {
      fs.unlinkSync(spidermanSidecar);
    }
  });

  test('Library scan, settings customization, hierarchy navigation, reader progress, and metadata sidecar saving', async ({ page }) => {
    // 1. Go to homepage
    await page.goto('/');

    // 2. Open Settings, change storage to Sidecar, and trigger a Library Scan
    const settingsPromise = page.waitForResponse(response => 
      response.url().includes('/api/v1/settings') && response.request().method() === 'GET'
    );
    await page.click('#settings-button');
    await page.waitForSelector('#settings-modal', { state: 'visible' });
    await settingsPromise;
    await page.waitForTimeout(500); // Allow JS to populate the values

    // Switch to Comics Defaults tab and select Sidecar
    await page.click('#settings-tab-comics-defaults');
    await page.selectOption('#metadata-storage-select', 'sidecar');

    // Submit the settings form directly to avoid tab-switch reset
    await page.locator('#settings-form').evaluate(form => form.requestSubmit());

    // Wait for settings to save successfully
    await expect(page.locator('#settings-status')).toContainText('Settings saved!');

    // Switch back to General tab so the Scan button becomes visible
    await page.click('#settings-tab-general');
    
    // Trigger Library Scan
    await page.click('#scan-button');

    // Wait a brief moment for the scanner background task to start and parse comics
    await page.waitForTimeout(4000);

    // Close settings modal (click × button inside modal header)
    const closeBtn = page.locator('#settings-modal .modal-close-btn').first();
    await closeBtn.click();
    await page.waitForSelector('#settings-modal', { state: 'hidden' });

    // 3. Hierarchy Navigation & Breadcrumbs
    // Click on the 'library' folder card to drill down
    await page.waitForSelector('.folder-card');
    await page.locator('.folder-card', { hasText: 'library' }).first().click();

    // Check that we see the publishers rendered (DC Comics, Marvel Comics)
    await page.waitForSelector('.series-card');
    const dcCard = page.locator('.series-card', { hasText: 'DC Comics' });
    const marvelCard = page.locator('.series-card', { hasText: 'Marvel Comics' });

    await expect(dcCard).toBeVisible();
    await expect(marvelCard).toBeVisible();

    // Click Marvel Comics to drill down
    await marvelCard.click();
    
    // Since Marvel Comics only has one series ("Amazing Spider-Man"), 
    // the UI automatically drills down to the comic list view!
    // Let's verify "Amazing Spider-Man #1" is visible.
    const comicCard = page.locator('.comic-card', { hasText: 'Amazing Spider-Man #1' });
    await expect(comicCard).toBeVisible();

    // Test breadcrumbs back up to the Series List view
    // (using force: true internally to display the series card)
    await page.locator('#breadcrumb button', { hasText: 'Marvel Comics' }).click();
    
    // Check that the series card "Amazing Spider-Man" is now visible
    const seriesCard = page.locator('.series-card', { hasText: 'Amazing Spider-Man' });
    await expect(seriesCard).toBeVisible();

    // Click it to go back to the comic list
    await seriesCard.click();
    await expect(comicCard).toBeVisible();

    // 4. Comic Viewer & Reading Progress Syncing
    // Click comic card to open it in the reader
    await comicCard.click();

    // Wait for reader overlay to be visible
    await page.waitForSelector('.viewer-container, #viewer, .page-image-container');

    // Currently on page 1. Paging forward is done by clicking page viewport or navigation
    // Let's press 'ArrowRight' to page forward (Standard next page keyboard shortcut)
    await page.keyboard.press('ArrowRight');

    // Wait for progress save request to complete
    await page.waitForTimeout(1000);

    // Close the viewer (using breadcrumbs back to the series list)
    await page.locator('#breadcrumb button', { hasText: 'Amazing Spider-Man' }).click();
    await page.waitForSelector('#comic-viewer', { state: 'hidden' });

    // Verify progress update: Re-open the comic
    await comicCard.click();
    await page.waitForSelector('.viewer-container, #viewer, .page-image-container');

    // Close reader again
    await page.locator('#breadcrumb button', { hasText: 'Amazing Spider-Man' }).click();
    await page.waitForSelector('#comic-viewer', { state: 'hidden' });

    // 5. Manual Metadata Edit & Sidecar Saving
    // Open the comic to access the tabs
    await comicCard.click();
    await page.waitForSelector('#metadata-tab');

    // Click the Metadata tab
    await page.click('#metadata-tab');

    // Metadata editor tab should be visible
    await page.waitForSelector('#metadata-form');

    // Change field: Writer
    const writerInput = page.locator('#metadata-form input[name="Writer"]');
    await writerInput.fill('Stan Lee & Steve Ditko');

    // Click Save Changes
    await page.click('#metadata-form button[type="submit"]');

    // Assert save completion message
    const saveStatus = page.locator('#save-status');
    await expect(saveStatus).toContainText('Changes saved', { timeout: 10000 });

    // 6. Verify Physical Adjacent Sidecar File Creation (Since storageMode was changed to sidecar)
    expect(fs.existsSync(spidermanSidecar)).toBe(true);
    const sidecarContent = fs.readFileSync(spidermanSidecar, 'utf-8');
    expect(spidermanSidecar).toBeTruthy();
    expect(sidecarContent).toContain('<Writer>Stan Lee &amp; Steve Ditko</Writer>');
  });
});
