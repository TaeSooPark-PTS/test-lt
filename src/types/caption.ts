export type CaptionStatus = 'interim' | 'final';

export type TranslationState = 'pending' | 'translating' | 'translated' | 'error';

export interface CaptionCardItem {
  id: string;
  sequence: number;
  englishText: string;
  koreanText: string | null;
  captionStatus: CaptionStatus;
  translationState: TranslationState;
  extractionLatencyMs?: number;
  errorMessage?: string;
  createdAt: number;
  updatedAt: number;
}

export interface CaptionEvent {
  id: string;
  text: string;
  isFinal: boolean;
  timestamp: number;
  extractionLatencyMs?: number;
}

export type ProviderConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface CaptionProviderStatus {
  providerName: string;
  isMock: boolean;
  state: ProviderConnectionState;
  message?: string;
}
