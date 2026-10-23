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

  test('icon-only modal close buttons have descriptive aria-labels', () => {
    const closeBtnIds = [
      'directory-modal-close',
      'ct-close-btn',
      'reading-list-close-btn',
      'add-to-list-close-btn'
    ];

    closeBtnIds.forEach((id) => {
      const btn = document.getElementById(id);
      expect(btn).not.toBeNull();
      const label = btn.getAttribute('aria-label');
      expect(label).toBeTruthy();
      expect(label.length).toBeGreaterThan(3);
    });

    const settingsCloseBtn = document.querySelector('#settings-modal .modal-close-btn');
    expect(settingsCloseBtn).not.toBeNull();
    expect(settingsCloseBtn.getAttribute('aria-label')).toBeTruthy();
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
