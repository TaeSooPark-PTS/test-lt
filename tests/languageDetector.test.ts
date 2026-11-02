import { describe, expect, it } from 'vitest';
import {
  detectSpeechLanguage,
  toNllbCode
} from '../src/utils/languageDetector';

describe('detectSpeechLanguage & toNllbCode', () => {
  it('detects English speech accurately', () => {
    expect(
      detectSpeechLanguage('Welcome everyone to today’s architectural keynote session.')
    ).toBe('en');
    expect(toNllbCode('en')).toBe('eng_Latn');
  });

  it('detects Korean Hangul utterances during code-switching', () => {
    expect(detectSpeechLanguage('지금부터 실시간 다국어 자막 시연을 시작하겠습니다.')).toBe('ko');
    expect(detectSpeechLanguage('감사합니다')).toBe('ko');
    expect(toNllbCode('ko')).toBe('kor_Hang');
  });

  it('distinguishes Japanese (Hiragana/Katakana + Kanji) from Chinese (Hanzi)', () => {
    expect(
      detectSpeechLanguage('本日のプレゼンテーションにご参加いただきありがとうございます。')
    ).toBe('ja');
    expect(
      detectSpeechLanguage('欢迎大家参加今天的实时多语言翻译技术发布会。')
    ).toBe('zh');
    expect(toNllbCode('ja')).toBe('jpn_Jpan');
    expect(toNllbCode('zh')).toBe('zho_Hans');
  });

  it('detects Vietnamese, Spanish, French, and German utterances', () => {
    expect(
      detectSpeechLanguage('Xin chào tất cả mọi người đã đến với buổi thuyết trình hôm nay.')
    ).toBe('vi');
    expect(
      detectSpeechLanguage('Esta presentación muestra cómo funciona el sistema en tiempo real para todos.')
    ).toBe('es');
    expect(
      detectSpeechLanguage('Nous sommes ravis de vous présenter cette nouvelle architecture pour vous.')
    ).toBe('fr');
    expect(
      detectSpeechLanguage('Wir freuen uns über die neue Architektur und werden sie heute zeigen.')
    ).toBe('de');
  });

  it('returns fallback language on empty or whitespace input', () => {
    expect(detectSpeechLanguage('   ', 'en')).toBe('en');
    expect(detectSpeechLanguage('', 'ja')).toBe('ja');
  });
});
