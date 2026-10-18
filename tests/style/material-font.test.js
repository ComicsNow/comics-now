const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const HTML_PATH = path.join(ROOT, 'public', 'index.html');
const CSS_PATH = path.join(ROOT, 'public', 'style.css');
const SERVER_PATH = path.join(ROOT, 'server.js');

describe('Material Design Typography (Roboto & Non-blocking Font Loading)', () => {
  let html;
  let css;
  let server;

  beforeAll(() => {
    html = fs.readFileSync(HTML_PATH, 'utf8');
    css = fs.readFileSync(CSS_PATH, 'utf8');
    server = fs.readFileSync(SERVER_PATH, 'utf8');
  });

  it('imports Roboto and Roboto Mono in public/index.html', () => {
    expect(html).toMatch(/fonts\.googleapis\.com\/css2\?[^"']*family=Roboto/);
    expect(html).toMatch(/Roboto\+Mono/);
  });

  it('configures Material Design recommended typography in public/style.css tokens with system fallbacks', () => {
    expect(css).toMatch(/--font-body:[^;]*Roboto/);
    expect(css).toMatch(/--font-display:[^;]*Roboto/);
    expect(css).toMatch(/--font-mono:[^;]*Roboto Mono/);
  });

  it('applies Material Design font-body to document body', () => {
    expect(css).toMatch(/body\s*\{[^}]*font-family:[^;]*(?:var\(--font-body\)|'Roboto'|Roboto)/);
  });

  it('allows Google Fonts domains in Content-Security-Policy to prevent blocking or timeouts', () => {
    expect(server).toMatch(/"style-src":\s*\[[^\]]*fonts\.googleapis\.com/);
    expect(server).toMatch(/"font-src":\s*\[[^\]]*fonts\.gstatic\.com/);
  });
});
