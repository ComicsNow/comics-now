/**
 * @jest-environment jsdom
 */

describe('Guided Reader UI - Form input preservation during status polling', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <form id="guided-settings-form">
        <input type="checkbox" id="guided-auto-on-add">
        <input type="checkbox" id="guided-schedule-enabled">
        <input type="number" id="guided-schedule-interval" value="24">
        <select id="guided-schedule-unit"><option value="hours">hours</option></select>
        <input type="checkbox" id="guided-use-modal">
        <div id="guided-modal-panel" class="hidden"></div>
        <input type="text" id="guided-modal-token-id">
        <input type="password" id="guided-modal-token-secret">
        <input type="text" id="guided-modal-env">
      </form>
      <div id="guided-count-pending"></div>
      <div id="guided-count-processing"></div>
      <div id="guided-count-completed"></div>
      <div id="guided-count-failed"></div>
      <div id="guided-count-total"></div>
      <div id="guided-current"></div>
      <button id="guided-run-btn"></button>
      <button id="guided-cancel-btn"></button>
      <button id="guided-cancel-current-btn"></button>
    `;
  });

  test('user toggle on guided-use-modal persists across status polling ticks', () => {
    let settingsLoaded = false;

    function applyStatusToUI(s) {
      document.getElementById('guided-count-pending').textContent = s.counts?.pending ?? 0;
    }

    function applySettingsToUI(settings) {
      const cb = document.getElementById('guided-use-modal');
      cb.checked = !!settings.useModal;
      document.getElementById('guided-modal-panel').classList.toggle('hidden', !settings.useModal);
    }

    function fetchStatus(data, force = false) {
      applyStatusToUI(data);
      if (!settingsLoaded || force) {
        applySettingsToUI(data.settings);
        settingsLoaded = true;
      }
    }

    const serverData = {
      counts: { pending: 5 },
      settings: { useModal: false }
    };

    // Initial load: settings loaded from server (useModal is false)
    fetchStatus(serverData);
    expect(document.getElementById('guided-use-modal').checked).toBe(false);
    expect(document.getElementById('guided-modal-panel').classList.contains('hidden')).toBe(true);

    // User checks the checkbox
    const cb = document.getElementById('guided-use-modal');
    cb.checked = true;
    document.getElementById('guided-modal-panel').classList.remove('hidden');

    // Subsequent status polling ticks (running every 1s) must NOT uncheck the checkbox
    fetchStatus({ counts: { pending: 4 }, settings: { useModal: false } });
    expect(document.getElementById('guided-use-modal').checked).toBe(true);
    expect(document.getElementById('guided-modal-panel').classList.contains('hidden')).toBe(false);

    // Multiple polling ticks later, checkbox remains checked
    fetchStatus({ counts: { pending: 3 }, settings: { useModal: false } });
    expect(document.getElementById('guided-use-modal').checked).toBe(true);
  });
});
