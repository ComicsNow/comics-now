const { matchCoverToCandidates } = require('../server/services/gemini-cover');
const { evaluateWithGemini } = require('../server/services/gemini-tag/evaluator');

jest.mock('../server/services/gemini-cover', () => ({
  matchCoverToCandidates: jest.fn()
}));

jest.mock('../server/services/gemini-metadata', () => ({
  synthesizeMetadataWithGemini: jest.fn()
}));

jest.mock('../server/services/metadata', () => ({
  getComicInfoFromArchive: jest.fn().mockResolvedValue({})
}));

jest.mock('../server/services/gemini-tag/resolver', () => ({
  resolveLocalCover: jest.fn().mockResolvedValue('/tmp/mock-cover.jpg'),
  recordDecision: jest.fn(),
  checkAndIncrementQuota: jest.fn().mockResolvedValue({ allowed: true })
}));

describe('Gemini evaluator fallback', () => {
  const config = { apiKey: 'mock-api-key-test-001', model: 'gemini-test', dailyCap: 100 };

  function pythonReviewResult() {
    return {
      status: 'review',
      candidates: [{
        score: 61,
        source: 'mock',
        metadata: { title: 'Mock Series #1', series: 'Mock Series', number: '1' }
      }]
    };
  }

  test('preserves the tagger result when Gemini is temporarily unavailable', async () => {
    matchCoverToCandidates.mockResolvedValue({
      bestIndex: -1,
      confidence: 0,
      reason: 'Gemini API HTTP 503: high demand',
      unavailable: true
    });

    const res = await evaluateWithGemini(
      { db: null },
      jest.fn(),
      jest.fn(),
      pythonReviewResult(),
      { path: '/tmp/mock-comic.cbr' },
      config,
      null,
      null
    );

    expect(res.status).toBe('review');
    expect(res.candidates).toHaveLength(1);
    expect(res.reason).toBeUndefined();
  });

  test('still rejects candidates when Gemini explicitly finds no visual match', async () => {
    matchCoverToCandidates.mockResolvedValue({
      bestIndex: -1,
      confidence: 0,
      reason: 'None of the covers match.'
    });

    const res = await evaluateWithGemini(
      { db: null },
      jest.fn(),
      jest.fn(),
      pythonReviewResult(),
      { path: '/tmp/mock-comic.cbr' },
      config,
      null,
      null
    );

    expect(res.status).toBe('skipped');
    expect(res.reason).toContain('All candidates rejected by Gemini Vision');
  });
});
