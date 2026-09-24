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

  test('ensures email wrapping and role pill positioning prevent card overflow on small screens', async () => {
    env.sandbox.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        users: [
          { userId: 'user-long', email: 'an.exceptionally.long.email.address.that.would.overflow@somedomain.example.com', role: 'user', created: 1000, lastSeen: 2000 }
        ]
      })
    });

    await env.sandbox.refreshUsersList();

    const card = document.querySelector('.user-card');
    expect(card).not.toBeNull();

    // Verify email container has break-all and leading-snug to prevent horizontal blowout
    const emailSpan = card.querySelector('span.break-all');
    expect(emailSpan).not.toBeNull();
    expect(emailSpan.textContent).toBe('an.exceptionally.long.email.address.that.would.overflow@somedomain.example.com');
    expect(emailSpan.className).toContain('leading-snug');

    // Verify role badge has flex-shrink-0 and ml-auto to stay neatly inside the card boundary
    const roleBadge = card.querySelector('span.rounded-full');
    expect(roleBadge).not.toBeNull();
    expect(roleBadge.className).toContain('flex-shrink-0');
    expect(roleBadge.className).toContain('ml-auto');

    // Verify header row has min-w-0 flex container
    const headerRow = card.querySelector('.flex.items-start.justify-between');
    expect(headerRow).not.toBeNull();
    expect(headerRow.className).toContain('min-w-0');
  });

  test('renders user access view with overflow protection and avoids display font h3 tag', async () => {
    const accessEnv = createModuleSandbox();
    accessEnv.sandbox.escapeHtml = (str) => str || '';
    accessEnv.sandbox.formatTimestamp = (ts) => ts ? 'Just now' : 'Never';
    accessEnv.sandbox.fetch = jest.fn().mockImplementation((url) => {
      if (url.includes('/library-tree')) {
        return Promise.resolve({ ok: true, json: async () => ({ tree: {} }) });
      }
      return Promise.resolve({ ok: true, json: async () => ({ access: [] }) });
    });

    const parentDiv = document.createElement('div');
    const usersListDiv = document.createElement('div');
    usersListDiv.id = 'users-list';
    parentDiv.appendChild(usersListDiv);
    document.body.appendChild(parentDiv);

    accessEnv.sandbox.state.usersListDiv = usersListDiv;
    accessEnv.loadFile('../public/js/settings/user-access.js');

    await accessEnv.sandbox.showUserAccessView('user-long', 'user.with.very.long.email@corporate-domain.co.uk', 'user');

    const accessView = document.getElementById('user-access-view');
    expect(accessView).not.toBeNull();

    // Verify it does NOT use an h3 tag (which is overridden by #settings-modal h3 24px uppercase)
    expect(accessView.querySelector('h3')).toBeNull();

    // Verify it uses .user-access-title with break-all and leading-snug
    const titleEl = accessView.querySelector('.user-access-title');
    expect(titleEl).not.toBeNull();
    expect(titleEl.className).toContain('break-all');
    expect(titleEl.className).toContain('leading-snug');

    // Verify email span inside title also has break-all
    const emailSpan = titleEl.querySelector('span');
    expect(emailSpan).not.toBeNull();
    expect(emailSpan.className).toContain('break-all');
    expect(emailSpan.textContent).toContain('user.with.very.long.email@corporate-domain.co.uk');
  });

  test('verifies public/style.css defines .user-access-title to override uppercase display font and enforce word-break', () => {
    const cssPath = path.resolve(__dirname, '../public/style.css');
    const css = fs.readFileSync(cssPath, 'utf8');

    expect(css).toContain('.user-access-title');
    expect(css).toMatch(/#settings-modal\s+(?:#user-access-view\s+)?\.user-access-title/);
    expect(css).toContain('word-break: break-all !important');
    expect(css).toContain('overflow-wrap: anywhere !important');
    expect(css).toContain('text-transform: none !important');
  });

  test('verifies public/dist contains valid production bundle when present', () => {
    const distHtmlPath = path.resolve(__dirname, '../public/dist/index.html');
    if (fs.existsSync(distHtmlPath)) {
      const distHtml = fs.readFileSync(distHtmlPath, 'utf8');
      expect(distHtml).toContain('id="settings-modal"');
      expect(distHtml).toMatch(/assets\/index-[A-Za-z0-9_-]+\.js/);
      expect(distHtml).toMatch(/assets\/index-[A-Za-z0-9_-]+\.css/);
    }
  });
});
