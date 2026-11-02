import { describe, expect, it } from 'vitest';
import {
  applyGlossaryToTranslation,
  cleanSpokenSttText,
  parseGlossary,
  SentenceTranslationCache,
  splitCompletedSentences
} from '../src/utils/speechTextProcessor';

describe('speechTextProcessor', () => {
  it('cleans STT disfluencies, fillers, non-speech tags, and immediate word stutters', () => {
    const raw =
      '[inaudible] Uh, we we are building um a real-time (laughter) translation pipeline.';
    expect(cleanSpokenSttText(raw)).toBe(
      'we are building a real-time translation pipeline.'
    );
  });

  it('splits multi-sentence paragraphs while preserving abbreviations, decimals, and CJK terminators', () => {
    const en =
      'Dr. Smith presented v2.5 at 99.9% accuracy. How fast does it run? It runs locally on Windows';
    const splitEn = splitCompletedSentences(en);
    expect(splitEn.completed).toEqual([
      'Dr. Smith presented v2.5 at 99.9% accuracy.',
      'How fast does it run?'
    ]);
    expect(splitEn.remainder).toBe('It runs locally on Windows');

    const ja = '最初の文が完了しました。次の文も完了！今は話している途中';
    const splitJa = splitCompletedSentences(ja);
    expect(splitJa.completed).toEqual(['最初の文が完了しました。', '次の文も完了！']);
    expect(splitJa.remainder).toBe('今は話している途中');
  });

  it('parses custom glossary entries and enforces terminology in translations', () => {
    const glossary = parseGlossary(`
      # Conference proper nouns
      Tiro = 티로
      UtilityProcess -> 유틸리티 프로세스
    `);
    expect(glossary).toHaveLength(2);

    const enforced = applyGlossaryToTranslation(
      'Tiro runs inside Electron UtilityProcess.',
      'Tiro는 일렉트론 UtilityProcess 내부에서 실행됩니다.',
      glossary
    );
    expect(enforced).toBe('티로는 일렉트론 유틸리티 프로세스 내부에서 실행됩니다.');
  });

  it('maintains bounded LRU eviction in SentenceTranslationCache', () => {
    const cache = new SentenceTranslationCache(3);
    cache.set('en', 'ko', 'One.', '하나.');
    cache.set('en', 'ko', 'Two.', '둘.');
    cache.set('en', 'ko', 'Three.', '셋.');

    // Touch 'One.' so 'Two.' becomes least-recently-used
    expect(cache.get('en', 'ko', 'One.')).toBe('하나.');

    cache.set('en', 'ko', 'Four.', '넷.');
    expect(cache.size).toBe(3);
    expect(cache.get('en', 'ko', 'Two.')).toBeUndefined();
    expect(cache.get('en', 'ko', 'One.')).toBe('하나.');
    expect(cache.get('en', 'ko', 'Four.')).toBe('넷.');
  });
});
