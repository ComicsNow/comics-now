const { buildMetadataPrompt, synthesizeMetadataWithGemini, STRICT_MODEL } = require('../server/services/gemini-metadata');

describe('Gemini Metadata Synthesizer', () => {
  test('strictly enforces gemini-3.5-flash-lite', () => {
    expect(STRICT_MODEL).toBe('gemini-3.5-flash-lite');
  });

  test('buildMetadataPrompt constructs valid schema and prompt text with user library codex and strict grounding', () => {
    const payload = buildMetadataPrompt({
      winningCandidate: {
        title: 'Saga #1',
        metadata: {
          series: 'Saga',
          number: '1',
          publisher: 'Image Comics',
          writer: 'Brian K. Vaughan',
          description: 'An epic space opera begins.'
        }
      },
      filename: 'Saga 01.cbz',
      publisherCodex: ['Image', 'Marvel', 'DC Comics']
    });

    expect(payload.generationConfig.responseSchema).toBeDefined();
    expect(payload.generationConfig.responseSchema.properties.Series).toBeDefined();
    expect(payload.generationConfig.responseSchema.properties.Volume).toBeDefined();
    expect(payload.generationConfig.responseSchema.properties.Writer).toBeDefined();
    expect(payload.contents[0].parts[0].text).toContain('Saga 01.cbz');
    expect(payload.contents[0].parts[0].text).toContain('CRITICAL SOURCE GROUNDING CONSTRAINT');
    expect(payload.contents[0].parts[0].text).toContain('NEVER use external pretraining knowledge');
    expect(payload.contents[0].parts[0].text).toContain('USER LIBRARY PUBLISHER LIST');
    expect(payload.contents[0].parts[0].text).toContain('"Image"');
  });

  test('synthesizeMetadataWithGemini normalizes volume/title splitting, user publisher codex, and returns dual-cased keys', async () => {
    const originalFetch = global.fetch;
    const mockOutput = {
      Series: 'Batman: Vol. 1: The Shining',
      Volume: '1',
      Number: '1',
      Title: 'Vol. 1: The Shining',
      Publisher: 'Image Comics', // Should be normalized to 'Image' per user library codex
      Writer: 'Scott Snyder',
      Penciller: 'Greg Capullo',
      Summary: 'Batman faces the Court of Owls in Gotham.',
      Year: 2011
    };

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        candidates: [
          {
            content: {
              parts: [{ text: JSON.stringify(mockOutput) }]
            }
          }
        ]
      })
    });

    try {
      const res = await synthesizeMetadataWithGemini({
        winningCandidate: {
          title: 'Batman: Vol. 1: The Shining',
          coverUrl: 'http://example.com/cover.jpg',
          metadata: { series: 'Batman: Vol. 1: The Shining' }
        },
        filename: 'Batman - Vol 1, The Shining.cbz',
        publisherCodex: ['Image', 'Marvel', 'DC Comics'],
        apiKey: 'test-key'
      });

      // Volume & Series split
      expect(res.Series).toBe('Batman');
      expect(res.Title).toBe('Vol. 1: The Shining');
      expect(res.Volume).toBe('1');
      expect(res.Number).toBe('1');

      // User library publisher rule (Image, NOT Image Comics)
      expect(res.Publisher).toBe('Image');
      expect(res.publisher).toBe('Image');

      // Dual-cased keys for cross-service compatibility (Python & Node)
      expect(res.series).toBe('Batman');
      expect(res.title).toBe('Vol. 1: The Shining');
      expect(res.volume).toBe('1');
      expect(res.number).toBe('1');
      expect(res.issue).toBe('1');
      expect(res.writer).toBe('Scott Snyder');
      expect(res.Writer).toBe('Scott Snyder');
      expect(res.penciller).toBe('Greg Capullo');
      expect(res.Penciller).toBe('Greg Capullo');
      expect(res.summary).toBe('Batman faces the Court of Owls in Gotham.');
      expect(res.Summary).toBe('Batman faces the Court of Owls in Gotham.');
      expect(res.year).toBe('2011');
      expect(res.Year).toBe('2011');
      expect(res.cover_image_url).toBe('http://example.com/cover.jpg');

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('gemini-3.5-flash-lite'),
        expect.anything()
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test('synthesizeMetadataWithGemini preserves existing archive creators when candidate credits are empty', async () => {
    const originalFetch = global.fetch;
    const mockOutput = {
      Series: 'Fantastic Four Epic Collection',
      Volume: '26',
      Number: '26',
      Title: 'Heroes Reborn',
      Publisher: 'Marvel',
      Writer: '',
      Penciller: '',
      Summary: 'Marvel First Family reimagined.',
      Year: 2026
    };

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        candidates: [
          {
            content: {
              parts: [{ text: JSON.stringify(mockOutput) }]
            }
          }
        ]
      })
    });

    try {
      const res = await synthesizeMetadataWithGemini({
        winningCandidate: {
          title: 'Heroes Reborn',
          metadata: { series: 'Fantastic Four Epic Collection' }
        },
        existingMeta: {
          Writer: 'Jim Lee, Brandon Choi',
          Penciller: 'Jim Lee, Brett Booth'
        },
        filename: 'Fantastic Four Epic Collection v26 (2026) - Heroes Reborn (digital) (Marika-Empire).cbz',
        apiKey: 'test-key'
      });

      // Existing archive creators preserved
      expect(res.Writer).toBe('Jim Lee, Brandon Choi');
      expect(res.writer).toBe('Jim Lee, Brandon Choi');
      expect(res.Penciller).toBe('Jim Lee, Brett Booth');
      expect(res.penciller).toBe('Jim Lee, Brett Booth');
      expect(res.Publisher).toBe('Marvel');
      expect(res.publisher).toBe('Marvel');
      expect(res.Series).toBe('Fantastic Four Epic Collection');
      expect(res.series).toBe('Fantastic Four Epic Collection');
      expect(res.Number).toBe('26');
      expect(res.number).toBe('26');
    } finally {
      global.fetch = originalFetch;
    }
  });
});
