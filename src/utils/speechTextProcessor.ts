export interface GlossaryEntry {
  source: string;
  target: string;
  escapedRegex: RegExp;
}

const NOISE_BRACKET_RE = /\[(?:inaudible|unintelligible|music|applause|laughter|noise|silence)\]/gi;
const NOISE_PAREN_RE = /\((?:inaudible|unintelligible|music|applause|laughter|noise)\)/gi;
const ISOLATED_FILLER_RE = /(?:^|\s)(?:uh+|um+|erm+|hmm+|어\.\.\.|음\.\.\.)(?=[,\s.?!]|$)/gi;
const IMMEDIATE_STUTTER_RE = /\b([A-Za-z]{1,12})\s+\1\b/gi;

const ABBREVIATIONS = new Set([
  'mr',
  'mrs',
  'ms',
  'dr',
  'prof',
  'sr',
  'jr',
  'vs',
  'etc',
  'inc',
  'ltd',
  'co',
  'corp',
  'st',
  'no',
  'fig',
  'vol',
  'ch',
  'jan',
  'feb',
  'mar',
  'apr',
  'jun',
  'jul',
  'aug',
  'sep',
  'sept',
  'oct',
  'nov',
  'dec',
  'e.g',
  'i.e',
  'u.s',
  'u.k'
]);

/**
 * Cleans spoken STT disfluencies (fillers, non-speech tags, immediate single-word stutters)
 * without altering semantic content, improving NMT fluency and word-order stability.
 */
export function cleanSpokenSttText(raw: string): string {
  if (!raw) return '';
  let cleaned = raw
    .replace(NOISE_BRACKET_RE, ' ')
    .replace(NOISE_PAREN_RE, ' ')
    .replace(ISOLATED_FILLER_RE, ' ')
    .replace(IMMEDIATE_STUTTER_RE, '$1')
    .replace(/\s+([,.;:?!])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();

  // Strip dangling leading punctuation left after filler removal (e.g. ", we are" -> "we are")
  cleaned = cleaned.replace(/^[,;:]+\s*/, '').trim();
  return cleaned;
}

/**
 * Splits a multi-sentence STT paragraph block into completed sentences + trailing in-progress clause.
 * Enables 0ms LRU prefix caching so long multi-sentence paragraphs only run ONNX on the newest clause!
 */
export function splitCompletedSentences(text: string): {
  completed: string[];
  remainder: string;
} {
  const trimmed = text.trim();
  if (!trimmed) {
    return { completed: [], remainder: '' };
  }

  const completed: string[] = [];
  let start = 0;

  for (let i = 0; i < trimmed.length; i += 1) {
    const ch = trimmed[i];
    const isCjkTerm = ch === '。' || ch === '？' || ch === '！';
    const isLatinTerm = ch === '.' || ch === '?' || ch === '!';

    if (!isCjkTerm && !isLatinTerm) continue;

    // Ignore ellipsis "..."
    if (ch === '.' && (trimmed[i + 1] === '.' || trimmed[i - 1] === '.')) {
      continue;
    }

    // Ignore decimal numbers like 3.14 or version numbers like v2.0
    if (
      ch === '.' &&
      i > 0 &&
      i + 1 < trimmed.length &&
      /\d/.test(trimmed[i - 1]) &&
      /\d/.test(trimmed[i + 1])
    ) {
      continue;
    }

    if (isLatinTerm) {
      // Must be followed by end-of-string or whitespace (or closing quote + whitespace)
      const nextChar = trimmed[i + 1];
      if (nextChar !== undefined && !/[\s"”’')]/.test(nextChar)) {
        continue;
      }

      // Check preceding token against common abbreviations (Mr., Dr., e.g., U.S.)
      if (ch === '.') {
        const before = trimmed.slice(start, i).trim();
        const lastWordMatch = before.match(/([A-Za-z.]+)$/);
        if (lastWordMatch) {
          const token = lastWordMatch[1].toLowerCase().replace(/\.$/, '');
          if (ABBREVIATIONS.has(token) || (token.length === 1 && /[a-z]/.test(token))) {
            continue;
          }
        }
      }
    }

    // Advance past any closing quote right after terminal punctuation
    let endIdx = i + 1;
    while (endIdx < trimmed.length && /["”’')]/.test(trimmed[endIdx])) {
      endIdx += 1;
    }

    const sentence = trimmed.slice(start, endIdx).trim();
    if (sentence.length >= 2) {
      completed.push(sentence);
    }
    start = endIdx;
  }

  const remainder = trimmed.slice(start).trim();
  return { completed, remainder };
}

function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Parses user-configured glossary lines (`Source = Target` or `Source -> Target`).
 */
export function parseGlossary(raw: string | null | undefined): GlossaryEntry[] {
  if (!raw || !raw.trim()) return [];
  const entries: GlossaryEntry[] = [];

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const sepMatch = trimmed.match(/^(.+?)\s*(?:=|->|=>|:)\s*(.+)$/);
    if (!sepMatch) continue;
    const source = sepMatch[1].trim();
    const target = sepMatch[2].trim();
    if (!source || !target) continue;

    const boundaryPrefix = /^[A-Za-z0-9]/.test(source) ? '\\b' : '';
    const boundarySuffix = /[A-Za-z0-9]$/.test(source) ? '\\b' : '';
    entries.push({
      source,
      target,
      escapedRegex: new RegExp(`${boundaryPrefix}${escapeRegExp(source)}${boundarySuffix}`, 'gi')
    });
  }

  // Match longer multi-word phrases before shorter substrings
  entries.sort((a, b) => b.source.length - a.source.length);
  return entries;
}

/**
 * Replaces glossary terms that remained untranslated in the NMT output (or enforces exact brand/acronym mappings).
 */
export function applyGlossaryToTranslation(
  sourceText: string,
  translatedText: string,
  glossary: readonly GlossaryEntry[]
): string {
  if (!translatedText || glossary.length === 0) return translatedText;
  let result = translatedText;

  for (const entry of glossary) {
    entry.escapedRegex.lastIndex = 0;
    if (!entry.escapedRegex.test(sourceText)) continue;
    entry.escapedRegex.lastIndex = 0;
    if (result.includes(entry.target)) continue;

    // If the raw source term survived verbatim inside the translated output, map it to target
    entry.escapedRegex.lastIndex = 0;
    if (entry.escapedRegex.test(result)) {
      entry.escapedRegex.lastIndex = 0;
      result = result.replace(entry.escapedRegex, entry.target);
    }
  }

  return result;
}

/**
 * Bounded LRU cache for sentence-level translations so completed clauses in growing STT blocks
 * and repeated conference phrases resolve in 0ms without re-invoking ONNX inference.
 */
export class SentenceTranslationCache {
  private readonly map = new Map<string, string>();

  constructor(private readonly maxEntries = 500) {}

  private makeKey(srcLang: string, tgtLang: string, sentence: string): string {
    return `${srcLang}->${tgtLang}::${sentence.trim()}`;
  }

  public get(srcLang: string, tgtLang: string, sentence: string): string | undefined {
    const key = this.makeKey(srcLang, tgtLang, sentence);
    const hit = this.map.get(key);
    if (hit !== undefined) {
      this.map.delete(key);
      this.map.set(key, hit);
    }
    return hit;
  }

  public set(srcLang: string, tgtLang: string, sentence: string, translated: string): void {
    const clean = translated.trim();
    if (!clean) return;
    const key = this.makeKey(srcLang, tgtLang, sentence);
    if (this.map.has(key)) {
      this.map.delete(key);
    } else if (this.map.size >= this.maxEntries) {
      const oldestKey = this.map.keys().next().value;
      if (oldestKey !== undefined) {
        this.map.delete(oldestKey);
      }
    }
    this.map.set(key, clean);
  }

  public clear(): void {
    this.map.clear();
  }

  public get size(): number {
    return this.map.size;
  }
}
