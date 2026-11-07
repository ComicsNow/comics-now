/**
 * @jest-environment jsdom
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

describe('Series Continuity Strip UI', () => {
  let sandbox;

  beforeEach(() => {
    document.body.innerHTML = `
      <div id="comic-list-view">
        <div id="series-continuity-container"></div>
        <div id="comic-list-container"></div>
      </div>
    `;

    const state = {
      API_BASE_URL: 'http://localhost:3000',
      currentPublisher: 'DC Comics'
    };

    sandbox = {
      window,
      document,
      console,
      state,
      escapeHtml: str => String(str || '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])),
      showStoryArcDetail: jest.fn(),
      fetch: jest.fn().mockImplementation((url) => {
        if (url.includes('/api/v1/story-arcs?publisher=DC%20Comics')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              ok: true,
              storyArcs: [
                {
                  id: 'court-of-owls',
                  title: 'Batman: The Court of Owls',
                  publisher: 'DC Comics',
                  totalIssues: 7
                }
              ]
            })
          });
        }
        return Promise.resolve({ ok: false });
      })
    };

    vm.createContext(sandbox);

    const filePath = path.resolve(__dirname, '../public/js/library/render/series-continuity.js');
    const content = fs.readFileSync(filePath, 'utf8')
      .replace(/^\s*import\s+[\s\S]*?from\s+['"][^'"]+['"];?/gm, '')
      .replace(/^\s*import\s+['"][^'"]+['"];?/gm, '')
      .replace(/export\s+const\s+/g, 'const ')
      .replace(/export\s+let\s+/g, 'let ')
      .replace(/export\s+function\s+/g, 'function ')
      .replace(/export\s+async\s+function\s+/g, 'async function ')
      .replace(/export\s+\{[\s\S]*?\};?/g, '')
      .replace(/export\s+default\s+[\s\S]*?;?/g, '');

    vm.runInContext(content, sandbox);
  });

  test('renderSeriesContinuityStrip renders arc pills and handles click', async () => {
    await sandbox.renderSeriesContinuityStrip('Batman', 'DC Comics');

    const strip = document.getElementById('series-continuity-strip');
    expect(strip).not.toBeNull();
    expect(strip.textContent).toContain('Batman: The Court of Owls');

    const pill = strip.querySelector('.series-arc-pill');
    expect(pill).not.toBeNull();
    pill.click();

    expect(sandbox.showStoryArcDetail).toHaveBeenCalledWith('court-of-owls', 'Batman: The Court of Owls', 'grid');
  });
});
