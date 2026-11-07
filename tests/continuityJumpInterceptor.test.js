/**
 * @jest-environment jsdom
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

describe('Continuity Jump Interceptor', () => {
  let sandbox;

  beforeEach(() => {
    document.body.innerHTML = '';

    const state = {
      API_BASE_URL: 'http://localhost:3000'
    };

    sandbox = {
      window,
      document,
      console,
      state,
      localStorage: {
        _store: {},
        getItem(k) { return this._store[k] || null; },
        setItem(k, v) { this._store[k] = String(v); },
        removeItem(k) { delete this._store[k]; }
      },
      escapeHtml: str => String(str || '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])),
      fetch: jest.fn().mockImplementation((url) => {
        if (url.includes('/api/v1/comics/104/continuity')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              ok: true,
              hasArc: true,
              arcTitle: 'Civil War',
              position: 4,
              earlierUnread: [
                { id: 101, name: 'Civil War #1', position: 1 },
                { id: 102, name: 'Front Line #1', position: 2 }
              ]
            })
          });
        }
        if (url.includes('/api/v1/comics/101/continuity')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              ok: true,
              hasArc: true,
              arcTitle: 'Civil War',
              position: 1,
              earlierUnread: []
            })
          });
        }
        return Promise.resolve({ ok: false });
      })
    };

    vm.createContext(sandbox);

    const filePath = path.resolve(__dirname, '../public/js/viewer/continuity-check.js');
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf8')
        .replace(/^\s*import\s+[\s\S]*?from\s+['"][^'"]+['"];?/gm, '')
        .replace(/export\s+async\s+function\s+/g, 'async function ')
        .replace(/export\s+function\s+/g, 'function ')
        .replace(/export\s+const\s+/g, 'const ');
      vm.runInContext(content, sandbox);
    }
  });

  test('calls onProceed directly if no earlier unread issues exist in arc', async () => {
    const onProceed = jest.fn();
    const onReadOldest = jest.fn();

    const comic = { id: 101, name: 'Civil War #1' };
    await sandbox.checkContinuityBeforeRead(comic, onProceed, onReadOldest);

    expect(onProceed).toHaveBeenCalled();
    expect(onReadOldest).not.toHaveBeenCalled();
    expect(document.getElementById('continuity-check-modal')).toBeNull();
  });

  test('shows continuity check dialog when earlier unread issues exist in arc', async () => {
    const onProceed = jest.fn();
    const onReadOldest = jest.fn();

    const comic = { id: 104, name: 'Civil War #4' };
    await sandbox.checkContinuityBeforeRead(comic, onProceed, onReadOldest);

    const modal = document.getElementById('continuity-check-modal');
    expect(modal).not.toBeNull();
    expect(modal.classList.contains('hidden')).toBe(false);
    expect(modal.textContent).toContain('Continuity Check');
    expect(modal.textContent).toContain('Civil War');
    expect(modal.textContent).toContain('2 earlier issues');

    // Clicking read oldest button calls onReadOldest with the oldest unread comic
    const oldestBtn = modal.querySelector('#continuity-read-oldest-btn');
    expect(oldestBtn).not.toBeNull();
    oldestBtn.click();

    expect(onReadOldest).toHaveBeenCalledWith(expect.objectContaining({ id: 101, name: 'Civil War #1' }));
  });

  test('clicking proceed button calls onProceed', async () => {
    const onProceed = jest.fn();
    const onReadOldest = jest.fn();

    const comic = { id: 104, name: 'Civil War #4' };
    await sandbox.checkContinuityBeforeRead(comic, onProceed, onReadOldest);

    const modal = document.getElementById('continuity-check-modal');
    const proceedBtn = modal.querySelector('#continuity-proceed-btn');
    expect(proceedBtn).not.toBeNull();
    proceedBtn.click();

    expect(onProceed).toHaveBeenCalled();
  });

  test('bypasses continuity check if bypass preference is stored in localStorage', async () => {
    sandbox.localStorage.setItem('continuity-bypass:Civil War', 'true');

    const onProceed = jest.fn();
    const onReadOldest = jest.fn();

    const comic = { id: 104, name: 'Civil War #4' };
    await sandbox.checkContinuityBeforeRead(comic, onProceed, onReadOldest);

    expect(onProceed).toHaveBeenCalled();
    const modal = document.getElementById('continuity-check-modal');
    if (modal) {
      expect(modal.classList.contains('hidden')).toBe(true);
    }
  });
});
