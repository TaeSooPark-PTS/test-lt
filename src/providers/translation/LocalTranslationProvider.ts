import type { TranslatorStatus } from '../../types/electron';
import type { TranslationProviderStatus } from '../../types/translation';
import {
  detectSpeechLanguage,
  toNllbCode,
  type ConcreteLanguageCode
} from '../../utils/languageDetector';
import {
  applyGlossaryToTranslation,
  cleanSpokenSttText,
  parseGlossary,
  SentenceTranslationCache,
  splitCompletedSentences
} from '../../utils/speechTextProcessor';
import type { ProviderTranslateOptions, TranslationProvider } from './TranslationProvider';

export class LocalTranslationProvider implements TranslationProvider {
  private currentStatus: TranslationProviderStatus = {
    providerName: '로컬 AI 번역 (NLLB-200 다국어)',
    isMock: false,
    state: 'disconnected',
    sourceLanguage: 'auto',
    targetLanguage: 'ko',
    message: '번역 엔진 대기 중'
  };
  private unsubStatus: (() => void) | null = null;
  private statusListeners = new Set<(status: TranslationProviderStatus) => void>();
  private readonly sentenceCache = new SentenceTranslationCache(500);

  constructor(autoPrepare = false) {
    this.init(autoPrepare);
  }

  private init(autoPrepare: boolean): void {
    const api = window.electronAPI?.translator;
    if (!api) {
      this.updateStatus({
        state: 'error',
        message: 'Electron 번역 브리지를 사용할 수 없습니다.'
      });
      return;
    }

    void api.getStatus().then((st) => {
      if (st) this.handleStatusUpdate(st);
    });
    this.unsubStatus = api.onStatus((st) => {
      if (st) this.handleStatusUpdate(st);
    });
    if (autoPrepare) {
      void api.prepare();
    }
  }

  public prepare(): void {
    void window.electronAPI?.translator.prepare();
  }

  public cancelPending(): void {
    void window.electronAPI?.translator.cancelPending();
  }

  public clearCache(): void {
    this.sentenceCache.clear();
  }

  private handleStatusUpdate(st: TranslatorStatus): void {
    let state: TranslationProviderStatus['state'] = 'disconnected';
    if (st.state === 'ready') state = 'ready';
    else if (st.state === 'error') state = 'error';

    this.updateStatus({
      state,
      message: st.message
    });
  }

  private updateStatus(patch: Partial<TranslationProviderStatus>): void {
    this.currentStatus = { ...this.currentStatus, ...patch };
    for (const listener of this.statusListeners) {
      listener(this.getStatus());
    }
  }

  public onStatusChange(callback: (status: TranslationProviderStatus) => void): () => void {
    this.statusListeners.add(callback);
    return () => this.statusListeners.delete(callback);
  }

  private async translateSingleSegment(
    segment: string,
    nllbSrc: string,
    nllbTgt: string,
    captionId: string | undefined,
    isInterim: boolean
  ): Promise<string> {
    const cached = this.sentenceCache.get(nllbSrc, nllbTgt, segment);
    if (cached !== undefined) {
      return cached;
    }

    const api = window.electronAPI?.translator;
    if (!api) {
      throw new Error('번역 브리지를 사용할 수 없습니다.');
    }

    const out = await api.translate(segment, captionId, {
      srcLang: nllbSrc,
      tgtLang: nllbTgt,
      isInterim
    });
    if (!isInterim && out.trim()) {
      this.sentenceCache.set(nllbSrc, nllbTgt, segment, out);
    }
    return out;
  }

  public async translate(
    text: string,
    sourceLanguage = 'auto',
    targetLanguage = 'ko',
    captionId?: string,
    options?: ProviderTranslateOptions
  ): Promise<string> {
    const cleaned = cleanSpokenSttText(text);
    if (!cleaned) return '';

    const concreteSrc: ConcreteLanguageCode =
      sourceLanguage === 'auto'
        ? detectSpeechLanguage(cleaned, 'en')
        : (sourceLanguage as ConcreteLanguageCode);
    const concreteTgt = (targetLanguage || 'ko') as ConcreteLanguageCode;

    // 0ms pass-through if speaker is already speaking the target language (e.g. Korean Q&A -> Korean)
    if (concreteSrc === concreteTgt) {
      return cleaned;
    }

    const nllbSrc = toNllbCode(concreteSrc);
    const nllbTgt = toNllbCode(concreteTgt);
    const isInterim = Boolean(options?.isInterim);
    const glossary = parseGlossary(options?.glossaryRaw);

    // Multi-sentence incremental prefix caching: completed sentences hit 0ms LRU cache!
    const { completed, remainder } = splitCompletedSentences(cleaned);
    let rawTranslated: string;

    if (completed.length > 0 && (completed.length >= 2 || remainder.length > 0)) {
      const pieces: string[] = [];
      for (let i = 0; i < completed.length; i += 1) {
        const seg = completed[i];
        // Completed sentences inside a growing block are stable, so cache them even during interim turns!
        const subId = captionId ? `${captionId}::s${i}` : undefined;
        const t = await this.translateSingleSegment(seg, nllbSrc, nllbTgt, subId, false);
        if (t) pieces.push(t);
      }
      if (remainder) {
        const subId = captionId ? `${captionId}::rem` : undefined;
        const t = await this.translateSingleSegment(remainder, nllbSrc, nllbTgt, subId, isInterim);
        if (t) pieces.push(t);
      }
      rawTranslated = pieces.join(' ').trim();
    } else {
      rawTranslated = await this.translateSingleSegment(
        cleaned,
        nllbSrc,
        nllbTgt,
        captionId,
        isInterim
      );
    }

    return applyGlossaryToTranslation(cleaned, rawTranslated, glossary);
  }

  public getStatus(): TranslationProviderStatus {
    return { ...this.currentStatus };
  }

  public destroy(): void {
    this.unsubStatus?.();
    this.unsubStatus = null;
    this.statusListeners.clear();
  }
}
