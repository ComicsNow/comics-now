/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

describe('Tag Comics Now! Management UI (Name & Folder Tabs, Token Ordering, Confirmation Modal)', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="ct-modal">
        <button id="mgmt-tab-name" class="tab-button active"><span>Name</span></button>
        <button id="mgmt-tab-folder" class="tab-button"><span>Folder</span></button>
        
        <div id="mgmt-content-name">
          <div id="naming-live-preview">--</div>
          <button id="save-naming-rules-btn">Save Naming Rules</button>
          <div id="naming-tokens-list"></div>
          <button id="rename-cbz-btn">Rename Inbox</button>
          <button id="rename-clear-output">Clear</button>
          <div id="rename-output" class="hidden"></div>
          <div id="rename-status"></div>
          <select id="rename-library-select"><option value="/library-a">Library A</option></select>
          <button id="rename-library-btn">Rename Library</button>
        </div>

        <div id="mgmt-content-folder" class="hidden">
          <div id="folder-live-preview">--</div>
          <select id="add-folder-token-select">
            <option value="publisher">Publisher</option>
            <option value="writer">Writer</option>
            <option value="series">Series</option>
          </select>
          <button id="add-folder-level-btn">+ Add Level</button>
          <button id="save-folder-rules-btn">Save Folder Rules</button>
          <div id="folder-levels-list"></div>
          <button id="move-comics-btn">Move & Reorganize Comics</button>
          <button id="move-clear-output">Clear</button>
          <div id="move-output" class="hidden"></div>
          <div id="move-status"></div>
        </div>

        <!-- Safety Confirmation Modal -->
        <div id="mgmt-confirm-modal" class="hidden">
          <h4 id="mgmt-confirm-title"></h4>
          <p id="mgmt-confirm-warning"></p>
          <input type="text" id="mgmt-confirm-input" />
          <button id="mgmt-confirm-cancel-btn">Cancel</button>
          <button id="mgmt-confirm-proceed-btn" disabled>Confirm & Proceed</button>
        </div>
      </div>
    `;

    global.fetch = jest.fn((url) => {
      if (url.includes('/api/v1/tag-comics-now/naming-rules')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            ok: true,
            rules: {
              tokens: [
                { id: 'number', enabled: true, mandatory: false },
                { id: 'series', enabled: true, mandatory: true }
              ]
            }
          })
        });
      }
      if (url.includes('/api/v1/tag-comics-now/folder-rules')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            ok: true,
            rules: {
              hierarchy: ['publisher', 'series']
            }
          })
        });
      }
      if (url.includes('/api/v1/tag-comics-now/naming-preview')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            ok: true,
            filename: '02 Animal Castle.cbz'
          })
        });
      }
      if (url.includes('/api/v1/tag-comics-now/folder-preview')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            ok: true,
            folderPath: 'Ablaze/Animal Castle'
          })
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ ok: true })
      });
    });

    // Load comics-management.js into current jsdom environment
    const fullPath = path.resolve(__dirname, '../public/js/settings/comics-management.js');
    const content = fs.readFileSync(fullPath, 'utf8');
    const cleanContent = content
      .replace(/import\s+[\s\S]*?from\s+['"][^'"]+['"];?/g, '')
      .replace(/export\s+const\s+/g, 'const ')
      .replace(/export\s+let\s+/g, 'let ')
      .replace(/export\s+function\s+/g, 'function ')
      .replace(/export\s+async\s+function\s+/g, 'async function ')
      .replace(/export\s+\{[\s\S]*?\};?/g, '')
      .replace(/export\s+default\s+[\s\S]*?;?/g, '');
    
    const fn = new Function('window', 'document', 'fetch', 'state', cleanContent);
    fn(window, document, global.fetch, { API_BASE_URL: '' });
    document.dispatchEvent(new Event('DOMContentLoaded'));
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('Sub-tab switching reveals Name or Folder panel', () => {
    const tabName = document.getElementById('mgmt-tab-name');
    const tabFolder = document.getElementById('mgmt-tab-folder');
    const contentName = document.getElementById('mgmt-content-name');
    const contentFolder = document.getElementById('mgmt-content-folder');

    // Switch to Folder tab
    tabFolder.click();
    expect(tabFolder.classList.contains('active')).toBe(true);
    expect(tabName.classList.contains('active')).toBe(false);
    expect(contentFolder.classList.contains('hidden')).toBe(false);
    expect(contentName.classList.contains('hidden')).toBe(true);

    // Switch back to Name tab
    tabName.click();
    expect(tabName.classList.contains('active')).toBe(true);
    expect(tabFolder.classList.contains('active')).toBe(false);
    expect(contentName.classList.contains('hidden')).toBe(false);
    expect(contentFolder.classList.contains('hidden')).toBe(true);
  });

  test('Safety confirmation modal enables proceed button only on exact phrase "i want to do this"', () => {
    // The whole-library rename (Name tab) is the confirmation-gated action.
    const renameBtn = document.getElementById('rename-library-btn');
    const confirmModal = document.getElementById('mgmt-confirm-modal');
    const confirmInput = document.getElementById('mgmt-confirm-input');
    const confirmProceedBtn = document.getElementById('mgmt-confirm-proceed-btn');
    const confirmCancelBtn = document.getElementById('mgmt-confirm-cancel-btn');

    renameBtn.click();
    expect(confirmModal.classList.contains('hidden')).toBe(false);
    expect(confirmProceedBtn.disabled).toBe(true);

    // Type incorrect phrase
    confirmInput.value = 'yes';
    confirmInput.dispatchEvent(new Event('input'));
    expect(confirmProceedBtn.disabled).toBe(true);

    // Type case variation
    confirmInput.value = 'I agree to this';
    confirmInput.dispatchEvent(new Event('input'));
    expect(confirmProceedBtn.disabled).toBe(true);

    // Type exact phrase
    confirmInput.value = 'i want to do this';
    confirmInput.dispatchEvent(new Event('input'));
    expect(confirmProceedBtn.disabled).toBe(false);

    // Cancel hides modal
    confirmCancelBtn.click();
    expect(confirmModal.classList.contains('hidden')).toBe(true);
  });
});
