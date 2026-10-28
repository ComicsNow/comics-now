const fs = require('fs');
const path = require('path');
const vm = require('vm');

describe('Comic Cards & Viewer Display Titles Rule', () => {
  let buildComicDisplayInfo;
  let applyDisplayInfoToComic;

  beforeAll(() => {
    const globalsPath = path.resolve(__dirname, '..', 'public', 'js', 'globals.js');
    let code = fs.readFileSync(globalsPath, 'utf8');
    // Strip export keywords for vm execution
    code = code.replace(/export\s+(async\s+)?(function|const|let|var)\s+/g, '$1$2 ');
    code = code.replace(/export\s+\{[^}]*\};?/g, '');

    const sandbox = {
      window: {},
      document: { getElementById: () => null },
      console,
      state: {}
    };
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    new vm.Script(code).runInContext(sandbox);

    buildComicDisplayInfo = sandbox.buildComicDisplayInfo;
    applyDisplayInfoToComic = sandbox.applyDisplayInfoToComic;
  });

  test('Series with issue number goes on Line 1 (displayTitle), and filename is NEVER on Line 2 (subtitle)', () => {
    const comic = {
      id: 'comic-1',
      name: 'Batman 001 (2024) (Digital) (Zone-Empire).cbz',
      series: 'Batman',
      metadata: {
        Series: 'Batman',
        Number: '1'
      }
    };

    const info = buildComicDisplayInfo(comic);
    expect(info.displayTitle).toBe('Batman #1');
    // Filename must NOT appear as subtitle!
    expect(info.subtitle).toBe('');
  });

  test('If a distinct story title exists, it goes on Line 2 (subtitle)', () => {
    const comic = {
      id: 'comic-2',
      name: 'Batman 001.cbz',
      series: 'Batman',
      metadata: {
        Series: 'Batman',
        Number: '1',
        Title: 'The Court of Owls'
      }
    };

    const info = buildComicDisplayInfo(comic);
    expect(info.displayTitle).toBe('Batman #1');
    expect(info.subtitle).toBe('The Court of Owls');
  });

  test('If title matches series or issue, subtitle is blanked (no redundant line 2 or filename fallback)', () => {
    const comic = {
      id: 'comic-3',
      name: 'Action Comics 1050 (2022).cbz',
      series: 'Action Comics',
      metadata: {
        Series: 'Action Comics',
        Number: '1050',
        Title: 'Action Comics #1050'
      }
    };

    const info = buildComicDisplayInfo(comic);
    expect(info.displayTitle).toBe('Action Comics #1050');
    expect(info.subtitle).toBe('');
  });

  test('Untagged comic falls back to clean name on Line 1, but Line 2 is empty', () => {
    const comic = {
      id: 'comic-4',
      name: 'Detective Comics #27 [Scanner].cbz',
      series: 'Unknown Series',
      metadata: {}
    };

    const info = buildComicDisplayInfo(comic);
    expect(info.displayTitle).toBe('Detective Comics #27');
    expect(info.subtitle).toBe('');
  });

  test('Parses stringified metadata correctly if metadata is JSON string', () => {
    const comic = {
      id: 'comic-5',
      name: 'Nightwing 100.cbz',
      series: 'Nightwing',
      metadata: JSON.stringify({
        Series: 'Nightwing',
        Number: '100',
        Title: 'The Battle for Bludhaven'
      })
    };

    const info = buildComicDisplayInfo(comic);
    expect(info.displayTitle).toBe('Nightwing #100');
    expect(info.subtitle).toBe('The Battle for Bludhaven');
  });

  test('Shows volume and part titles on Line 2 (subtitle) without suppressing them as redundant', () => {
    const comicVol1 = {
      id: 'comic-vol-1',
      name: '01 Animal Castle [Ablaze] (2022) #142.cbz',
      series: 'Animal Castle',
      metadata: {
        Series: 'Animal Castle',
        Number: '1',
        Title: 'Vol 1'
      }
    };
    const info1 = buildComicDisplayInfo(comicVol1);
    expect(info1.displayTitle).toBe('Animal Castle #1');
    expect(info1.subtitle).toBe('Vol 1');

    const comicVol2 = {
      id: 'comic-vol-2',
      name: '01 Animal Castle - Vol. 2 [Ablaze] (2023).cbz',
      series: 'Animal Castle',
      metadata: {
        Series: 'Animal Castle',
        Number: '2',
        Title: 'Vol 2'
      }
    };
    const info2 = buildComicDisplayInfo(comicVol2);
    expect(info2.displayTitle).toBe('Animal Castle #2');
    expect(info2.subtitle).toBe('Vol 2');

    const comicPart = {
      id: 'comic-part-1',
      name: '01 Animal - Part 1 [Europe Comics] (2020) #53.cbz',
      series: 'Animal',
      metadata: {
        Series: 'Animal',
        Number: '1',
        Title: 'Part 1'
      }
    };
    const infoPart = buildComicDisplayInfo(comicPart);
    expect(infoPart.displayTitle).toBe('Animal #1');
    expect(infoPart.subtitle).toBe('Part 1');
  });
});
