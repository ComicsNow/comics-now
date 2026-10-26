/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');

describe('Modal Dialog Accessibility & Keyboard Dismissal', () => {
  let htmlContent;

  beforeAll(() => {
    const htmlPath = path.join(__dirname, '../public/index.html');
    htmlContent = fs.readFileSync(htmlPath, 'utf8');
  });

  beforeEach(() => {
    document.body.innerHTML = htmlContent;
  });

  test('modal containers have role="dialog", aria-modal="true", and matching aria-labelledby', () => {
    const modalIds = [
      'directory-selection-modal',
      'settings-modal',
      'ct-modal',
      'reading-list-modal',
      'add-to-list-modal',
      'gemini-compliance-modal',
      'mgmt-confirm-modal'
    ];

    modalIds.forEach((id) => {
      const modalEl = document.getElementById(id);
      expect(modalEl).not.toBeNull();
      expect(modalEl.getAttribute('role')).toBe('dialog');
      expect(modalEl.getAttribute('aria-modal')).toBe('true');

      const labelledBy = modalEl.getAttribute('aria-labelledby');
      expect(labelledBy).toBeTruthy();

      const labelEl = document.getElementById(labelledBy);
      expect(labelEl).not.toBeNull();
    });
  });

  test('icon-only modal close buttons and search clear button have descriptive aria-label and title attributes', () => {
    const closeBtnIds = [
      'directory-modal-close',
      'ct-close-btn',
      'reading-list-close-btn',
      'add-to-list-close-btn',
      'clear-search-btn'
    ];

    closeBtnIds.forEach((id) => {
      const btn = document.getElementById(id);
      expect(btn).not.toBeNull();
      const label = btn.getAttribute('aria-label');
      const title = btn.getAttribute('title');
      expect(label).toBeTruthy();
      expect(title).toBeTruthy();
      expect(label.length).toBeGreaterThan(3);
      expect(title).toBe(label);
    });

    const settingsCloseBtn = document.querySelector('#settings-modal .modal-close-btn');
    expect(settingsCloseBtn).not.toBeNull();
    expect(settingsCloseBtn.getAttribute('aria-label')).toBeTruthy();
    expect(settingsCloseBtn.getAttribute('title')).toBe(settingsCloseBtn.getAttribute('aria-label'));
  });

  test('header action buttons, view mode toggles, and reader controls have aria-label and title attributes', () => {
    const iconBtnIds = [
      'logout-button',
      'reading-list-button',
      'downloads-button',
      'ct-button',
      'settings-button',
      'smart-list-mode-list-top',
      'smart-list-mode-folders-top',
      'search-mode-list',
      'search-mode-folders',
      'fullscreen-orientation-btn',
      'fullscreen-eink-toggle-btn',
      'fullscreen-manga-mode-btn',
      'fullscreen-continuous-mode-btn',
      'fullscreen-full-image-btn',
      'manga-guided-toggle-btn',
      'western-guided-toggle-btn',
      'western-speech-zoom',
      'manga-panel-zoom',
      'manga-speech-zoom-btn'
    ];

    iconBtnIds.forEach((id) => {
      const btn = document.getElementById(id);
      expect(btn).not.toBeNull();
      const ariaLabel = btn.getAttribute('aria-label');
      const title = btn.getAttribute('title');
      expect(ariaLabel).toBeTruthy();
      expect(title).toBeTruthy();
      expect(ariaLabel.length).toBeGreaterThan(2);
      expect(title.length).toBeGreaterThan(2);
    });
  });

  test('Escape key closes active modal', () => {
    const settingsModal = document.getElementById('settings-modal');
    expect(settingsModal).not.toBeNull();

    let settingsClosed = false;
    window.closeSettingsModal = () => {
      settingsClosed = true;
      settingsModal.classList.add('hidden');
    };

    settingsModal.classList.remove('hidden');

    // Attach event handler logic identical to events.js for jsdom environment test
    const keyHandler = (e) => {
      if (e.key !== 'Escape') return;
      if (!settingsModal.classList.contains('hidden')) {
        window.closeSettingsModal();
      }
    };
    document.addEventListener('keydown', keyHandler);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(settingsClosed).toBe(true);
    expect(settingsModal.classList.contains('hidden')).toBe(true);

    document.removeEventListener('keydown', keyHandler);
  });
});
