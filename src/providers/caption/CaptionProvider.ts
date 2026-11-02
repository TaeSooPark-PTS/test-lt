import type { CaptionEvent, CaptionProviderStatus } from '../../types/caption';

export interface CaptionProvider {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  onCaption(callback: (event: CaptionEvent) => void): () => void;
  onStatusChange(callback: (status: CaptionProviderStatus) => void): () => void;
  getStatus(): CaptionProviderStatus;
}
