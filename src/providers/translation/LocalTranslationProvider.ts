import type { TranslatorStatus } from '../../types/electron';
import type { TranslationProviderStatus } from '../../types/translation';
import type { TranslationProvider } from './TranslationProvider';

export class LocalTranslationProvider implements TranslationProvider {
  private currentStatus: TranslationProviderStatus = {
    providerName: '오프라인 AI 번역 (NLLB-200)',
    isMock: false,
    state: 'disconnected',
    sourceLanguage: 'en',
    targetLanguage: 'ko',
    message: '번역 엔진 대기 중'
  };
  private unsubStatus: (() => void) | null = null;
  private statusListeners = new Set<(status: TranslationProviderStatus) => void>();

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

  public async translate(
    text: string,
    _sourceLanguage = 'en',
    _targetLanguage = 'ko',
    captionId?: string
  ): Promise<string> {
    const api = window.electronAPI?.translator;
    if (!api) {
      throw new Error('번역 브리지를 사용할 수 없습니다.');
    }
    return api.translate(text, captionId);
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
