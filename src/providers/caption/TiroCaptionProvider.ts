import type { CaptionEvent, CaptionProviderStatus } from '../../types/caption';
import type { TiroObserverTelemetry, TiroRawCaptionPayload } from '../../types/tiro';
import type { CaptionProvider } from './CaptionProvider';

/**
 * Real Tiro WebContentsView DOM MutationObserver CaptionProvider (Phase 3 PoC).
 * Does NOT assume hardcoded CSS selectors prior to live DOM inspection.
 */
export class TiroCaptionProvider implements CaptionProvider {
  private listeners = new Set<(event: CaptionEvent) => void>();
  private statusListeners = new Set<(status: CaptionProviderStatus) => void>();
  private unsubCaptionIpc: (() => void) | null = null;
  private unsubTelemetryIpc: (() => void) | null = null;
  private targetSelector: string | null = null;
  private active = false;

  private status: CaptionProviderStatus = {
    providerName: 'TiroCaptionProvider',
    isMock: false,
    state: 'disconnected',
    message: 'Tiro 로그인 및 자막 DOM 요소 선택 대기 중'
  };

  public setTargetSelector(selector: string | null): void {
    this.targetSelector = selector ? selector.trim() : null;
  }

  public getTargetSelector(): string | null {
    return this.targetSelector;
  }

  public async connect(): Promise<void> {
    const tiroBridge = window.electronAPI?.tiro;
    if (!tiroBridge) {
      this.updateStatus({
        providerName: 'TiroCaptionProvider',
        isMock: false,
        state: 'error',
        message: 'Electron Tiro IPC 브리지를 사용할 수 없습니다.'
      });
      return;
    }

    this.attachIpcListeners();
    this.active = true;

    if (!this.targetSelector) {
      this.updateStatus({
        providerName: 'TiroCaptionProvider',
        isMock: false,
        state: 'connecting',
        message: 'Tiro 화면에서 자막 요소를 선택(Inspector/Radar)하면 실시간 수집이 시작됩니다.'
      });
      return;
    }

    this.updateStatus({
      providerName: 'TiroCaptionProvider',
      isMock: false,
      state: 'connecting',
      message: `선택한 요소(${this.targetSelector})에 MutationObserver 연결 중...`
    });

    await tiroBridge.sendCommand({
      action: 'start-observer',
      selector: this.targetSelector
    });
  }

  public async observeSelector(selector: string): Promise<void> {
    this.setTargetSelector(selector);
    await this.connect();
  }

  public async disconnect(): Promise<void> {
    this.active = false;
    await window.electronAPI?.tiro.sendCommand({ action: 'stop-observer' });
    this.detachIpcListeners();
    this.updateStatus({
      providerName: 'TiroCaptionProvider',
      isMock: false,
      state: 'disconnected',
      message: 'Tiro DOM 자막 감시 중지됨'
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

  private attachIpcListeners(): void {
    const tiroBridge = window.electronAPI?.tiro;
    if (!tiroBridge) return;

    if (!this.unsubCaptionIpc) {
      this.unsubCaptionIpc = tiroBridge.onCaption((payload: TiroRawCaptionPayload) => {
        if (!this.active) return;
        const now = Date.now();
        const latencyMs = Math.max(0, now - payload.mutationAt);

        void tiroBridge.sendCommand({
          action: 'record-latency',
          latencySampleMs: latencyMs
        });

        const event: CaptionEvent = {
          id: payload.id,
          text: payload.text,
          isFinal: payload.isFinal,
          timestamp: now,
          extractionLatencyMs: latencyMs
        };

        for (const listener of this.listeners) {
          listener(event);
        }
      });
    }

    if (!this.unsubTelemetryIpc) {
      this.unsubTelemetryIpc = tiroBridge.onTelemetry((tel: TiroObserverTelemetry) => {
        if (!this.active) return;
        if (tel.errorMessage) {
          this.updateStatus({
            providerName: 'TiroCaptionProvider',
            isMock: false,
            state: 'error',
            message: tel.errorMessage
          });
        } else if (tel.waitingForElement) {
          this.updateStatus({
            providerName: 'TiroCaptionProvider',
            isMock: false,
            state: 'connecting',
            message: `자막 영역 대기 중 (${tel.targetSelector ?? ''}) - Tiro 음성인식이 시작되면 자동 연결됩니다.`
          });
        } else if (tel.observing) {
          this.updateStatus({
            providerName: 'TiroCaptionProvider',
            isMock: false,
            state: 'connected',
            message: `DOM 감시 중 (${tel.targetSelector ?? ''})`
          });
        }
      });
    }
  }

  private detachIpcListeners(): void {
    this.unsubCaptionIpc?.();
    this.unsubCaptionIpc = null;
    this.unsubTelemetryIpc?.();
    this.unsubTelemetryIpc = null;
  }

  private updateStatus(next: CaptionProviderStatus): void {
    this.status = next;
    for (const listener of this.statusListeners) {
      listener({ ...this.status });
    }
  }
}
