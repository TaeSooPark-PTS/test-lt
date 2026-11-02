export interface TiroElementFingerprint {
  primarySelector: string;
  stableSelector: string | null;
  tagName: string;
  ancestryTags: string[];
  ariaLive: string | null;
  role: string | null;
  xRatio: number;
  yRatio: number;
  wRatio: number;
  hRatio: number;
  isScrollable: boolean;
}

export interface CandidateDomMetrics {
  tagName: string;
  ancestryTags: string[];
  ariaLive: string | null;
  role: string | null;
  dataTestId: string | null;
  classHint: string;
  isInsideChrome: boolean;
  isScrollable: boolean;
  width: number;
  height: number;
  viewportWidth: number;
  viewportHeight: number;
  childCount: number;
  homogeneousTextChildCount: number;
  totalTextLength: number;
  sentenceLikeChildCount: number;
  isClockOrCounter: boolean;
  recentMutationCount?: number;
}

const VOLATILE_CLASS_PATTERNS: readonly RegExp[] = [
  /^css-[a-z0-9]{4,}$/i, // Emotion / MUI
  /^sc-[a-zA-Z0-9_-]{4,}$/, // styled-components
  /^_[a-zA-Z0-9]+_[a-z0-9]{4,}(?:_\d+)?$/, // CSS Modules (_transcript_1a2b3_1)
  /^[a-zA-Z0-9_-]+__[a-zA-Z0-9_-]+___[A-Za-z0-9+/=_]{4,}$/, // Webpack CSS Modules
  /^jsx-\d+$/, // styled-jsx
  /^svelte-[a-z0-9]{4,}$/i, // Svelte scoped hash
  /^[a-f0-9]{7,}$/i, // raw hex hash
  /[\[\]:/]/ // Tailwind arbitrary utility classes (e.g. max-h-[80vh], w-1/2)
];

const CLOCK_OR_COUNTER_RE =
  /^(?:\d{1,2}:\d{2}(?::\d{2})?|\d+\s*\/\s*\d+|\d+%|[\d\s:./-]+)$/;

/**
 * Filters out build-time hashed or utility CSS classes so selectors survive Tiro frontend deploys.
 */
export function filterStableClasses(classes: readonly string[]): string[] {
  const result: string[] = [];
  for (const raw of classes) {
    const cls = raw.trim();
    if (!cls || cls.length < 3 || cls.length > 36) continue;
    if (VOLATILE_CLASS_PATTERNS.some((re) => re.test(cls))) continue;
    // Reject classes ending with 5+ random alphanumeric hash chars after a separator
    if (/[-_][a-z0-9]{5,}$/i.test(cls) && /\d/.test(cls.slice(-5))) continue;
    result.push(cls);
  }
  return result.slice(0, 2);
}

/**
 * Detects pure meeting timers / elapsed counters (e.g. "00:14:52", "12 / 40") so Mutation Radar
 * never accidentally locks onto a ticking clock instead of the speech transcript!
 */
export function isClockOrCounterText(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed) return true;
  if (CLOCK_OR_COUNTER_RE.test(trimmed)) return true;
  // Very short numeric status badges like "LIVE 01:24"
  const stripped = trimmed.replace(/\b(?:REC|LIVE|녹음|진행)\b/gi, '').trim();
  if (stripped && CLOCK_OR_COUNTER_RE.test(stripped)) return true;
  return false;
}

/**
 * Multi-signal structural & semantic scorer for zero-assumption transcript container discovery.
 * Works even when 100% of CSS classes are obfuscated/hashed and no `aria-live` attribute exists!
 */
export function scoreTranscriptCandidate(m: CandidateDomMetrics): number {
  if (m.isInsideChrome) return -100;
  if (m.width < 120 || m.height < 24) return -100;
  if (m.isClockOrCounter && m.totalTextLength < 32) return -80;
  if (['NAV', 'HEADER', 'FOOTER', 'BUTTON', 'INPUT', 'TEXTAREA', 'SELECT', 'ASIDE'].includes(m.tagName.toUpperCase())) {
    return -100;
  }

  let score = 0;

  // 1. Live mutation velocity (strongest behavioral invariant of live speech captions)
  if (m.recentMutationCount && m.recentMutationCount > 0) {
    score += Math.min(45, m.recentMutationCount * 9);
  }

  // 2. Accessibility live-region semantics (when present)
  if (m.ariaLive === 'polite' || m.ariaLive === 'assertive') {
    score += 32;
  }
  if (m.role === 'log' || m.role === 'feed') {
    score += 28;
  } else if (m.role === 'region' || m.role === 'status') {
    score += 10;
  }

  // 3. Semantic hints (bonus only — never required!)
  const hintSource = `${m.dataTestId ?? ''} ${m.classHint}`.toLowerCase();
  if (/(transcript|utterance|caption|subtitle|stt|speech|script)/.test(hintSource)) {
    score += 26;
  }

  // 4. Structural transcript invariants (scrollable main-pane region with repeating sentence blocks)
  const vw = Math.max(1, m.viewportWidth);
  const vh = Math.max(1, m.viewportHeight);
  const areaRatio = (m.width * m.height) / (vw * vh);

  if (m.isScrollable) {
    score += 16;
  }
  if (areaRatio >= 0.08 && areaRatio <= 0.92) {
    score += 14;
  } else if (areaRatio > 0.96) {
    // Penalize full-page root wrappers (e.g. #root / #__next) in favor of the actual transcript list
    score -= 18;
  }

  if (m.homogeneousTextChildCount >= 2) {
    score += Math.min(24, m.homogeneousTextChildCount * 4);
  }
  if (m.sentenceLikeChildCount >= 1) {
    score += Math.min(22, m.sentenceLikeChildCount * 5);
  }
  if (m.totalTextLength >= 24) {
    score += 10;
  }

  return score;
}

/**
 * Computes structural + spatial similarity (0..1) between a previously saved fingerprint
 * and a live DOM candidate so self-healing reconnects even after CSS selector changes.
 */
export function scoreFingerprintSimilarity(
  saved: TiroElementFingerprint,
  candidate: TiroElementFingerprint
): number {
  let score = 0;

  if (saved.tagName.toLowerCase() === candidate.tagName.toLowerCase()) {
    score += 0.2;
  }
  if (saved.ariaLive && saved.ariaLive === candidate.ariaLive) {
    score += 0.2;
  }
  if (saved.role && saved.role === candidate.role) {
    score += 0.15;
  }
  if (saved.isScrollable === candidate.isScrollable) {
    score += 0.1;
  }

  // Ancestry tag tail overlap (e.g. ['main', 'section', 'div'] vs ['main', 'div', 'section', 'div'])
  const savedTail = saved.ancestryTags.slice(-4);
  const candTail = candidate.ancestryTags.slice(-4);
  if (savedTail.length > 0 && candTail.length > 0) {
    const set = new Set(savedTail);
    const matches = candTail.filter((t) => set.has(t)).length;
    score += 0.2 * (matches / Math.max(savedTail.length, candTail.length));
  }

  // Normalized viewport bounding-box proximity
  const dx = Math.abs(saved.xRatio - candidate.xRatio);
  const dy = Math.abs(saved.yRatio - candidate.yRatio);
  const dw = Math.abs(saved.wRatio - candidate.wRatio);
  const dh = Math.abs(saved.hRatio - candidate.hRatio);
  const spatialDist = (dx + dy + dw + dh) / 4;
  const spatialSimilarity = Math.max(0, 1 - spatialDist * 2.2);
  score += 0.35 * spatialSimilarity;

  return Math.min(1, score);
}
