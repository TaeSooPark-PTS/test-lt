export type ConcreteLanguageCode = 'en' | 'ko' | 'ja' | 'zh' | 'es' | 'fr' | 'de' | 'vi';
export type SourceLanguageSetting = 'auto' | ConcreteLanguageCode;
export type TargetLanguageSetting = 'ko' | 'en' | 'ja' | 'zh';

export interface LanguageOption<T extends string = string> {
  code: T;
  label: string;
  shortLabel: string;
  nllbCode?: string;
}

export const NLLB_CODE_BY_LANG: Record<ConcreteLanguageCode, string> = {
  en: 'eng_Latn',
  ko: 'kor_Hang',
  ja: 'jpn_Jpan',
  zh: 'zho_Hans',
  es: 'spa_Latn',
  fr: 'fra_Latn',
  de: 'deu_Latn',
  vi: 'vie_Latn'
};

export const SOURCE_LANGUAGE_OPTIONS: readonly LanguageOption<SourceLanguageSetting>[] = [
  { code: 'auto', label: '자동 감지 (다국어)', shortLabel: 'AUTO' },
  { code: 'en', label: 'English (영어)', shortLabel: 'EN', nllbCode: 'eng_Latn' },
  { code: 'ja', label: '日本語 (일본어)', shortLabel: 'JA', nllbCode: 'jpn_Jpan' },
  { code: 'zh', label: '中文 (중국어)', shortLabel: 'ZH', nllbCode: 'zho_Hans' },
  { code: 'es', label: 'Español (스페인어)', shortLabel: 'ES', nllbCode: 'spa_Latn' },
  { code: 'fr', label: 'Français (프랑스어)', shortLabel: 'FR', nllbCode: 'fra_Latn' },
  { code: 'de', label: 'Deutsch (독일어)', shortLabel: 'DE', nllbCode: 'deu_Latn' },
  { code: 'vi', label: 'Tiếng Việt (베트남어)', shortLabel: 'VI', nllbCode: 'vie_Latn' },
  { code: 'ko', label: '한국어', shortLabel: 'KO', nllbCode: 'kor_Hang' }
];

export const TARGET_LANGUAGE_OPTIONS: readonly LanguageOption<TargetLanguageSetting>[] = [
  { code: 'ko', label: '한국어', shortLabel: 'KO', nllbCode: 'kor_Hang' },
  { code: 'en', label: 'English (영어)', shortLabel: 'EN', nllbCode: 'eng_Latn' },
  { code: 'ja', label: '日本語 (일본어)', shortLabel: 'JA', nllbCode: 'jpn_Jpan' },
  { code: 'zh', label: '中文 (중국어)', shortLabel: 'ZH', nllbCode: 'zho_Hans' }
];

const HANGUL_RE = /[\uAC00-\uD7A3\u3131-\u318E]/g;
const HIRAGANA_KATAKANA_RE = /[\u3040-\u309F\u30A0-\u30FF\u31F0-\u31FF]/g;
const CJK_HAN_RE = /[\u4E00-\u9FFF\u3400-\u4DBF]/g;
const VIETNAMESE_CHAR_RE =
  /[ăâđêôơưĂÂĐÊÔƠƯảẩẳẻểỉỏổởủửỷẢẨẲẺỂỈỎỔỞỦỬỶấầẫậắằẵặếềễệốồỗộớờỡợứừữựẤẦẪẬẮẰẴẶẾỀỄỆỐỒỖỘỚỜỠỢỨỪỮỰ]/g;

const SPANISH_WORD_RE = /\b(el|la|los|las|una|para|como|pero|más|esta|este|sobre|también|porque|qué|está|son|con|del)\b/gi;
const FRENCH_WORD_RE = /\b(le|la|les|des|une|dans|pour|avec|sur|plus|cette|nous|vous|est|sont|pas|mais|qu['’]|c['’]est)\b/gi;
const GERMAN_WORD_RE = /\b(der|die|das|und|ist|nicht|mit|auf|für|eine|einer|wir|sie|auch|sich|werden|über)\b/gi;

export function toNllbCode(lang: ConcreteLanguageCode): string {
  return NLLB_CODE_BY_LANG[lang] ?? 'eng_Latn';
}

export function getLanguageShortLabel(lang: ConcreteLanguageCode): string {
  return lang.toUpperCase();
}

/**
 * Zero-latency (< 0.05ms) script + lexical speech language detector for live STT streams.
 * Prevents wrong `src_lang` hallucinations when speakers code-switch across EN/KO/JA/ZH/ES/FR/DE/VI.
 */
export function detectSpeechLanguage(
  rawText: string,
  fallback: ConcreteLanguageCode = 'en'
): ConcreteLanguageCode {
  const text = rawText.trim();
  if (!text) return fallback;

  const nonSpaceLen = text.replace(/\s+/g, '').length;
  if (nonSpaceLen === 0) return fallback;

  const hangulCount = (text.match(HANGUL_RE) ?? []).length;
  const kanaCount = (text.match(HIRAGANA_KATAKANA_RE) ?? []).length;
  const hanCount = (text.match(CJK_HAN_RE) ?? []).length;

  // 1. Korean Hangul script dominance
  if (hangulCount >= 2 && hangulCount / nonSpaceLen >= 0.25) {
    return 'ko';
  }
  if (hangulCount >= 1 && nonSpaceLen <= 4 && kanaCount === 0 && hanCount === 0) {
    return 'ko';
  }

  // 2. Japanese (any Hiragana/Katakana presence alongside optional Kanji)
  if (kanaCount >= 1 && (kanaCount + hanCount) / nonSpaceLen >= 0.2) {
    return 'ja';
  }

  // 3. Chinese Hanzi (without Japanese Kana or Korean Hangul)
  if (hanCount >= 2 && kanaCount === 0 && hangulCount === 0 && hanCount / nonSpaceLen >= 0.25) {
    return 'zh';
  }
  if (hanCount >= 1 && nonSpaceLen <= 3 && kanaCount === 0 && hangulCount === 0) {
    return 'zh';
  }

  // 4. Vietnamese distinctive tonal/vowel diacritics
  const viMatches = (text.match(VIETNAMESE_CHAR_RE) ?? []).length;
  if (viMatches >= 1) {
    return 'vi';
  }

  // 5. Major European Latin-script languages via stopword + diacritic scoring
  const esScore =
    (text.match(SPANISH_WORD_RE) ?? []).length + (/[ñ¿¡áéíóú]/i.test(text) ? 1.5 : 0);
  const frScore =
    (text.match(FRENCH_WORD_RE) ?? []).length + (/[çœæàèùêîôûëï]/i.test(text) ? 1.5 : 0);
  const deScore =
    (text.match(GERMAN_WORD_RE) ?? []).length + (/[äöüß]/i.test(text) ? 1.5 : 0);

  const maxEuro = Math.max(esScore, frScore, deScore);
  if (maxEuro >= 2.5) {
    if (deScore === maxEuro) return 'de';
    if (frScore === maxEuro) return 'fr';
    return 'es';
  }

  return fallback;
}
