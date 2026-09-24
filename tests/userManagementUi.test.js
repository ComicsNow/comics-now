/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

function createModuleSandbox() {
  const state = {
    API_BASE_URL: '',
    showUserAccessView: jest.fn(),
    showUserStatsView: jest.fn(),
    startImpersonation: jest.fn()
  };

  const sandbox = {
    window: window,
    document: document,
    state: state,
    console: console,
    fetch: jest.fn()
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);

  function loadFile(relPath) {
    const fullPath = path.resolve(__dirname, relPath);
    const content = fs.readFileSync(fullPath, 'utf8');
    const cleanContent = content
      .replace(/import\s+[\s\S]*?from\s+['"][^'"]+['"];?/g, '')
      .replace(/export\s+const\s+/g, 'const ')
      .replace(/export\s+let\s+/g, 'let ')
      .replace(/export\s+function\s+/g, 'function ')
      .replace(/export\s+async\s+function\s+/g, 'async function ')
      .replace(/export\s+\{[\s\S]*?\};?/g, '')
      .replace(/export\s+default\s+[\s\S]*?;?/g, '');
    const script = new vm.Script(cleanContent);
    script.runInContext(sandbox);
  }

  return { sandbox, loadFile, state };
}

describe('User Management Settings UI', () => {
  let env;

  beforeEach(() => {
    document.body.innerHTML = `
      <div id="users-status"></div>
      <div id="users-list"></div>
      <button id="refresh-users-btn"></button>
      <button id="settings-tab-users"></button>
    `;

    env = createModuleSandbox();
    env.sandbox.escapeHtml = (str) => str || '';
    env.sandbox.formatTimestamp = (ts) => ts ? 'Just now' : 'Never';

    env.loadFile('../public/js/settings/users.js');
  });

  test('renders visible "Edit Permissions" button for all users and opens access view on click', async () => {
    env.sandbox.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        users: [
          { userId: 'admin-1', email: 'admin@example.com', role: 'admin', created: 1000, lastSeen: 2000 },
          { userId: 'user-2', email: 'reader@example.com', role: 'user', created: 1000, lastSeen: 2000 }
        ]
      })
    });

    await env.sandbox.refreshUsersList();

    const cards = document.querySelectorAll('.user-card');
    expect(cards.length).toBe(2);

    // Verify Admin Card has visible Edit Permissions button
    const adminPermBtn = cards[0].querySelector('.user-permissions-btn');
    expect(adminPermBtn).not.toBeNull();
    expect(adminPermBtn.textContent).toContain('Edit Permissions');

    // Verify Standard User Card has visible Edit Permissions button
    const userPermBtn = cards[1].querySelector('.user-permissions-btn');
    expect(userPermBtn).not.toBeNull();
    expect(userPermBtn.textContent).toContain('Edit Permissions');

    // Verify that ID string is replaced and not rendered in card body
    expect(cards[0].textContent).not.toContain('ID: admin-1');
    expect(cards[1].textContent).not.toContain('ID: user-2');

    // Clicking Edit Permissions button on admin user invokes showUserAccessView
    adminPermBtn.click();
    expect(env.state.showUserAccessView).toHaveBeenCalledWith('admin-1', 'admin@example.com', 'admin');

    // Clicking Edit Permissions button on standard user invokes showUserAccessView
    userPermBtn.click();
    expect(env.state.showUserAccessView).toHaveBeenCalledWith('user-2', 'reader@example.com', 'user');
  });

  test('renders "Login as" button only for non-admin users', async () => {
    env.sandbox.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        users: [
          { userId: 'admin-1', email: 'admin@example.com', role: 'admin', created: 1000, lastSeen: 2000 },
          { userId: 'user-2', email: 'reader@example.com', role: 'user', created: 1000, lastSeen: 2000 }
        ]
      })
    });

    await env.sandbox.refreshUsersList();

    const cards = document.querySelectorAll('.user-card');
    expect(cards[0].querySelector('.user-impersonate-btn')).toBeNull();
    expect(cards[1].querySelector('.user-impersonate-btn')).not.toBeNull();
  });
});
