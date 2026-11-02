const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadModuleInVm(relPath, sandbox) {
  const fullPath = path.resolve(__dirname, '../../..', relPath);
  const content = fs.readFileSync(fullPath, 'utf8');

  const cleanContent = content
    .replace(/import\s+[\s\S]*?from\s+['"][^'"]+['"];?/g, '')
    .replace(/export\s+class\s+([a-zA-Z0-9_$]+)/g, 'globalThis.$1 = class $1')
    .replace(/export\s+function\s+([a-zA-Z0-9_$]+)/g, 'globalThis.$1 = function $1')
    .replace(/export\s+async\s+function\s+([a-zA-Z0-9_$]+)/g, 'globalThis.$1 = async function $1')
    .replace(/export\s+const\s+([a-zA-Z0-9_$]+)\s*=/g, 'globalThis.$1 =')
    .replace(/export\s+let\s+([a-zA-Z0-9_$]+)\s*=/g, 'globalThis.$1 =')
    .replace(/export\s+\{[\s\S]*?\};?/g, '')
    .replace(/export\s+default\s+[\s\S]*?;?/g, '');

  const script = new vm.Script(cleanContent);
  script.runInContext(sandbox);
}

describe('Declarative Tagged Template Engine (Phase 1)', () => {
  let sandbox;

  beforeEach(() => {
    sandbox = {
      console: {
        log: jest.fn(),
        warn: jest.fn(),
        error: jest.fn()
      },
      escapeHtml: (value) => {
        if (value === null || value === undefined) return '';
        return String(value)
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#39;');
      },
      document: {
        createElement: jest.fn(tag => ({
          tagName: tag.toUpperCase(),
          className: '',
          innerHTML: '',
          replaceChildren: jest.fn(function (...args) {
            this.innerHTML = '';
          })
        }))
      },
      Date,
      Error,
      Map,
      Set,
      Array,
      Object,
      String,
      Number,
      Boolean,
      Math,
      Reflect,
      Proxy
    };
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
  });

  describe('html tagged template', () => {
    beforeEach(() => {
      loadModuleInVm('public/js/ui/template.js', sandbox);
    });

    it('interpolates safe strings and numbers without escaping normal text', () => {
      const { html } = sandbox;
      const title = 'Batman Year One';
      const issue = 1;
      const res = html`<div class="comic-card"><h3>${title}</h3><span>#${issue}</span></div>`;

      expect(res.toHTML()).toBe(
        '<div class="comic-card"><h3>Batman Year One</h3><span>#1</span></div>'
      );
    });

    it('automatically sanitizes dangerous HTML characters to prevent XSS', () => {
      const { html } = sandbox;
      const malicious = '<script>alert("xss")</script>&"\'';
      const res = html`<p>${malicious}</p>`;

      expect(res.toHTML()).toBe(
        '<p>&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;&amp;&quot;&#39;</p>'
      );
    });

    it('handles null and undefined values as empty strings', () => {
      const { html } = sandbox;
      const res = html`<span>${null}</span><b>${undefined}</b>`;

      expect(res.toHTML()).toBe('<span></span><b></b>');
    });

    it('flattens nested html TemplateResults without double escaping', () => {
      const { html } = sandbox;
      const inner = html`<strong>Bold &amp; Beautiful</strong>`;
      const outer = html`<div>${inner}</div>`;

      expect(outer.toHTML()).toBe('<div><strong>Bold &amp; Beautiful</strong></div>');
    });

    it('flattens arrays of TemplateResults and values', () => {
      const { html } = sandbox;
      const items = ['Spider-Man', 'X-Men', 'Iron Man'];
      const res = html`<ul>${items.map(name => html`<li>${name}</li>`)}</ul>`;

      expect(res.toHTML()).toBe(
        '<ul><li>Spider-Man</li><li>X-Men</li><li>Iron Man</li></ul>'
      );
    });
  });

  describe('raw helper', () => {
    beforeEach(() => {
      loadModuleInVm('public/js/ui/template.js', sandbox);
    });

    it('bypasses escaping for trusted markup or SVG icons', () => {
      const { html, raw } = sandbox;
      const trustedSvg = '<svg viewBox="0 0 24 24"><path d="M5 13l4 4L19 7"/></svg>';
      const res = html`<button>${raw(trustedSvg)} Submit</button>`;

      expect(res.toHTML()).toBe(
        '<button><svg viewBox="0 0 24 24"><path d="M5 13l4 4L19 7"/></svg> Submit</button>'
      );
    });
  });

  describe('clearElement helper', () => {
    beforeEach(() => {
      loadModuleInVm('public/js/ui/template.js', sandbox);
    });

    it('uses replaceChildren if available on the element', () => {
      const { clearElement } = sandbox;
      const el = {
        innerHTML: '<span>content</span>',
        replaceChildren: jest.fn(function () {
          this.innerHTML = '';
        })
      };

      clearElement(el);
      expect(el.replaceChildren).toHaveBeenCalled();
      expect(el.innerHTML).toBe('');
    });

    it('falls back to innerHTML = "" if replaceChildren is absent', () => {
      const { clearElement } = sandbox;
      const el = { innerHTML: '<span>content</span>' };

      clearElement(el);
      expect(el.innerHTML).toBe('');
    });

    it('safely ignores null or undefined element', () => {
      const { clearElement } = sandbox;
      expect(() => clearElement(null)).not.toThrow();
      expect(() => clearElement(undefined)).not.toThrow();
    });
  });

  describe('render helper', () => {
    beforeEach(() => {
      loadModuleInVm('public/js/ui/template.js', sandbox);
    });

    it('renders a TemplateResult into a container element', () => {
      const { html, render } = sandbox;
      const container = { innerHTML: '' };
      const template = html`<div class="chip">Tag: ${'Action <&> Adventure'}</div>`;

      render(container, template);
      expect(container.innerHTML).toBe(
        '<div class="chip">Tag: Action &lt;&amp;&gt; Adventure</div>'
      );
    });

    it('clears the container when passed null, undefined, or empty string', () => {
      const { render } = sandbox;
      const container = {
        innerHTML: '<div>old</div>',
        replaceChildren: jest.fn(function () {
          this.innerHTML = '';
        })
      };

      render(container, null);
      expect(container.innerHTML).toBe('');

      container.innerHTML = '<div>old2</div>';
      render(container, '');
      expect(container.innerHTML).toBe('');
    });

    it('safely accepts raw strings for backward compatibility', () => {
      const { render } = sandbox;
      const container = { innerHTML: '' };

      render(container, '<p>Legacy HTML String</p>');
      expect(container.innerHTML).toBe('<p>Legacy HTML String</p>');
    });

    it('safely ignores null or undefined container', () => {
      const { html, render } = sandbox;
      expect(() => render(null, html`<p>test</p>`)).not.toThrow();
    });

    it('renders an array of TemplateResults without inserting commas between items', () => {
      const { html, render } = sandbox;
      const container = { innerHTML: '' };
      const rows = [
        html`<div class="log-entry">Log 1</div>`,
        html`<div class="log-entry">Log 2</div>`
      ];

      render(container, rows);
      expect(container.innerHTML).toBe(
        '<div class="log-entry">Log 1</div><div class="log-entry">Log 2</div>'
      );
      expect(container.innerHTML).not.toContain('</div>,<div');
    });
  });

  describe('icons helper', () => {
    beforeEach(() => {
      loadModuleInVm('public/js/ui/template.js', sandbox);
      loadModuleInVm('public/js/ui/icons.js', sandbox);
    });

    it('returns SVG string with custom className option', () => {
      const { getIconSvg } = sandbox;
      const svg = getIconSvg('READ', { className: 'w-5 h-5 text-purple-400' });

      expect(svg).toContain('class="w-5 h-5 text-purple-400"');
      expect(svg).toContain('<svg');
    });

    it('rawIcon integrates cleanly into html template without escaping', () => {
      const { html, rawIcon } = sandbox;
      const res = html`<span class="icon-wrap">${rawIcon('CHECK')}</span>`;

      expect(res.toHTML()).toContain('<svg');
      expect(res.toHTML()).not.toContain('&lt;svg');
    });

    it('renderIcon sets icon SVG on target element', () => {
      const { renderIcon } = sandbox;
      const btn = { innerHTML: '' };

      renderIcon(btn, 'SPINNER', { className: 'w-4 h-4 text-white animate-spin' });
      expect(btn.innerHTML).toContain('class="w-4 h-4 text-white animate-spin"');
      expect(btn.innerHTML).toContain('<svg');
    });
  });
});
