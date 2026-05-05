import 'server-only';

/**
 * SRC-7: Address normalization for deduplication.
 *
 * Converts free-form Brazilian addresses to a canonical lowercase ASCII form
 * that can be compared across different portal formats.
 *
 * Examples:
 *   "Rua das Flores, 100 - Apto 42" → "r das flores 100 ap 42"
 *   "Av. Paulista, 1578 - CJ 34"   → "av paulista 1578 cj 34"
 */

const ABBREVIATIONS: Array<[RegExp, string]> = [
  [/\brua\b/gi, 'r'],
  [/\bavenida\b/gi, 'av'],
  [/\balamedas?\b/gi, 'al'],
  [/\btravessa\b/gi, 'tv'],
  [/\bpra[cç]a\b/gi, 'pc'],
  [/\bestrada\b/gi, 'est'],
  [/\brod[o]?via\b/gi, 'rod'],
  [/\bapartamento\b/gi, 'ap'],
  [/\bconjunto\b/gi, 'cj'],
  [/\bbloco\b/gi, 'bl'],
  [/\btorre\b/gi, 'tr'],
  [/\bandares?\b/gi, 'and'],
  [/\bquarteirao\b/gi, 'qd'],
  [/\blote\b/gi, 'lt'],
];

const STRIP_PATTERNS = [
  /\bcep\s*:?\s*\d{5}-?\d{3}\b/gi, // CEP
  /[-–—,./\\|]/g,                   // separators
  /\s{2,}/g,                        // extra spaces
];

export function normalizeAddress(raw: string): string {
  let s = raw
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip diacritics
    .replace(/[^\w\s]/g, ' '); // keep only word chars + spaces

  for (const [pattern, replacement] of ABBREVIATIONS) {
    s = s.replace(pattern, replacement);
  }

  for (const pattern of STRIP_PATTERNS) {
    s = s.replace(pattern, ' ');
  }

  return s.trim().replace(/\s+/g, ' ');
}

/**
 * Deduplication key: normalized address + geohash7 + bedroom count.
 * Two listings are considered the same property if all three match.
 */
export function dedupKey(
  addressNormalized: string,
  geohash7: string | null,
  bedrooms: number | null,
): string {
  return [addressNormalized.slice(0, 80), geohash7 ?? 'nogeo', String(bedrooms ?? 'nb')].join('|');
}
