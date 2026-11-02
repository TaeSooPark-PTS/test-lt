import { describe, expect, it } from 'vitest';
import {
  filterStableClasses,
  isClockOrCounterText,
  scoreFingerprintSimilarity,
  scoreTranscriptCandidate,
  type TiroElementFingerprint
} from '../electron/tiroDomMatcher';

describe('tiroDomMatcher adaptive resilience', () => {
  it('strips volatile hashed CSS classes (Emotion, styled-components, CSS Modules, Tailwind arbitrary)', () => {
    const filtered = filterStableClasses([
      'css-1dbjc4n',
      'sc-bdnxRM',
      '_transcript_1x9a2_4',
      'Panel__Body___3fK9aZ',
      'max-h-[80vh]',
      'transcript-feed',
      'live-stream-panel',
      'box_a91f32'
    ]);

    expect(filtered).toEqual(['transcript-feed', 'live-stream-panel']);
  });

  it('identifies ticking meeting clocks and numeric counters so Radar never locks onto timers', () => {
    expect(isClockOrCounterText('00:14:52')).toBe(true);
    expect(isClockOrCounterText('LIVE 04:19')).toBe(true);
    expect(isClockOrCounterText('12 / 45')).toBe(true);
    expect(isClockOrCounterText('Welcome to our live multilingual keynote.')).toBe(false);
  });

  it('scores structural transcript feeds high even when 100% of CSS classes are obfuscated', () => {
    const transcriptScore = scoreTranscriptCandidate({
      tagName: 'DIV',
      ancestryTags: ['main', 'section', 'div'],
      ariaLive: null,
      role: null,
      dataTestId: null,
      classHint: '',
      isInsideChrome: false,
      isScrollable: true,
      width: 680,
      height: 540,
      viewportWidth: 1280,
      viewportHeight: 800,
      childCount: 8,
      homogeneousTextChildCount: 7,
      totalTextLength: 420,
      sentenceLikeChildCount: 6,
      isClockOrCounter: false,
      recentMutationCount: 4
    });

    const navTimerScore = scoreTranscriptCandidate({
      tagName: 'DIV',
      ancestryTags: ['header', 'div'],
      ariaLive: null,
      role: null,
      dataTestId: null,
      classHint: '',
      isInsideChrome: true,
      isScrollable: false,
      width: 90,
      height: 28,
      viewportWidth: 1280,
      viewportHeight: 800,
      childCount: 1,
      homogeneousTextChildCount: 0,
      totalTextLength: 8,
      sentenceLikeChildCount: 0,
      isClockOrCounter: true,
      recentMutationCount: 10
    });

    expect(transcriptScore).toBeGreaterThan(80);
    expect(navTimerScore).toBeLessThan(0);
  });

  it('matches saved fingerprint after a Tiro deploy inserts wrapper divs and re-hashes classes', () => {
    const saved: TiroElementFingerprint = {
      primarySelector: 'div._feed_oldhash',
      stableSelector: null,
      tagName: 'div',
      ancestryTags: ['main', 'section', 'div'],
      ariaLive: 'polite',
      role: 'log',
      xRatio: 0.22,
      yRatio: 0.14,
      wRatio: 0.56,
      hRatio: 0.74,
      isScrollable: true
    };

    const redeployedTranscript: TiroElementFingerprint = {
      primarySelector: 'div._feed_newhash99',
      stableSelector: null,
      tagName: 'div',
      ancestryTags: ['main', 'div', 'section', 'div'],
      ariaLive: 'polite',
      role: 'log',
      xRatio: 0.23,
      yRatio: 0.15,
      wRatio: 0.55,
      hRatio: 0.72,
      isScrollable: true
    };

    const unrelatedSidebar: TiroElementFingerprint = {
      primarySelector: 'aside.sidebar',
      stableSelector: 'aside.sidebar',
      tagName: 'aside',
      ancestryTags: ['body', 'aside'],
      ariaLive: null,
      role: 'complementary',
      xRatio: 0.0,
      yRatio: 0.0,
      wRatio: 0.18,
      hRatio: 1.0,
      isScrollable: false
    };

    expect(scoreFingerprintSimilarity(saved, redeployedTranscript)).toBeGreaterThan(0.85);
    expect(scoreFingerprintSimilarity(saved, unrelatedSidebar)).toBeLessThan(0.35);
  });
});
