/**
 * Gemini Metadata Synthesizer & Normalizer Facade
 *
 * Takes raw scraped comic candidates across external providers (ComicVine, Metron, GCD, LCG, etc.)
 * plus the comic filename, existing metadata, and the user's library publisher codex, and utilizes
 * Gemini 3.5 Flash-Lite with structured JSON output to synthesize clean, canonical ComicInfo metadata.
 */

const { buildMetadataPrompt } = require('./gemini-meta/prompt');
const { normalizeGeminiMetadata } = require('./gemini-meta/normalizer');

const STRICT_MODEL = 'gemini-3.5-flash-lite';

/**
 * Calls Gemini 3.5 Flash-Lite to synthesize and normalize comic metadata.
 *
 * @param {Object} options
 * @param {Object} options.winningCandidate - The selected match candidate
 * @param {Array<Object>} [options.allCandidates] - All candidates scraped from external sources
 * @param {string} options.filename - The comic file name
 * @param {Object} [options.existingMeta] - Any metadata already in the archive
 * @param {Array<string>} [options.publisherCodex] - User's library publisher names
 * @param {string} options.apiKey - Gemini API key
 * @param {string} [options.model] - Model name override
 * @returns {Promise<Object>} Normalized metadata dictionary with both PascalCase and lowercase keys
 */
async function synthesizeMetadataWithGemini({
  winningCandidate,
  allCandidates = [],
  filename,
  existingMeta = {},
  publisherCodex = [],
  apiKey,
  model = STRICT_MODEL
}) {
  if (!apiKey) {
    throw new Error('No Gemini API key provided for metadata synthesis');
  }

  const payload = buildMetadataPrompt({
    winningCandidate,
    allCandidates,
    filename,
    existingMeta,
    publisherCodex
  });

  const activeModel = (model || '').trim() || STRICT_MODEL;
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(activeModel)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Gemini metadata synthesis error (HTTP ${res.status}): ${errText || res.statusText}`);
  }

  const data = await res.json();
  const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!rawText) {
    throw new Error('Empty response from Gemini metadata synthesis');
  }

  const cleaned = rawText
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();

  const parsed = JSON.parse(cleaned);

  return normalizeGeminiMetadata({
    parsed,
    existingMeta,
    winningCandidate,
    publisherCodex
  });
}

module.exports = {
  STRICT_MODEL,
  buildMetadataPrompt,
  synthesizeMetadataWithGemini
};
