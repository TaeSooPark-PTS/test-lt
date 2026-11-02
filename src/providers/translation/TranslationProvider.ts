import type { TranslationProviderStatus } from '../../types/translation';

export interface TranslationProvider {
  translate(text: string, sourceLanguage?: string, targetLanguage?: string): Promise<string>;
  getStatus(): TranslationProviderStatus;
}
