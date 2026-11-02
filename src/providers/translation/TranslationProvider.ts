import type { TranslationProviderStatus } from '../../types/translation';

export interface TranslationProvider {
  translate(
    text: string,
    sourceLanguage?: string,
    targetLanguage?: string,
    captionId?: string
  ): Promise<string>;
  getStatus(): TranslationProviderStatus;
  onStatusChange?(callback: (status: TranslationProviderStatus) => void): () => void;
}
