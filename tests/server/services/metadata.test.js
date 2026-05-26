const { buildComicInfoXml } = require('../../../server/services/metadata');
const xml2js = require('xml2js');

describe('Metadata Service - buildComicInfoXml', () => {
  it('should map Year and StartYear to separate XML tags without overwriting', async () => {
    const metadata = {
      Title: 'Amazing Spider-Man #1',
      Year: '2021',
      StartYear: '1963'
    };

    const xmlString = buildComicInfoXml(metadata);
    expect(xmlString).not.toBeNull();

    // Parse the generated XML back to an object to verify tags are distinct and correct
    const parser = new xml2js.Parser({ explicitArray: false });
    const parsed = await parser.parseStringPromise(xmlString);

    expect(parsed.ComicInfo).toBeDefined();
    expect(parsed.ComicInfo.Title).toBe('Amazing Spider-Man #1');
    expect(parsed.ComicInfo.Year).toBe('2021');
    expect(parsed.ComicInfo.StartYear).toBe('1963');
  });

  it('should ignore unrecognized metadata keys', async () => {
    const metadata = {
      Title: 'Batman #1',
      FakeKey: 'ShouldNotBeIncluded'
    };

    const xmlString = buildComicInfoXml(metadata);
    expect(xmlString).not.toBeNull();

    const parser = new xml2js.Parser({ explicitArray: false });
    const parsed = await parser.parseStringPromise(xmlString);

    expect(parsed.ComicInfo.Title).toBe('Batman #1');
    expect(parsed.ComicInfo.FakeKey).toBeUndefined();
  });

  it('should return null when metadata is empty or has no valid keys', () => {
    expect(buildComicInfoXml({})).toBeNull();
    expect(buildComicInfoXml({ FakeKey: 'Value' })).toBeNull();
    expect(buildComicInfoXml(null)).toBeNull();
  });
});
