const fs = require('fs');
const path = require('path');

describe('Archive conversion script security hardening [C-1]', () => {
  const cbrScriptPath = path.resolve(__dirname, '../../scripts/convert_cbr_to_cbz.sh');
  const pdfScriptPath = path.resolve(__dirname, '../../scripts/pdf2cbz.sh');

  let cbrScript;
  let pdfScript;

  beforeAll(() => {
    cbrScript = fs.readFileSync(cbrScriptPath, 'utf8');
    pdfScript = fs.readFileSync(pdfScriptPath, 'utf8');
  });

  describe('convert_cbr_to_cbz.sh', () => {
    it('prevents unrar from extracting symbolic links (-ol-) and terminates options with --', () => {
      expect(cbrScript).toMatch(/unrar\s+x\s+[^\n]*-ol-[^\n]*--\s+"\$cbr_file"/);
    });

    it('deletes any symbolic links in temp_dir before running zip', () => {
      const findIdx = cbrScript.indexOf('find "$temp_dir" -type l -delete');
      const zipIdx = cbrScript.indexOf('zip -0');
      expect(findIdx).toBeGreaterThan(-1);
      expect(zipIdx).toBeGreaterThan(findIdx);
    });

    it('runs zip with -y (do not dereference symlinks) and safe ../ archive prefix without -- before archive name', () => {
      expect(cbrScript).toMatch(/zip\s+-0\s+-r\s+-q\s+-y\s+"\.\.\/\$cbz_file"\s+\./);
      expect(cbrScript).not.toMatch(/zip\s+[^\n]*--\s+"\.\.\/\$cbz_file"/);
    });

    it('terminates options with -- on basename and rm commands', () => {
      expect(cbrScript).toMatch(/basename\s+--\s+"\$cbr_file"/);
      expect(cbrScript).toMatch(/rm\s+-f\s+--\s+"\$cbr_file"/);
      expect(cbrScript).toMatch(/rm\s+-rf\s+--\s+"\$temp_dir"/);
    });
  });

  describe('pdf2cbz.sh', () => {
    it('terminates options with -- on basename, pdftoppm, zip (-y with ./ prefix and -- after archive), and rm commands', () => {
      expect(pdfScript).toMatch(/basename\s+--\s+"\$INPUT_PDF"/);
      expect(pdfScript).toMatch(/pdftoppm\s+[^\n]*--\s+"\$INPUT_PDF"/);
      expect(pdfScript).toMatch(/zip\s+-j\s+-y\s+"\.\/\$OUTPUT_CBZ"\s+--/);
      expect(pdfScript).toMatch(/rm\s+-f\s+--\s+"\$INPUT_PDF"/);
    });
  });
});
