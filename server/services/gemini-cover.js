/**
 * Gemini Vision Arbiter: Visual Cover Matcher
 *
 * Compares a local extracted comic book cover against a list of metadata candidates
 * from external sources (ComicVine, Metron, GCD, etc.) using Gemini's multimodal vision API.
 */

const fs = require('fs');
const path = require('path');

let lastGeminiCallTime = 0;
const DEFAULT_THROTTLE_MS = 4000; // ~4s spacing => <=15 RPM (free tier safety)

/**
 * Enforces rate limiting spacing between calls to Gemini API.
 */
async function waitThrottle(throttleMs = DEFAULT_THROTTLE_MS) {
  if (process.env.NODE_ENV === 'test') {
    return;
  }
  const now = Date.now();
  const elapsed = now - lastGeminiCallTime;
  if (elapsed < throttleMs && lastGeminiCallTime > 0) {
    const delay = throttleMs - elapsed;
    await new Promise(resolve => setTimeout(resolve, delay));
  }
  lastGeminiCallTime = Date.now();
}

/**
 * Resets the throttle timer (primarily for testing).
 */
function resetThrottle() {
  lastGeminiCallTime = 0;
}

/**
 * Resolves MIME type from image path or extension.
 */
function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  return 'image/jpeg';
}

/**
 * Fetches an external image URL and converts it to base64 inlineData.
 */
async function fetchImageAsBase64(url, timeoutMs = 8000) {
  if (!url || typeof url !== 'string' || !url.startsWith('http')) {
    return null;
  }
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
    clearTimeout(timeout);

    if (!res.ok) {
      return null;
    }

    const contentType = res.headers.get('content-type') || 'image/jpeg';
    const mimeType = contentType.split(';')[0].trim() || 'image/jpeg';
    const arrayBuffer = await res.arrayBuffer();
    const base64Data = Buffer.from(arrayBuffer).toString('base64');

    return {
      mimeType,
      data: base64Data
    };
  } catch (err) {
    return null;
  }
}

/**
 * Builds the payload for Gemini generateContent with positive framing and instructions at end.
 */
function buildGeminiPayload({ localBase64, localMime, candidatesWithImages }) {
  const parts = [];

  // Positive framing intro
  parts.push({
    text: [
      'You are an expert comic book librarian, archivist, and visual identification specialist.',
      'Your task is to accurately verify the identity of a comic book issue by visually comparing its actual scanned front cover against candidate covers retrieved from comic metadata databases.',
      '',
      '--- TARGET LOCAL COMIC COVER ---',
      'This is the actual scanned cover extracted directly from the user\'s comic archive file:'
    ].join('\n')
  });

  // Local cover image part
  parts.push({
    inlineData: {
      mimeType: localMime || 'image/jpeg',
      data: localBase64
    }
  });

  // Candidate descriptions and images
  parts.push({
    text: '\n--- METADATA CANDIDATES FROM ONLINE SOURCES ---\n'
  });

  for (let i = 0; i < candidatesWithImages.length; i++) {
    const cand = candidatesWithImages[i];
    const cMeta = cand.metadata || {};
    const title = cand.title || cMeta.title || 'Unknown Title';
    const series = cand.series || cMeta.series || '';
    const issue = cand.issue || cand.number || cMeta.issue || cMeta.number || '';
    const publisher = cand.publisher || cMeta.publisher || 'Unknown Publisher';
    const year = cand.year || cMeta.year || '';
    const source = cand.source || cand.matching_url || '';

    parts.push({
      text: [
        `Candidate [${i}]:`,
        `- Title: ${title}`,
        series ? `- Series: ${series}` : null,
        issue ? `- Issue/Number: #${issue}` : null,
        publisher ? `- Publisher: ${publisher}` : null,
        year ? `- Year: ${year}` : null,
        source ? `- Source: ${source}` : null,
        cand.imageData ? '- Cover Image: (provided below)' : '- Cover Image: [Image not available]'
      ].filter(Boolean).join('\n')
    });

    if (cand.imageData) {
      parts.push({
        inlineData: {
          mimeType: cand.imageData.mimeType,
          data: cand.imageData.data
        }
      });
    }
  }

  // Instructions at the end
  parts.push({
    text: [
      '--- EVALUATION INSTRUCTIONS ---',
      'Carefully inspect and cross-reference the TARGET LOCAL COMIC COVER with each candidate above.',
      'Key visual verification features to examine:',
      '1. Title Typography & Logo: Match the logo styling, masthead, and any subtitles or trade dress.',
      '2. Issue Number: Check the corner box or cover text for issue numbers, volume markers, or annual badges.',
      '3. Cover Artwork: Compare the illustrated scene, characters, penciller/cover artist style, and variant artwork.',
      '4. Publisher Badge: Look for publisher logos (Marvel, DC, Image, Dark Horse, Ahoy, etc.).',
      '5. Date / Era: Verify cover date or publishing era indicators.',
      '',
      'DECISION RULES:',
      '- If ONE candidate clearly matches the local comic cover (including alternate/variant covers for the identical issue), select its 0-based index (0 to ' + (candidatesWithImages.length - 1) + ').',
      '- If none of the candidates match the cover, set bestIndex to -1.',
      '- Provide a confidence score between 0.0 (completely unsure / no match) and 1.0 (exact, unambiguous match).',
      '- Provide a concise reason explaining why the selected candidate matches or why all candidates were rejected.',
      '',
      'You MUST return a JSON object adhering exactly to the requested schema.'
    ].join('\n')
  });

  return {
    contents: [
      {
        role: 'user',
        parts
      }
    ],
    generationConfig: {
      temperature: 0.1,
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        properties: {
          bestIndex: {
            type: 'INTEGER',
            description: '0-based index of the matching candidate, or -1 if none match'
          },
          confidence: {
            type: 'NUMBER',
            description: 'Confidence score from 0.0 to 1.0'
          },
          reason: {
            type: 'STRING',
            description: 'Concise explanation for the decision'
          }
        },
        required: ['bestIndex', 'confidence', 'reason']
      }
    }
  };
}

/**
 * Parses and validates the Gemini vision response.
 */
function parseGeminiResponse(rawText, candidateCount) {
  if (!rawText || typeof rawText !== 'string') {
    return { bestIndex: -1, confidence: 0, reason: 'Empty response from model' };
  }

  try {
    // Strip markdown formatting if present
    const cleaned = rawText
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim();

    const parsed = JSON.parse(cleaned);

    let bestIndex = -1;
    if (typeof parsed.bestIndex === 'number' && Number.isInteger(parsed.bestIndex)) {
      if (parsed.bestIndex >= 0 && parsed.bestIndex < candidateCount) {
        bestIndex = parsed.bestIndex;
      } else {
        bestIndex = -1;
      }
    }

    let confidence = 0.0;
    if (typeof parsed.confidence === 'number' && !isNaN(parsed.confidence)) {
      confidence = Math.max(0.0, Math.min(1.0, parsed.confidence));
    }

    const reason = typeof parsed.reason === 'string' && parsed.reason.trim().length > 0
      ? parsed.reason.trim()
      : (bestIndex >= 0 ? `Selected candidate #${bestIndex}` : 'No matching candidate found');

    return { bestIndex, confidence, reason };
  } catch (err) {
    return {
      bestIndex: -1,
      confidence: 0,
      reason: `Malformed model output: ${err.message}`
    };
  }
}

/**
 * Matches a local comic cover against external candidates using Gemini Vision.
 *
 * @param {Object} options
 * @param {string} options.localCoverPath - Absolute path to local cover image file
 * @param {Array<Object>} options.candidates - List of candidate metadata objects (<=5 evaluated)
 * @param {string} [options.apiKey] - Google Gemini API key
 * @param {string} [options.model] - Gemini model identifier (strictly: gemini-3.5-flash-lite)
 * @param {number} [options.throttleMs] - Throttle spacing in ms (default: 4000)
 * @returns {Promise<{bestIndex: number, confidence: number, reason: string}>}
 */
async function matchCoverToCandidates({
  localCoverPath,
  candidates = [],
  apiKey,
  model = 'gemini-3.5-flash-lite',
  throttleMs = DEFAULT_THROTTLE_MS
}) {
  // Strictly enforce gemini-3.5-flash-lite
  const activeModel = 'gemini-3.5-flash-lite';
  if (!apiKey) {
    return {
      bestIndex: -1,
      confidence: 0,
      reason: 'No Gemini API key provided'
    };
  }

  if (!localCoverPath) {
    return {
      bestIndex: -1,
      confidence: 0,
      reason: 'No local cover path specified'
    };
  }

  if (!Array.isArray(candidates) || candidates.length === 0) {
    return {
      bestIndex: -1,
      confidence: 0,
      reason: 'No candidate matches provided'
    };
  }

  // 1. Read local cover image
  let localBase64;
  let localMime;
  try {
    const buffer = await fs.promises.readFile(localCoverPath);
    localBase64 = buffer.toString('base64');
    localMime = getMimeType(localCoverPath);
  } catch (err) {
    return {
      bestIndex: -1,
      confidence: 0,
      reason: `Failed to read local cover: ${err.message}`
    };
  }

  // 2. Fetch candidate cover images (up to 5)
  const topCandidates = candidates.slice(0, 5);
  const candidatesWithImages = await Promise.all(
    topCandidates.map(async (c) => {
      const coverUrl = c.coverUrl || c.cover_image_url || c.metadata?.cover_image_url || c.metadata?.cover_url;
      const imageData = coverUrl ? await fetchImageAsBase64(coverUrl) : null;
      return {
        ...c,
        imageData
      };
    })
  );

  // 3. Build generateContent payload
  const payload = buildGeminiPayload({
    localBase64,
    localMime,
    candidatesWithImages
  });

  // 4. Rate-limit throttle spacing (~4s between calls)
  await waitThrottle(throttleMs);

  // 5. POST to Gemini generateContent (strictly gemini-2.5-flash-lite)
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(activeModel)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      return {
        bestIndex: -1,
        confidence: 0,
        reason: `Gemini API HTTP ${res.status}: ${errText.slice(0, 200)}`
      };
    }

    const data = await res.json();
    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;

    return parseGeminiResponse(rawText, topCandidates.length);
  } catch (err) {
    return {
      bestIndex: -1,
      confidence: 0,
      reason: `Gemini API request failed: ${err.message}`
    };
  }
}

module.exports = {
  matchCoverToCandidates,
  buildGeminiPayload,
  parseGeminiResponse,
  fetchImageAsBase64,
  waitThrottle,
  resetThrottle,
  DEFAULT_THROTTLE_MS
};
