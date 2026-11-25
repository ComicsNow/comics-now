'use strict';

const path = require('path');
const sanitizer = require('../../../server/services/logos/sanitizer');

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_BYTES = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff]),
  Buffer.alloc(16, 0x00),
]);
const WEBP_BYTES = Buffer.concat([
  Buffer.from('RIFF', 'ascii'),
  Buffer.from([0x04, 0x00, 0x00, 0x00]),
  Buffer.from('WEBP', 'ascii'),
  Buffer.alloc(8, 0x00),
]);

function resultMime(result) {
  return result.mimeType || result.detectedMime || result.mime || result.type;
}

describe('logos/sanitizer magic-byte verification', () => {
  it('accepts a valid PNG header', () => {
    const result = sanitizer.validateMagicBytes(PNG_BYTES, '.png');
    expect(result.ok).toBe(true);
    const mime = resultMime(result);
    if (mime) expect(mime).toBe('image/png');
  });

  it('accepts a valid JPEG header', () => {
    const result = sanitizer.validateMagicBytes(JPEG_BYTES, '.jpg');
    expect(result.ok).toBe(true);
    const mime = resultMime(result);
    if (mime) expect(mime).toBe('image/jpeg');
  });

  it('accepts a valid WebP RIFF/WEBP header', () => {
    const result = sanitizer.validateMagicBytes(WEBP_BYTES, '.webp');
    expect(result.ok).toBe(true);
    const mime = resultMime(result);
    if (mime) expect(mime).toBe('image/webp');
  });

  it('accepts valid GIF headers (GIF87a and GIF89a)', () => {
    const gif87 = Buffer.from('GIF87a-payload');
    const gif89 = Buffer.from('GIF89a-payload');
    expect(sanitizer.validateMagicBytes(gif87, '.gif').ok).toBe(true);
    expect(sanitizer.validateMagicBytes(gif89, '.gif').ok).toBe(true);
  });

  it('sniffs real image formats from buffer regardless of extension', () => {
    expect(sanitizer.sniffImageFormat(PNG_BYTES)).toEqual({ ext: '.png', mimeType: 'image/png' });
    expect(sanitizer.sniffImageFormat(JPEG_BYTES)).toEqual({ ext: '.jpg', mimeType: 'image/jpeg' });
    expect(sanitizer.sniffImageFormat(WEBP_BYTES)).toEqual({ ext: '.webp', mimeType: 'image/webp' });
    expect(sanitizer.sniffImageFormat(Buffer.from('GIF89a123'))).toEqual({ ext: '.gif', mimeType: 'image/gif' });
    expect(sanitizer.sniffImageFormat(Buffer.from('<svg></svg>'))).toEqual({ ext: '.svg', mimeType: 'image/svg+xml' });
  });

  it.each([
    ['text without <svg', Buffer.from('<div>no svg here</div>', 'utf8'), '.svg'],
    ['binary content', Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]), '.svg'],
    ['empty buffer', Buffer.alloc(0), '.svg'],
  ])('rejects fake SVG: %s', (_, buffer, extension) => {
    const result = sanitizer.validateMagicBytes(buffer, extension);
    expect(result.ok).toBe(false);
    expect(result.reason || result.error || result.message).toBeTruthy();
  });

  it('rejects mismatched extension and magic bytes', () => {
    const result = sanitizer.validateMagicBytes(PNG_BYTES, '.jpg');
    expect(result.ok).toBe(false);
  });
});

describe('logos/sanitizer SVG XSS sanitization', () => {
  const dirtySvg = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE svg [
  <!ENTITY xxe SYSTEM "file:///etc/passwd">
  <!ENTITY internal "<!ENTITY nested SYSTEM 'data:text/plain,boom'>">
]>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
     onload="alert('onload')" onerror="alert('onerror')" onclick="steal()">
  <script>alert('script')</script>
  <foreignObject><iframe src="javascript:alert('iframe')"></iframe></foreignObject>
  <a xlink:href="java&#x09;script:alert('encoded-entity')" href=" javascript:alert('space')">click</a>
  <a xlink:href="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==">data</a>
  <image href="data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9ImFsZXJ0KDEpIiAvPg=="/>
  <use href="file:///etc/passwd"/>
  <line stroke="javascript:alert(1)"/>
</svg>`;

  it('strips script elements', () => {
    const clean = sanitizer.sanitizeSvg(dirtySvg);
    expect(clean).not.toContain('<script');
    expect(clean).not.toMatch(/<script[\s>]/i);
  });

  it('strips foreignObject elements', () => {
    const clean = sanitizer.sanitizeSvg(dirtySvg);
    expect(clean).not.toContain('foreignObject');
    expect(clean).not.toContain('<iframe');
  });

  it('removes on* event handlers including onload and onerror', () => {
    const clean = sanitizer.sanitizeSvg(dirtySvg);
    expect(clean).not.toMatch(/on(load|error|click)\s*=/i);
    expect(clean).not.toMatch(/on[a-z]+\s*=/i);
  });

  it('removes javascript: URIs including whitespace and entity-encoded forms', () => {
    const clean = sanitizer.sanitizeSvg(dirtySvg);
    expect(clean).not.toMatch(/javascript\s*:/i);
    expect(clean).not.toMatch(/java[\s\0-\x20]*script\s*:/i);
    expect(clean).not.toMatch(/&#x?0*9;?\s*script\s*:/i);
  });

  it('removes data: URIs', () => {
    const clean = sanitizer.sanitizeSvg(dirtySvg);
    expect(clean).not.toMatch(/data\s*:/i);
  });

  it('removes DOCTYPE and ENTITY declarations', () => {
    const clean = sanitizer.sanitizeSvg(dirtySvg);
    expect(clean).not.toContain('<!DOCTYPE');
    expect(clean).not.toContain('<!ENTITY');
    expect(clean).not.toContain('SYSTEM');
  });

  it('recursively removes nested script tags and SMIL animation tags', () => {
    const nested = '<svg><scr<script>ipt>alert(1)</scr</script>ipt><animate attributeName="href" values="javascript:alert(2)"/><text>clean</text></svg>';
    const clean = sanitizer.sanitizeSvg(nested);
    expect(clean).not.toContain('<script');
    expect(clean).not.toContain('alert(1)');
    expect(clean).not.toContain('<animate');
    expect(clean).toContain('<text>clean</text>');
  });

  it('strips javascript URLs containing control characters', () => {
    const evil = '<svg><a href="\x01\x02javascript:alert(1)"><text>link</text></a></svg>';
    const clean = sanitizer.sanitizeSvg(evil);
    expect(clean).not.toContain('javascript:');
  });

  it('preserves an SVG root element', () => {
    const clean = sanitizer.sanitizeSvg(dirtySvg);
    expect(clean).toContain('<svg');
  });
});

describe('logos/sanitizer path traversal guards', () => {
  const baseDir = path.join('/', 'srv', 'comics-now', 'logos');

  it('returns a safe absolute path for a normal relative filename', () => {
    const result = sanitizer.resolveSafeLogoPath(baseDir, 'marvel.png');
    expect(result).toBe(path.join(baseDir, 'marvel.png'));
  });

  it.each([
    ['../evil.png', 'dot-dot traversal'],
    ['../../evil.png', 'nested dot-dot'],
    ['..', 'bare dot-dot'],
    ['a\\..\\b.png', 'backslash traversal'],
    ['/etc/passwd', 'absolute path'],
    ['a\0b.png', 'null byte'],
    ['%2e%2e%2fevil.png', 'URL-encoded traversal'],
  ])('rejects %s (%s)', (input) => {
    expect(() => sanitizer.resolveSafeLogoPath(baseDir, input)).toThrow();
  });
});
