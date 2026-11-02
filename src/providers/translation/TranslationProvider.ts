import type { TranslationProviderStatus } from '../../types/translation';

export interface ProviderTranslateOptions {
  isInterim?: boolean;
  glossaryRaw?: string;
}

export interface TranslationProvider {
  translate(
    text: string,
    sourceLanguage?: string,
    targetLanguage?: string,
    captionId?: string,
    options?: ProviderTranslateOptions
  ): Promise<string>;
  getStatus(): TranslationProviderStatus;
  onStatusChange?(callback: (status: TranslationProviderStatus) => void): () => void;
}
