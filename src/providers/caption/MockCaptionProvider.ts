import type { CaptionEvent, CaptionProviderStatus } from '../../types/caption';
import type { CaptionProvider } from './CaptionProvider';

const SAMPLE_PRESENTATION_SENTENCES: readonly string[] = [
  'Good afternoon everyone, and thank you for joining today’s architecture review.',
  'AI is changing the way we work across engineering, operations, and product teams.',
  'It helps us make better decisions by surfacing real-time insights during live meetings.',
  'Before deployment, we need to verify access control policies and ensure that sensitive credentials never reach the client.',
  'On the projector screen, slides occupy seventy-five percent of the width while bilingual captions stay synchronized on the right.',
  'Even when a speaker delivers a long, multi-clause explanation with technical terminology, both English and Korean cells wrap naturally inside the same row card.',
  'Next, let us examine how asynchronous translation queues prevent slow network responses from blocking incoming speech captions.',
  'If an attendee looks back at earlier sentences, automatic scrolling pauses cleanly until they return to the latest live caption.'
];

export class MockCaptionProvider implements CaptionProvider {
  private listeners = new Set<(event: CaptionEvent) => void>();
  private statusListeners = new Set<(status: CaptionProviderStatus) => void>();
  private timerId: number | null = null;
  private interimTimerId: number | null = null;
  private sentenceIndex = 0;
  private sequenceCounter = 0;

  private status: CaptionProviderStatus = {
    providerName: 'MockCaptionProvider',
    isMock: true,
    state: 'disconnected',
    message: 'Tiro 실연동 미검증 (Phase 1 Mock 대기 중)'
  };

  public async connect(): Promise<void> {
    if (this.status.state === 'connected') return;

    this.updateStatus({
      providerName: 'MockCaptionProvider',
      isMock: true,
      state: 'connecting',
      message: 'Mock 자막 스트림 연결 중...'
    });

    await new Promise((resolve) => window.setTimeout(resolve, 180));

    this.updateStatus({
      providerName: 'MockCaptionProvider',
      isMock: true,
      state: 'connected',
      message: 'Mock 실시간 영어 자막 스트리밍 중 (Tiro 미연결)'
    });

    this.emitNextSentence();
    this.timerId = window.setInterval(() => {
      this.emitNextSentence();
    }, 3400);
  }

  public async disconnect(): Promise<void> {
    if (this.timerId !== null) {
      window.clearInterval(this.timerId);
      this.timerId = null;
    }
    if (this.interimTimerId !== null) {
      window.clearTimeout(this.interimTimerId);
      this.interimTimerId = null;
    }
    this.updateStatus({
      providerName: 'MockCaptionProvider',
      isMock: true,
      state: 'disconnected',
      message: 'Mock 스트림 중지됨 (Tiro 미연결)'
    });
  }

  public onCaption(callback: (event: CaptionEvent) => void): () => void {
    this.listeners.add(callback);
    return () => {
      this.listeners.delete(callback);
    };
  }

  public onStatusChange(callback: (status: CaptionProviderStatus) => void): () => void {
    this.statusListeners.add(callback);
    return () => {
      this.statusListeners.delete(callback);
    };
  }

  public getStatus(): CaptionProviderStatus {
    return { ...this.status };
  }

  /**
   * Emits a single simulated English sentence (interim -> final) for interactive Phase 1 testing.
   */
  public emitNextSentence(): void {
    const fullText =
      SAMPLE_PRESENTATION_SENTENCES[this.sentenceIndex % SAMPLE_PRESENTATION_SENTENCES.length];
    this.sentenceIndex += 1;
    this.sequenceCounter += 1;

    const id = `mock-cap-${Date.now()}-${this.sequenceCounter}`;
    const words = fullText.split(' ');
    const halfLength = Math.max(3, Math.floor(words.length * 0.55));
    const interimText = `${words.slice(0, halfLength).join(' ')} ...`;

    this.emit({
      id,
      text: interimText,
      isFinal: false,
      timestamp: Date.now()
    });

    this.interimTimerId = window.setTimeout(() => {
      this.emit({
        id,
        text: fullText,
        isFinal: true,
        timestamp: Date.now()
      });
    }, 450);
  }

  /**
   * Emits multiple final sentences rapidly to verify queue ordering and non-blocking rendering.
   */
  public emitBurst(count = 3): void {
    for (let i = 0; i < count; i += 1) {
      const fullText =
        SAMPLE_PRESENTATION_SENTENCES[this.sentenceIndex % SAMPLE_PRESENTATION_SENTENCES.length];
      this.sentenceIndex += 1;
      this.sequenceCounter += 1;
      const id = `mock-burst-${Date.now()}-${this.sequenceCounter}`;
      window.setTimeout(() => {
        this.emit({
          id,
          text: fullText,
          isFinal: true,
          timestamp: Date.now()
        });
      }, i * 120);
    }
  }

  private emit(event: CaptionEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  private updateStatus(nextStatus: CaptionProviderStatus): void {
    this.status = nextStatus;
    for (const listener of this.statusListeners) {
      listener({ ...this.status });
    }
  }
}
