/**
 * Unit tests for Gemini Vision Cover Arbiter
 */

const fs = require('fs');
const path = require('path');
const {
  matchCoverToCandidates,
  parseGeminiResponse,
  buildGeminiPayload,
  fetchImageAsBase64,
  waitThrottle,
  resetThrottle
} = require('../server/services/gemini-cover');

describe('Gemini Vision Cover Arbiter', () => {
  const originalFetch = global.fetch;
  const mockLocalPath = '/tmp/test_local_cover.jpg';
  const dummyBuffer = Buffer.from('dummy-local-image-binary-data');

  beforeEach(() => {
    resetThrottle();
    jest.spyOn(fs.promises, 'readFile').mockResolvedValue(dummyBuffer);
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  describe('parseGeminiResponse', () => {
    test('correctly parses valid JSON response from vision model', () => {
      const raw = JSON.stringify({
        bestIndex: 1,
        confidence: 0.92,
        reason: 'Issue number 23 and logo match exactly.'
      });

      const res = parseGeminiResponse(raw, 3);
      expect(res.bestIndex).toBe(1);
      expect(res.confidence).toBe(0.92);
      expect(res.reason).toBe('Issue number 23 and logo match exactly.');
    });

    test('strips markdown json fence blocks from response', () => {
      const raw = '```json\n{\n  "bestIndex": 0,\n  "confidence": 0.98,\n  "reason": "Exact cover illustration match."\n}\n```';
      const res = parseGeminiResponse(raw, 2);
      expect(res.bestIndex).toBe(0);
      expect(res.confidence).toBe(0.98);
      expect(res.reason).toBe('Exact cover illustration match.');
    });

    test('returns bestIndex: -1 on rejection by model', () => {
      const raw = JSON.stringify({
        bestIndex: -1,
        confidence: 0.05,
        reason: 'None of the provided candidate covers match.'
      });

      const res = parseGeminiResponse(raw, 2);
      expect(res.bestIndex).toBe(-1);
      expect(res.confidence).toBe(0.05);
      expect(res.reason).toContain('None of the provided candidate covers match.');
    });

    test('returns bestIndex: -1 on malformed JSON output', () => {
      const malformed = 'Not valid JSON at all { "bestIndex": ';
      const res = parseGeminiResponse(malformed, 3);
      expect(res.bestIndex).toBe(-1);
      expect(res.confidence).toBe(0);
      expect(res.reason).toContain('Malformed model output');
    });

    test('returns bestIndex: -1 when bestIndex is out of candidate bounds', () => {
      const outOfBounds = JSON.stringify({
        bestIndex: 5,
        confidence: 0.85,
        reason: 'Selected candidate 5'
      });
      // Only 2 candidates provided (indices 0 and 1)
      const res = parseGeminiResponse(outOfBounds, 2);
      expect(res.bestIndex).toBe(-1);
    });

    test('returns bestIndex: -1 on null or empty input', () => {
      const res = parseGeminiResponse('', 3);
      expect(res.bestIndex).toBe(-1);
      expect(res.confidence).toBe(0);
    });
  });

  describe('buildGeminiPayload', () => {
    test('constructs payload with positive framing and instructions at end', () => {
      const payload = buildGeminiPayload({
        localBase64: 'abc123base64',
        localMime: 'image/jpeg',
        candidatesWithImages: [
          {
            title: 'Spider-Man #1',
            publisher: 'Marvel',
            imageData: { mimeType: 'image/jpeg', data: 'cand1base64' }
          }
        ]
      });

      expect(payload.contents).toBeDefined();
      const parts = payload.contents[0].parts;

      // Positive framing in intro
      expect(parts[0].text).toContain('expert comic book librarian');
      expect(parts[0].text).toContain('TARGET LOCAL COMIC COVER');

      // Local image part
      expect(parts[1].inlineData).toEqual({
        mimeType: 'image/jpeg',
        data: 'abc123base64'
      });

      // Instructions at the end
      const lastPart = parts[parts.length - 1];
      expect(lastPart.text).toContain('EVALUATION INSTRUCTIONS');
      expect(lastPart.text).toContain('DECISION RULES');

      // Schema definition
      expect(payload.generationConfig.responseMimeType).toBe('application/json');
      expect(payload.generationConfig.responseSchema.required).toEqual(['bestIndex', 'confidence', 'reason']);
    });
  });

  describe('matchCoverToCandidates with mocked fetch', () => {
    test('successfully fetches candidates, posts to Gemini, and parses winner', async () => {
      const mockCandidateCoverUrl = 'https://comicvine.gamespot.com/uploads/scale_large/test.jpg';
      const mockCandidateCoverBytes = Buffer.from('candidate-cover-bytes');

      global.fetch = jest.fn().mockImplementation((url) => {
        if (url === mockCandidateCoverUrl) {
          // Candidate image fetch
          return Promise.resolve({
            ok: true,
            headers: new Map([['content-type', 'image/jpeg']]),
            arrayBuffer: () => Promise.resolve(mockCandidateCoverBytes.buffer)
          });
        }
        if (url.includes('generativelanguage.googleapis.com')) {
          // Gemini API generateContent
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              candidates: [
                {
                  content: {
                    parts: [
                      {
                        text: JSON.stringify({
                          bestIndex: 0,
                          confidence: 0.96,
                          reason: 'Exact logo and cover art match for Issue #1.'
                        })
                      }
                    ]
                  }
                }
              ]
            })
          });
        }
        return Promise.reject(new Error(`Unhandled URL: ${url}`));
      });

      const candidates = [
        {
          title: 'Closer to Danger #23',
          publisher: 'AAM-Markosia',
          coverUrl: mockCandidateCoverUrl
        }
      ];

      const result = await matchCoverToCandidates({
        localCoverPath: mockLocalPath,
        candidates,
        apiKey: 'test-api-key',
        model: 'gemini-3.5-flash-lite'
      });

      expect(result.bestIndex).toBe(0);
      expect(result.confidence).toBe(0.96);
      expect(result.reason).toContain('Exact logo and cover art match');
      expect(global.fetch).toHaveBeenCalledTimes(2); // 1 for candidate image, 1 for Gemini
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('gemini-3.5-flash-lite'),
        expect.anything()
      );
    });

    test('returns bestIndex: -1 when Gemini returns malformed JSON', async () => {
      global.fetch = jest.fn().mockImplementation((url) => {
        if (url.includes('generativelanguage.googleapis.com')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              candidates: [
                {
                  content: {
                    parts: [
                      {
                        text: '<<< Not valid json content >>>'
                      }
                    ]
                  }
                }
              ]
            })
          });
        }
        return Promise.resolve({
          ok: true,
          headers: new Map([['content-type', 'image/jpeg']]),
          arrayBuffer: () => Promise.resolve(new ArrayBuffer(8))
        });
      });

      const result = await matchCoverToCandidates({
        localCoverPath: mockLocalPath,
        candidates: [{ title: 'Test Comic', coverUrl: 'http://example.com/cover.jpg' }],
        apiKey: 'test-api-key'
      });

      expect(result.bestIndex).toBe(-1);
      expect(result.confidence).toBe(0);
      expect(result.reason).toContain('Malformed model output');
    });

    test('returns bestIndex: -1 if no API key is provided', async () => {
      const result = await matchCoverToCandidates({
        localCoverPath: mockLocalPath,
        candidates: [{ title: 'Test' }],
        apiKey: ''
      });

      expect(result.bestIndex).toBe(-1);
      expect(result.confidence).toBe(0);
      expect(result.reason).toContain('No Gemini API key');
    });

    test('gracefully handles candidate cover image fetch failures (404/network error)', async () => {
      global.fetch = jest.fn().mockImplementation((url) => {
        if (url === 'https://example.com/broken-cover.jpg') {
          return Promise.resolve({
            ok: false,
            status: 404
          });
        }
        if (url.includes('generativelanguage.googleapis.com')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              candidates: [
                {
                  content: {
                    parts: [
                      {
                        text: JSON.stringify({
                          bestIndex: 0,
                          confidence: 0.88,
                          reason: 'Matched metadata title and publisher.'
                        })
                      }
                    ]
                  }
                }
              ]
            })
          });
        }
        return Promise.reject(new Error('Unknown URL'));
      });

      const result = await matchCoverToCandidates({
        localCoverPath: mockLocalPath,
        candidates: [{ title: 'Test Comic', coverUrl: 'https://example.com/broken-cover.jpg' }],
        apiKey: 'test-api-key'
      });

      expect(result.bestIndex).toBe(0);
      expect(result.confidence).toBe(0.88);
    });
  });
});
