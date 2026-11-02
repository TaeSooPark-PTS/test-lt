import React, { useCallback, useEffect, useRef, useState } from 'react';
import { SlideStagePlaceholder } from './components/SlideStagePlaceholder';
import { TiroWorkspacePanel } from './components/TiroWorkspacePanel';
import { CaptionWorkspace, type ActiveCaptionSource } from './components/CaptionWorkspace';
import { MockCaptionProvider } from './providers/caption/MockCaptionProvider';
import { TiroCaptionProvider } from './providers/caption/TiroCaptionProvider';
import { MockTranslationProvider } from './providers/translation/MockTranslationProvider';
import { TranslationQueue } from './providers/translation/TranslationQueue';
import type { CaptionCardItem, CaptionEvent, CaptionProviderStatus } from './types/caption';
import type { DisplaySummary, WindowState } from './types/electron';
import type {
  TiroDomDiagnostics,
  TiroObserverTelemetry,
  TiroRadarCandidate,
  TiroSelectedElementInfo,
  TiroViewState
} from './types/tiro';
import type { TranslationProviderStatus } from './types/translation';

export const App: React.FC = () => {
  const mockProviderRef = useRef<MockCaptionProvider | null>(null);
  const tiroProviderRef = useRef<TiroCaptionProvider | null>(null);
  const translationProviderRef = useRef<MockTranslationProvider | null>(null);
  const translationQueueRef = useRef<TranslationQueue | null>(null);
  const sequenceRef = useRef<number>(0);

  if (!mockProviderRef.current) {
    mockProviderRef.current = new MockCaptionProvider();
  }
  if (!tiroProviderRef.current) {
    tiroProviderRef.current = new TiroCaptionProvider();
  }
  if (!translationProviderRef.current) {
    translationProviderRef.current = new MockTranslationProvider();
  }
  if (!translationQueueRef.current) {
    translationQueueRef.current = new TranslationQueue(translationProviderRef.current, 3);
  }

  const [activeSource, setActiveSource] = useState<ActiveCaptionSource>('mock');
  const [tiroPanelVisible, setTiroPanelVisible] = useState(false);

  const [captions, setCaptions] = useState<CaptionCardItem[]>([]);
  const [captionStatus, setCaptionStatus] = useState<CaptionProviderStatus>(() =>
    mockProviderRef.current!.getStatus()
  );
  const [translationStatus] = useState<TranslationProviderStatus>(() =>
    translationProviderRef.current!.getStatus()
  );

  // Tiro PoC Diagnostics & Inspector States
  const [tiroViewState, setTiroViewState] = useState<TiroViewState | null>(null);
  const [tiroDiagnostics, setTiroDiagnostics] = useState<TiroDomDiagnostics | null>(null);
  const [tiroRadarCandidates, setTiroRadarCandidates] = useState<TiroRadarCandidate[]>([]);
  const [tiroPickedInfo, setTiroPickedInfo] = useState<TiroSelectedElementInfo | null>(null);
  const [tiroTelemetry, setTiroTelemetry] = useState<TiroObserverTelemetry | null>(null);

  const [cleanMode, setCleanMode] = useState(false);
  const [fontSizePx, setFontSizePx] = useState(15);
  const [cardGapPx, setCardGapPx] = useState(8);

  const [windowState, setWindowState] = useState<WindowState>({
    isFullScreen: false,
    currentDisplayId: 0
  });
  const [displays, setDisplays] = useState<DisplaySummary[]>([]);

  const enqueueTranslationForCaption = useCallback((captionId: string, englishText: string) => {
    const queue = translationQueueRef.current;
    if (!queue) return;

    queue.enqueue({
      captionId,
      text: englishText,
      sourceLanguage: 'en',
      targetLanguage: 'ko',
      onStart: (id) => {
        setCaptions((prev) =>
          prev.map((item) =>
            item.id === id
              ? {
                  ...item,
                  translationState: 'translating',
                  errorMessage: undefined,
                  updatedAt: Date.now()
                }
              : item
          )
        );
      },
      onSuccess: (id, translated) => {
        setCaptions((prev) =>
          prev.map((item) =>
            item.id === id
              ? {
                  ...item,
                  koreanText: translated,
                  translationState: 'translated',
                  errorMessage: undefined,
                  updatedAt: Date.now()
                }
              : item
          )
        );
      },
      onError: (id, errorMessage) => {
        setCaptions((prev) =>
          prev.map((item) =>
            item.id === id
              ? {
                  ...item,
                  translationState: 'error',
                  errorMessage,
                  updatedAt: Date.now()
                }
              : item
          )
        );
      }
    });
  }, []);

  const handleIncomingCaption = useCallback(
    (event: CaptionEvent) => {
      setCaptions((prev) => {
        const existingIndex = prev.findIndex((item) => item.id === event.id);
        if (existingIndex === -1) {
          sequenceRef.current += 1;
          const nextItem: CaptionCardItem = {
            id: event.id,
            sequence: sequenceRef.current,
            englishText: event.text,
            koreanText: null,
            captionStatus: event.isFinal ? 'final' : 'interim',
            translationState: 'pending',
            extractionLatencyMs: event.extractionLatencyMs,
            createdAt: event.timestamp,
            updatedAt: event.timestamp
          };
          return [...prev, nextItem];
        }

        const existing = prev[existingIndex];
        const updated: CaptionCardItem = {
          ...existing,
          englishText: event.text,
          captionStatus: event.isFinal ? 'final' : existing.captionStatus,
          extractionLatencyMs: event.extractionLatencyMs ?? existing.extractionLatencyMs,
          updatedAt: event.timestamp
        };
        const copy = [...prev];
        copy[existingIndex] = updated;
        return copy;
      });

      if (event.isFinal) {
        enqueueTranslationForCaption(event.id, event.text);
      }
    },
    [enqueueTranslationForCaption]
  );

  // Subscribe to whichever CaptionProvider is currently selected
  useEffect(() => {
    const activeProvider =
      activeSource === 'mock' ? mockProviderRef.current! : tiroProviderRef.current!;

    setCaptionStatus(activeProvider.getStatus());
    const unsubCaption = activeProvider.onCaption(handleIncomingCaption);
    const unsubStatus = activeProvider.onStatusChange(setCaptionStatus);

    return () => {
      unsubCaption();
      unsubStatus();
    };
  }, [activeSource, handleIncomingCaption]);

  // Seed initial sample captions in Mock mode on initial launch
  useEffect(() => {
    const mockProvider = mockProviderRef.current!;
    mockProvider.emitBurst(2);

    return () => {
      void mockProvider.disconnect();
      void tiroProviderRef.current?.disconnect();
      translationQueueRef.current?.clear();
    };
  }, []);

  // Wire Electron window & Tiro PoC IPC listeners
  useEffect(() => {
    const api = window.electronAPI;
    if (!api) return;

    void api.getWindowState().then(setWindowState);
    void api.getDisplays().then(setDisplays);
    void api.tiro.getState().then((st) => {
      if (st) setTiroViewState(st);
    });

    const unsubWindow = api.onWindowStateChanged(setWindowState);
    const unsubDisplays = api.onDisplaysChanged(setDisplays);
    const unsubTiroState = api.tiro.onViewState(setTiroViewState);
    const unsubDiag = api.tiro.onDiagnostics(setTiroDiagnostics);
    const unsubRadar = api.tiro.onRadarCandidates(setTiroRadarCandidates);
    const unsubPicked = api.tiro.onElementPicked(setTiroPickedInfo);
    const unsubTelemetry = api.tiro.onTelemetry(setTiroTelemetry);

    return () => {
      unsubWindow();
      unsubDisplays();
      unsubTiroState();
      unsubDiag();
      unsubRadar();
      unsubPicked();
      unsubTelemetry();
    };
  }, []);

  // Report live layout metrics for automated Electron smoke testing (--smoke-test)
  useEffect(() => {
    const api = window.electronAPI;
    if (!api || activeSource !== 'mock' || captions.length < 2) return;
    const allTranslated = captions.slice(0, 2).every((c) => c.translationState === 'translated');
    if (!allTranslated) return;

    const pptEl = document.querySelector<HTMLElement>('.ppt-region');
    const captionEl = document.querySelector<HTMLElement>('.caption-region');
    const colEnEl = document.querySelector<HTMLElement>('.caption-col-en');
    const colKoEl = document.querySelector<HTMLElement>('.caption-col-ko');

    if (pptEl && captionEl && colEnEl && colKoEl) {
      const totalW = window.innerWidth;
      const totalH = window.innerHeight;
      const pptRatio = ((pptEl.getBoundingClientRect().width / totalW) * 100).toFixed(1);
      const capRatio = ((captionEl.getBoundingClientRect().width / totalW) * 100).toFixed(1);
      const enRatio = (
        (colEnEl.getBoundingClientRect().width / captionEl.getBoundingClientRect().width) *
        100
      ).toFixed(1);
      const koRatio = (
        (colKoEl.getBoundingClientRect().width / captionEl.getBoundingClientRect().width) *
        100
      ).toFixed(1);

      api.notifySmokeTestReady(
        `viewport=${totalW}x${totalH} ppt=${pptRatio}% caption=${capRatio}% cols=${enRatio}%/${koRatio}% cards=${captions.length}`
      );
    }
  }, [activeSource, captions]);

  const setNativeTiroVisible = useCallback((nextVisible: boolean) => {
    setTiroPanelVisible(nextVisible);
    void window.electronAPI?.tiro.setVisible(nextVisible);
    if (!nextVisible) {
      void window.electronAPI?.tiro.setBounds({ x: 0, y: 0, width: 0, height: 0 });
    }
  }, []);

  const handleSwitchSource = useCallback(
    (nextSource: ActiveCaptionSource) => {
      if (nextSource === activeSource) return;

      translationQueueRef.current?.clear();
      setCaptions([]);

      if (nextSource === 'tiro') {
        void mockProviderRef.current?.disconnect();
        setActiveSource('tiro');
        void tiroProviderRef.current?.connect();
        setNativeTiroVisible(true);
      } else {
        void tiroProviderRef.current?.disconnect();
        setNativeTiroVisible(false);
        setActiveSource('mock');
      }
    },
    [activeSource, setNativeTiroVisible]
  );

  const handleToggleTiroPanel = useCallback(() => {
    setNativeTiroVisible(!tiroPanelVisible);
  }, [setNativeTiroVisible, tiroPanelVisible]);

  const handleSelectTargetSelector = useCallback((selector: string) => {
    void tiroProviderRef.current?.observeSelector(selector);
  }, []);

  const handleStopObservingTiro = useCallback(() => {
    void tiroProviderRef.current?.disconnect();
  }, []);

  const handleToggleMockStream = useCallback(() => {
    const provider = mockProviderRef.current;
    if (!provider) return;
    if (provider.getStatus().state === 'connected') {
      void provider.disconnect();
    } else {
      void provider.connect();
    }
  }, []);

  const handleEmitSingleSample = useCallback(() => {
    mockProviderRef.current?.emitNextSentence();
  }, []);

  const handleEmitBurstSample = useCallback(() => {
    mockProviderRef.current?.emitBurst(3);
  }, []);

  const handleSimulateErrorSample = useCallback(() => {
    translationProviderRef.current?.setSimulateFailureNext(true);
    mockProviderRef.current?.emitNextSentence();
  }, []);

  const handleClearCaptions = useCallback(() => {
    translationQueueRef.current?.clear();
    setCaptions([]);
  }, []);

  const handleRetryTranslation = useCallback(
    (captionId: string) => {
      const target = captions.find((item) => item.id === captionId);
      if (!target) return;
      enqueueTranslationForCaption(target.id, target.englishText);
    },
    [captions, enqueueTranslationForCaption]
  );

  const handleToggleFullScreen = useCallback(() => {
    if (window.electronAPI) {
      void window.electronAPI.toggleFullScreen();
    } else if (!document.fullscreenElement) {
      void document.documentElement.requestFullscreen();
    } else {
      void document.exitFullscreen();
    }
  }, []);

  const handleMoveToDisplay = useCallback((displayId: number) => {
    void window.electronAPI?.moveToDisplay(displayId);
  }, []);

  const handleToggleCleanMode = useCallback(() => {
    setCleanMode((prev) => {
      const next = !prev;
      if (next && tiroPanelVisible) {
        setNativeTiroVisible(false);
      }
      return next;
    });
  }, [setNativeTiroVisible, tiroPanelVisible]);

  return (
    <main className="workspace-grid">
      {tiroPanelVisible ? (
        <TiroWorkspacePanel
          visible={tiroPanelVisible}
          onHideToSlides={() => setNativeTiroVisible(false)}
          onSelectTargetSelector={handleSelectTargetSelector}
          onStopObserving={handleStopObservingTiro}
          diagnostics={tiroDiagnostics}
          radarCandidates={tiroRadarCandidates}
          pickedInfo={tiroPickedInfo}
          telemetry={tiroTelemetry}
          viewState={tiroViewState}
        />
      ) : (
        <SlideStagePlaceholder
          cleanMode={cleanMode}
          onToggleCleanMode={handleToggleCleanMode}
          windowState={windowState}
          displays={displays}
          onToggleFullScreen={handleToggleFullScreen}
          onMoveToDisplay={handleMoveToDisplay}
        />
      )}

      <CaptionWorkspace
        captions={captions}
        activeSource={activeSource}
        tiroPanelVisible={tiroPanelVisible}
        tiroTelemetry={tiroTelemetry}
        captionStatus={captionStatus}
        translationStatus={translationStatus}
        cleanMode={cleanMode}
        fontSizePx={fontSizePx}
        cardGapPx={cardGapPx}
        onSwitchSource={handleSwitchSource}
        onToggleTiroPanel={handleToggleTiroPanel}
        onChangeFontSize={setFontSizePx}
        onChangeCardGap={setCardGapPx}
        onToggleMockStream={handleToggleMockStream}
        onEmitSingleSample={handleEmitSingleSample}
        onEmitBurstSample={handleEmitBurstSample}
        onSimulateErrorSample={handleSimulateErrorSample}
        onClearCaptions={handleClearCaptions}
        onRetryTranslation={handleRetryTranslation}
      />
    </main>
  );
};
