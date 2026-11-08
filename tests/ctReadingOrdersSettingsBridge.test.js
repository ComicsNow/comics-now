/**
 * @jest-environment jsdom
 */
const fs = require('fs');
const path = require('path');

describe('ComicTagger ReadingOrders Continuity Settings Bridge', () => {
  beforeEach(() => {
    const htmlPath = path.resolve(__dirname, '../public/index.html');
    const htmlContent = fs.readFileSync(htmlPath, 'utf8');

    // Extract relevant markup from index.html
    document.body.innerHTML = htmlContent;
  });

  test('bridge-to-story-arcs-settings-btn exists and has click handler targeting ct-tab-story-arcs', () => {
    const bridgeBtn = document.getElementById('bridge-to-story-arcs-settings-btn');
    const storyArcsTab = document.getElementById('ct-tab-story-arcs');
    const cb = document.getElementById('src-cb-readingorders');

    expect(bridgeBtn).not.toBeNull();
    expect(storyArcsTab).not.toBeNull();
    expect(cb).not.toBeNull();

    // Verify onclick attribute or event triggering
    let tabClicked = false;
    storyArcsTab.addEventListener('click', () => {
      tabClicked = true;
    });

    const initialChecked = cb.checked;

    // Simulate click on bridge button
    bridgeBtn.click();

    expect(tabClicked).toBe(true);
    // Clicking the settings button must not toggle the checkbox
    expect(cb.checked).toBe(initialChecked);
  });
});
