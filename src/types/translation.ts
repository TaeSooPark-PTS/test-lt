export type TranslationEngineState = 'ready' | 'disconnected' | 'error';

export interface TranslationProviderStatus {
  providerName: string;
  isMock: boolean;
  state: TranslationEngineState;
  sourceLanguage: string;
  targetLanguage: string;
  message?: string;
}
