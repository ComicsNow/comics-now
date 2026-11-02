/**
 * Comics Now! - ComicVine & External Sources Configuration
 *
 * Source badges, display names, and theme colors.
 */

export const SOURCE_DISPLAY_CONFIG = {
  comicvine:   { name: 'ComicVine',    badgeBg: 'bg-purple-600' },
  gcd:         { name: 'GCD',          badgeBg: 'bg-indigo-600' },
  lcg:         { name: 'LCG',          badgeBg: 'bg-cyan-600' },
  metron:      { name: 'Metron',       badgeBg: 'bg-rose-600' },
  goodreads:   { name: 'Goodreads',    badgeBg: 'bg-amber-600' },
  blackwells:  { name: "Blackwell's",  badgeBg: 'bg-teal-600' },
  waterstones: { name: 'Waterstones',  badgeBg: 'bg-emerald-600' },
  googlebooks: { name: 'Google Books', badgeBg: 'bg-blue-600' },
  amazon:      { name: 'Amazon',       badgeBg: 'bg-yellow-600' },
  forbiddenplanet: { name: 'Forbidden Planet', badgeBg: 'bg-orange-600' }
};

export function getSourceInfo(rawSource) {
  const key = String(rawSource || 'other').toLowerCase();
  if (SOURCE_DISPLAY_CONFIG[key]) return { key, ...SOURCE_DISPLAY_CONFIG[key] };
  return { key, name: String(rawSource || 'OTHER').toUpperCase(), badgeBg: 'bg-purple-600' };
}
