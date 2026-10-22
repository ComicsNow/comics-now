const fs = require('fs');
const path = require('path');

describe('System-Agnostic UI Copy', () => {
  const indexHtmlPath = path.resolve(__dirname, '../public/index.html');
  const taggerHtmlPath = path.resolve(__dirname, '../tagger/templates/index.html');

  test('public/index.html uses hardware-agnostic host CPU phrasing without Raspberry Pi hardcoding', () => {
    const html = fs.readFileSync(indexHtmlPath, 'utf8');
    expect(html).not.toMatch(/Raspberry\s*Pi/i);
    expect(html).toMatch(/capping host CPU usage/i);
  });

  test('tagger/templates/index.html uses hardware-agnostic phrasing without Raspberry Pi hardcoding', () => {
    const html = fs.readFileSync(taggerHtmlPath, 'utf8');
    expect(html).not.toMatch(/recommended for Raspberry Pi/i);
    expect(html).toMatch(/recommended for low-power devices/i);
  });
});
