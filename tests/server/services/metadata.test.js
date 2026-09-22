const fs = require('fs');
const path = require('path');
const os = require('os');
const archiver = require('archiver');

// Mock config module to control metadata storage mode (standard state mock)
jest.mock('../../../server/config', () => ({
  getMetadataStorage: jest.fn(() => 'archive')
}));

const { getMetadataStorage } = require('../../../server/config');
const {
  buildComicInfoXml,
  getComicInfoFromArchive,
  saveMetadataToComic,
  normalizePublisher,
  cleanDescription
} = require('../../../server/services/metadata');

// Utility helper to create a real ZIP archive with internal ComicInfo.xml
function createRealCbzFile(filePath, internalXmlContent) {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(filePath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', resolve);
    archive.on('error', reject);
    archive.pipe(output);

    if (internalXmlContent) {
      archive.append(internalXmlContent, { name: 'ComicInfo.xml' });
    }
    archive.append('mock-image-data-page-1', { name: '001.jpg' });

    archive.finalize();
  });
}

describe('Metadata Service - Real Integration Tests (No Mock filesystem)', () => {
  let tempDir;

  beforeEach(() => {
    jest.clearAllMocks();
    // Create a real temporary folder on disk for each test
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'comics-now-test-'));
  });

  afterEach(() => {
    // Recursively clean up the temp folder on disk
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('normalizePublisher', () => {
    it('should normalize canonical names correctly', () => {
      expect(normalizePublisher('DC')).toBe('DC Comics');
      expect(normalizePublisher('dc')).toBe('DC Comics');
      expect(normalizePublisher('DC Comics')).toBe('DC Comics');
      expect(normalizePublisher('image comics')).toBe('Image');
      expect(normalizePublisher('imagev comics')).toBe('Image');
      expect(normalizePublisher('Image')).toBe('Image');
      expect(normalizePublisher('Oni Press,US')).toBe('Oni Press');
      expect(normalizePublisher('Dark Horse Comics,U.S.')).toBe('Dark Horse Comics');
      expect(normalizePublisher('Boom Studios')).toBe('Boom! Studios');
    });

    it('should match against database codex', () => {
      const codex = ['DC Comics', 'Image', 'Top Shelf', 'Boom! Studios', 'Panini Comics'];
      expect(normalizePublisher('Top Shelf Productions', codex)).toBe('Top Shelf');
      expect(normalizePublisher('Panini', codex)).toBe('Panini Comics');
    });
  });

  describe('cleanDescription', () => {
    it('should strip specification dumps and tables', () => {
      const junkOni = 'Publisher informationPublisher:Oni Press,USISBN:9798894880884Number of pages:240Dimensions:287x196x18mmWeight:970 gLanguage:English';
      expect(cleanDescription(junkOni)).toBe('');

      const junkDh = 'Publisher informationPublisher:Dark Horse Comics,U.S.ISBN:9781506753249Number of pages:88Dimensions:282x220mmLanguage:English';
      expect(cleanDescription(junkDh)).toBe('');
    });

    it('should strip bookstore ads, reviews boilerplates, and placeholders', () => {
      const boilerplate = 'Read reviews and discussion of DC Finest: War – The Big Five Arrive TP from Bill Finger, published by DC Comics';
      expect(cleanDescription(boilerplate)).toBe('');

      const realWithPromo = 'Synopsis: Duncan was the naive son of a minor nobleman. Available now from Waterstones.';
      expect(cleanDescription(realWithPromo)).toBe('Duncan was the naive son of a minor nobleman.');

      expect(cleanDescription('No description available.')).toBe('');
      expect(cleanDescription('No synopsis available.')).toBe('');
      expect(cleanDescription("Why choose Blackwell's? Free UK delivery on orders over £25.")).toBe('');
    });

    it('should discard foreign language descriptions (German, French, Spanish)', () => {
      const germanDesc = 'Der junge Peter Parker wird von einer radioaktiven Spinne gebissen und erhält übermenschliche Kräfte.';
      expect(cleanDescription(germanDesc)).toBe('');

      const frenchDesc = 'Une aventure palpitante où le jeune héros découvre ses pouvoirs et affronte de dangereux ennemis.';
      expect(cleanDescription(frenchDesc)).toBe('');

      const spanishDesc = 'Una historia increíble donde los héroes unen sus fuerzas para salvar el mundo de una terrible amenaza.';
      expect(cleanDescription(spanishDesc)).toBe('');

      const englishDesc = 'Peter Parker gains extraordinary powers after being bitten by a radioactive spider in this classic origin story.';
      expect(cleanDescription(englishDesc)).toBe('Peter Parker gains extraordinary powers after being bitten by a radioactive spider in this classic origin story.');
    });
  });

  describe('isForeignPublisher', () => {
    const { isForeignPublisher } = require('../../../server/services/metadata');
    it('should identify foreign reprint publishers correctly while allowing library publishers', () => {
      expect(isForeignPublisher('Planeta DeAgostini')).toBe(true);
      expect(isForeignPublisher('Editorial Televisa')).toBe(true);
      expect(isForeignPublisher('Editora Abril')).toBe(true);
      expect(isForeignPublisher('ECC Ediciones')).toBe(true);
      expect(isForeignPublisher('Carlsen Verlag')).toBe(true);
      expect(isForeignPublisher('Glénat')).toBe(true);
      expect(isForeignPublisher('Panini Comics')).toBe(true);
      expect(isForeignPublisher('Panini Verlag')).toBe(true);

      // Publishers existing in library are removed from blacklist
      const libraryCodex = ['Cross Cult', 'Delcourt', 'Norma Editorial', 'Splitter'];
      expect(isForeignPublisher('Cross Cult', libraryCodex)).toBe(false);
      expect(isForeignPublisher('Delcourt', libraryCodex)).toBe(false);
      expect(isForeignPublisher('Norma Editorial', libraryCodex)).toBe(false);
      expect(isForeignPublisher('Splitter', libraryCodex)).toBe(false);
      expect(isForeignPublisher('DC Comics')).toBe(false);
      expect(isForeignPublisher('Marvel')).toBe(false);
      expect(isForeignPublisher('Image')).toBe(false);
      expect(isForeignPublisher('Oni Press')).toBe(false);
      expect(isForeignPublisher('Dark Horse Comics')).toBe(false);

      // Codex override test
      const codex = ['Carlsen Verlag', 'Glénat'];
      expect(isForeignPublisher('Carlsen Verlag', codex)).toBe(false);
      expect(isForeignPublisher('Glénat', codex)).toBe(false);
    });
  });

  describe('buildComicInfoXml', () => {
    it('should generate well-formed XML from metadata object with normalized fields', () => {
      const metadata = {
        Series: 'Amazing Spider-Man',
        Number: '1',
        Publisher: 'Marvel Comics',
        Year: '1963',
        Writer: 'Stan Lee',
      };
      const xml = buildComicInfoXml(metadata);
      expect(xml).toContain('<ComicInfo');
      expect(xml).toContain('<Series>Amazing Spider-Man</Series>');
      expect(xml).toContain('<Number>1</Number>');
      expect(xml).toContain('<Publisher>Marvel</Publisher>');
      expect(xml).toContain('<Year>1963</Year>');
      expect(xml).toContain('<Writer>Stan Lee</Writer>');
    });

    it('should return null if metadata object is empty or has no valid tags', () => {
      expect(buildComicInfoXml({})).toBeNull();
      expect(buildComicInfoXml({ InvalidTag: 'value' })).toBeNull();
    });
  });

  describe('getComicInfoFromArchive', () => {
    it('should prioritize reading adjacent .ComicInfo.xml sidecar if it exists', async () => {
      const comicPath = path.join(tempDir, 'spider-man_1.cbz');
      const sidecarPath = path.join(tempDir, 'spider-man_1.ComicInfo.xml');

      // Create a dummy zip file (with nothing inside)
      await createRealCbzFile(comicPath, null);

      // Create the sidecar file adjacent to it
      const sidecarXml = buildComicInfoXml({ Series: 'Amazing Spider-Man (Sidecar)', Number: '1' });
      fs.writeFileSync(sidecarPath, sidecarXml, 'utf-8');

      // Read metadata using the real service
      const metadata = await getComicInfoFromArchive(comicPath);

      expect(metadata.Series).toBe('Amazing Spider-Man (Sidecar)');
      expect(metadata.Number).toBe('1');
    });

    it('should fall back to reading inside archive if sidecar does not exist', async () => {
      const comicPath = path.join(tempDir, 'spider-man_1.cbz');

      // Create a real ZIP archive with internal ComicInfo.xml
      const internalXml = buildComicInfoXml({ Series: 'Spider-Man (Zip Internal)', Number: '2' });
      await createRealCbzFile(comicPath, internalXml);

      // Read metadata using the real service (no sidecar exists on disk)
      const metadata = await getComicInfoFromArchive(comicPath);

      expect(metadata.Series).toBe('Spider-Man (Zip Internal)');
      expect(metadata.Number).toBe('2');
    });

    it('should return empty object if neither sidecar nor internal XML exist', async () => {
      const comicPath = path.join(tempDir, 'spider-man_1.cbz');

      // Create a real ZIP file with no XML
      await createRealCbzFile(comicPath, null);

      const metadata = await getComicInfoFromArchive(comicPath);
      expect(metadata).toEqual({});
    });
  });

  describe('saveMetadataToComic', () => {
    it('should write to adjacent .ComicInfo.xml when in sidecar mode', async () => {
      getMetadataStorage.mockReturnValue('sidecar');
      
      const comicPath = path.join(tempDir, 'spider-man_1.cbz');
      const sidecarPath = path.join(tempDir, 'spider-man_1.ComicInfo.xml');

      // Create CBZ file
      await createRealCbzFile(comicPath, null);

      const metadata = { Series: 'Amazing Spider-Man', Number: '1' };

      // Save metadata
      await saveMetadataToComic(comicPath, metadata);

      // Verify sidecar file was written to disk
      expect(fs.existsSync(sidecarPath)).toBe(true);

      const writtenXml = fs.readFileSync(sidecarPath, 'utf-8');
      expect(writtenXml).toContain('<Series>Amazing Spider-Man</Series>');
      expect(writtenXml).toContain('<Number>1</Number>');
    });

    it('should skip disk writes entirely in db-only mode', async () => {
      getMetadataStorage.mockReturnValue('db');

      const comicPath = path.join(tempDir, 'spider-man_1.cbz');
      const sidecarPath = path.join(tempDir, 'spider-man_1.ComicInfo.xml');

      await createRealCbzFile(comicPath, null);

      const metadata = { Series: 'Amazing Spider-Man' };
      await saveMetadataToComic(comicPath, metadata);

      // Verify sidecar file does not exist
      expect(fs.existsSync(sidecarPath)).toBe(false);

      // Verify zip file wasn't altered to include ComicInfo.xml
      const parsed = await getComicInfoFromArchive(comicPath);
      expect(parsed).toEqual({});
    });

    it('should write to internal archive when in archive mode and file is CBZ', async () => {
      getMetadataStorage.mockReturnValue('archive');

      const comicPath = path.join(tempDir, 'spider-man_1.cbz');

      // Create a real ZIP archive with no XML
      await createRealCbzFile(comicPath, null);

      const metadata = { Series: 'Amazing Spider-Man Internal', Number: '10' };

      // Save metadata (re-packs the zip archive on disk)
      await saveMetadataToComic(comicPath, metadata);

      // Verify that the metadata was written inside the archive by reading it back
      const parsed = await getComicInfoFromArchive(comicPath);
      expect(parsed.Series).toBe('Amazing Spider-Man Internal');
      expect(parsed.Number).toBe('10');
    });

    it('should skip zip writing for CBR files in archive mode', async () => {
      getMetadataStorage.mockReturnValue('archive');

      // CBR file extension
      const comicPath = path.join(tempDir, 'spider-man_1.cbr');

      // Create a dummy file on disk
      fs.writeFileSync(comicPath, 'dummy-cbr-data');

      const metadata = { Series: 'Amazing Spider-Man CBR' };

      // This should return without error and not touch the file
      await saveMetadataToComic(comicPath, metadata);

      const content = fs.readFileSync(comicPath, 'utf-8');
      expect(content).toBe('dummy-cbr-data');
    });

    it('should skip save if metadata object is empty', async () => {
      getMetadataStorage.mockReturnValue('sidecar');
      const comicPath = path.join(tempDir, 'spider-man_empty.cbz');
      await createRealCbzFile(comicPath, null);

      const { getLogs } = require('../../../server/logger');
      const beforeCount = getLogs().length;

      await saveMetadataToComic(comicPath, {});

      // Verify sidecar file does not exist
      const sidecarPath = path.join(tempDir, 'spider-man_empty.ComicInfo.xml');
      expect(fs.existsSync(sidecarPath)).toBe(false);

      const logsAfter = getLogs().slice(beforeCount);
      const hasLog = logsAfter.some(l => l.level === 'INFO' && l.category === 'META' && l.message.includes('No valid metadata'));
      expect(hasLog).toBe(true);
    });

    it('should log an error if save fails due to invalid/read-only path', async () => {
      getMetadataStorage.mockReturnValue('sidecar');
      // Using an invalid directory path to trigger write error
      const comicPath = '/invalid-dir-123/spider-man_1.cbz';

      const { getLogs } = require('../../../server/logger');
      const beforeCount = getLogs().length;

      await saveMetadataToComic(comicPath, { Series: 'Spider-Man' });

      const logsAfter = getLogs().slice(beforeCount);
      const hasLog = logsAfter.some(l => l.level === 'ERROR' && l.category === 'META' && l.message.includes('ComicInfo write-back failed'));
      expect(hasLog).toBe(true);
    });
  });
});
