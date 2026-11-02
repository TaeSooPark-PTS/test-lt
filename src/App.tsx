import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  CaptionWorkspace,
  type ActiveCaptionSource
} from './components/CaptionWorkspace';
import { SlideStagePlaceholder } from './components/SlideStagePlaceholder';
import { TiroWorkspacePanel } from './components/TiroWorkspacePanel';
import { WindowsTitleBar } from './components/WindowsTitleBar';
import { MockCaptionProvider } from './providers/caption/MockCaptionProvider';
import { TiroCaptionProvider } from './providers/caption/TiroCaptionProvider';
import { LocalTranslationProvider } from './providers/translation/LocalTranslationProvider';
import { MockTranslationProvider } from './providers/translation/MockTranslationProvider';
import {
  TranslationQueue,
  type QueueTaskPriority
} from './providers/translation/TranslationQueue';
import type {
  CaptionCardItem,
  CaptionEvent,
  CaptionProviderStatus
} from './types/caption';
import type {
  DisplaySummary,
  TranscriptExportFormat,
  TranslatorStatus,
  WindowState
} from './types/electron';
import {
  DEFAULT_SETTINGS,
  type AppSettings,
  type CaptionLayout,
  type LiveView,
  type TranslationEngineId
} from './types/settings';
import type {
  TiroDomDiagnostics,
  TiroObserverTelemetry,
  TiroRadarCandidate,
  TiroSelectedElementInfo,
  TiroViewState
} from './types/tiro';
import type { TranslationProviderStatus } from './types/translation';
import {
  buildSuggestedExportFilename,
  formatTranscript
} from './utils/transcriptExport';

const INTERIM_DEBOUNCE_MS = 420;
const INTERIM_MIN_CHARS = 14;

export const App: React.FC = () => {
  const mockProviderRef = useRef<MockCaptionProvider | null>(null);
  const tiroProviderRef = useRef<TiroCaptionProvider | null>(null);
  const mockTranslationRef = useRef<MockTranslationProvider | null>(null);
  const localTranslationRef = useRef<LocalTranslationProvider | null>(null);
  const translationQueueRef = useRef<TranslationQueue | null>(null);
  const sequenceRef = useRef<number>(0);

  const interimTimersRef = useRef<Map<string, number>>(new Map());
  const lastInterimLenRef = useRef<Map<string, number>>(new Map());
  const isHeadlessRuntimeRef = useRef<boolean>(false);

  if (!mockProviderRef.current) {
    mockProviderRef.current = new MockCaptionProvider();
  }
  if (!tiroProviderRef.current) {
    tiroProviderRef.current = new TiroCaptionProvider();
  }
  if (!mockTranslationRef.current) {
    mockTranslationRef.current = new MockTranslationProvider();
  }
  if (!localTranslationRef.current) {
    localTranslationRef.current = new LocalTranslationProvider(false);
  }
  if (!translationQueueRef.current) {
    // Start with Mock provider until hydrated from Electron SettingsStore
    translationQueueRef.current = new TranslationQueue(mockTranslationRef.current, 3);
  }

  const [settings, setSettings] = useState<AppSettings>(() => ({
    ...DEFAULT_SETTINGS,
    translationEngine: window.electronAPI ? DEFAULT_SETTINGS.translationEngine : 'mock'
  }));
  const settingsRef = useRef<AppSettings>(settings);
  settingsRef.current = settings;

  const [settingsHydrated, setSettingsHydrated] = useState<boolean>(!window.electronAPI);

  const [activeSource, setActiveSource] = useState<ActiveCaptionSource>('mock');
  const [tiroPanelVisible, setTiroPanelVisible] = useState(false);

  const [captions, setCaptions] = useState<CaptionCardItem[]>([]);
  const [captionStatus, setCaptionStatus] = useState<CaptionProviderStatus>(() =>
    mockProviderRef.current!.getStatus()
  );
  const [translationStatus, setTranslationStatus] = useState<TranslationProviderStatus>(() =>
    mockTranslationRef.current!.getStatus()
  );
  const [translatorStatus, setTranslatorStatus] = useState<TranslatorStatus | null>(null);

  // Tiro Diagnostics & Inspector States
  const [tiroViewState, setTiroViewState] = useState<TiroViewState | null>(null);
  const [tiroDiagnostics, setTiroDiagnostics] = useState<TiroDomDiagnostics | null>(null);
  const [tiroRadarCandidates, setTiroRadarCandidates] = useState<TiroRadarCandidate[]>([]);
  const [tiroPickedInfo, setTiroPickedInfo] = useState<TiroSelectedElementInfo | null>(null);
  const [tiroTelemetry, setTiroTelemetry] = useState<TiroObserverTelemetry | null>(null);

  const [cleanMode, setCleanMode] = useState(false);
  const [layoutNotice, setLayoutNotice] = useState<string | null>(null);

  const [windowState, setWindowState] = useState<WindowState>({
    isFullScreen: false,
    isMaximized: false,
    isAlwaysOnTop: false,
    isPresentationMode: false,
    currentDisplayId: 0
  });
  const [displays, setDisplays] = useState<DisplaySummary[]>([]);

  const updateSettings = useCallback((patch: Partial<AppSettings>) => {
    setSettings((prev) => {
      const optimistic = { ...prev, ...patch };
      settingsRef.current = optimistic;
      return optimistic;
    });
    if (window.electronAPI?.settings) {
      void window.electronAPI.settings.update(patch).then((persisted) => {
        if (persisted) {
          setSettings(persisted);
          settingsRef.current = persisted;
        }
      });
    }
  }, []);

  const clearInterimTimers = useCallback(() => {
    for (const timerId of interimTimersRef.current.values()) {
      window.clearTimeout(timerId);
    }
    interimTimersRef.current.clear();
    lastInterimLenRef.current.clear();
  }, []);

  const enqueueTranslationForCaption = useCallback(
    (captionId: string, englishText: string, priority: QueueTaskPriority = 'high') => {
      const queue = translationQueueRef.current;
      if (!queue) return;

      queue.enqueue({
        captionId,
        text: englishText,
        sourceLanguage: 'en',
        targetLanguage: 'ko',
        priority,
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
    },
    []
  );

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

      const pendingTimer = interimTimersRef.current.get(event.id);
      if (pendingTimer !== undefined) {
        window.clearTimeout(pendingTimer);
        interimTimersRef.current.delete(event.id);
      }

      if (event.isFinal) {
        lastInterimLenRef.current.delete(event.id);
        enqueueTranslationForCaption(event.id, event.text, 'high');
      } else if (settingsRef.current.translateInterim) {
        const clean = event.text.replace(/\.\.\.$/, '').trim();
        const prevLen = lastInterimLenRef.current.get(event.id) ?? 0;
        if (clean.length >= INTERIM_MIN_CHARS && Math.abs(clean.length - prevLen) >= 6) {
          const timerId = window.setTimeout(() => {
            interimTimersRef.current.delete(event.id);
            lastInterimLenRef.current.set(event.id, clean.length);
            enqueueTranslationForCaption(event.id, clean, 'normal');
          }, INTERIM_DEBOUNCE_MS);
          interimTimersRef.current.set(event.id, timerId);
        }
      }
    },
    [enqueueTranslationForCaption]
  );

  // Sync TranslationQueue provider whenever translationEngine changes (after initial hydration)
  useEffect(() => {
    if (!settingsHydrated) return;
    const queue = translationQueueRef.current;
    if (!queue) return;

    if (settings.translationEngine === 'local' && window.electronAPI) {
      const localProv = localTranslationRef.current!;
      queue.setProvider(localProv, 1);
      setTranslationStatus(localProv.getStatus());
      const unsub = localProv.onStatusChange(setTranslationStatus);
      if (!isHeadlessRuntimeRef.current) {
        localProv.prepare();
      }
      return () => {
        unsub();
      };
    }

    const mockProv = mockTranslationRef.current!;
    queue.setProvider(mockProv, 3);
    setTranslationStatus(mockProv.getStatus());
    return undefined;
  }, [settings.translationEngine, settingsHydrated]);

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

  // Hydrate runtime info, settings, window state, Tiro & Translator listeners
  useEffect(() => {
    const api = window.electronAPI;
    const mockProvider = mockProviderRef.current!;

    if (!api) {
      mockProvider.emitBurst(2);
      return () => {
        clearInterimTimers();
        void mockProvider.disconnect();
        translationQueueRef.current?.clear();
      };
    }

    let cancelled = false;

    void Promise.all([
      api.getRuntimeInfo(),
      api.settings.get(),
      api.getWindowState(),
      api.getDisplays(),
      api.tiro.getState(),
      api.translator.getStatus()
    ]).then(([runtime, loadedSettings, winSt, dispList, tiroSt, transSt]) => {
      if (cancelled) return;
      const isHeadless = Boolean(runtime?.isSmokeTest || runtime?.isPocVerify);
      isHeadlessRuntimeRef.current = isHeadless;

      if (loadedSettings) {
        setSettings(loadedSettings);
        settingsRef.current = loadedSettings;
        if (loadedSettings.tiroSelector) {
          tiroProviderRef.current?.setTargetSelector(loadedSettings.tiroSelector);
        }
      }
      if (winSt) setWindowState(winSt);
      if (dispList) setDisplays(dispList);
      if (tiroSt) setTiroViewState(tiroSt);
      if (transSt) setTranslatorStatus(transSt);

      setSettingsHydrated(true);

      // If user already configured Tiro selector on a real desktop session, connect Tiro automatically;
      // otherwise seed 2 sample bilingual cards in Mock mode for instant preview & smoke test verification.
      if (!isHeadless && loadedSettings?.tiroSelector) {
        setActiveSource('tiro');
        void tiroProviderRef.current?.connect();
      } else {
        mockProvider.emitBurst(2);
      }
    });

    const unsubWindow = api.onWindowStateChanged(setWindowState);
    const unsubDisplays = api.onDisplaysChanged(setDisplays);
    const unsubSettings = api.settings.onChanged((next) => {
      if (next) {
        setSettings(next);
        settingsRef.current = next;
      }
    });
    const unsubTranslator = api.translator.onStatus(setTranslatorStatus);
    const unsubTiroState = api.tiro.onViewState(setTiroViewState);
    const unsubDiag = api.tiro.onDiagnostics(setTiroDiagnostics);
    const unsubRadar = api.tiro.onRadarCandidates(setTiroRadarCandidates);
    const unsubPicked = api.tiro.onElementPicked((info) => {
      setTiroPickedInfo(info);
      if (info?.selector) {
        tiroProviderRef.current?.setTargetSelector(info.selector);
        updateSettings({ tiroSelector: info.selector });
      }
    });
    const unsubTelemetry = api.tiro.onTelemetry(setTiroTelemetry);

    return () => {
      cancelled = true;
      clearInterimTimers();
      unsubWindow();
      unsubDisplays();
      unsubSettings();
      unsubTranslator();
      unsubTiroState();
      unsubDiag();
      unsubRadar();
      unsubPicked();
      unsubTelemetry();
      void mockProvider.disconnect();
      void tiroProviderRef.current?.disconnect();
      localTranslationRef.current?.destroy();
      translationQueueRef.current?.clear();
    };
  }, [clearInterimTimers, updateSettings]);

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

      clearInterimTimers();
      translationQueueRef.current?.clear();
      localTranslationRef.current?.cancelPending();
      setCaptions([]);

      if (nextSource === 'tiro') {
        void mockProviderRef.current?.disconnect();
        setActiveSource('tiro');
        if (settingsRef.current.tiroSelector) {
          tiroProviderRef.current?.setTargetSelector(settingsRef.current.tiroSelector);
        }
        void tiroProviderRef.current?.connect();
        if (!windowState.isPresentationMode && !settingsRef.current.tiroSelector) {
          setNativeTiroVisible(true);
        }
      } else {
        void tiroProviderRef.current?.disconnect();
        setNativeTiroVisible(false);
        setActiveSource('mock');
      }
    },
    [activeSource, clearInterimTimers, setNativeTiroVisible, windowState.isPresentationMode]
  );

  const handleToggleTiroPanel = useCallback(() => {
    setNativeTiroVisible(!tiroPanelVisible);
  }, [setNativeTiroVisible, tiroPanelVisible]);

  const handleSelectTargetSelector = useCallback(
    (selector: string) => {
      updateSettings({ tiroSelector: selector });
      void tiroProviderRef.current?.observeSelector(selector);
    },
    [updateSettings]
  );

  const handleStopObservingTiro = useCallback(() => {
    updateSettings({ tiroSelector: null });
    void tiroProviderRef.current?.disconnect();
  }, [updateSettings]);

  const handleStartProjectorPresentation = useCallback(async () => {
    const api = window.electronAPI;
    if (!api) return;
    if (tiroPanelVisible) {
      setNativeTiroVisible(false);
    }
    const res = await api.layout.apply({
      displayId: settingsRef.current.projectorDisplayId,
      pptRatio: settingsRef.current.pptRatio,
      arrangePpt: true,
      startSlideshow: true
    });
    if (res?.pptResult) {
      setLayoutNotice(res.pptResult.message);
    }
  }, [setNativeTiroVisible, tiroPanelVisible]);

  const handleExitPresentationMode = useCallback(async () => {
    await window.electronAPI?.layout.exit();
    setLayoutNotice(null);
  }, []);

  const handleTogglePresentationMode = useCallback(() => {
    if (windowState.isPresentationMode) {
      void handleExitPresentationMode();
    } else {
      void handleStartProjectorPresentation();
    }
  }, [handleExitPresentationMode, handleStartProjectorPresentation, windowState.isPresentationMode]);

  const handleArrangePptOnly = useCallback(async () => {
    const res = await window.electronAPI?.layout.arrangePpt(true);
    if (res) {
      setLayoutNotice(res.message);
    }
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
    if (settingsRef.current.translationEngine !== 'mock') {
      updateSettings({ translationEngine: 'mock' });
    }
    mockTranslationRef.current?.setSimulateFailureNext(true);
    mockProviderRef.current?.emitNextSentence();
  }, [updateSettings]);

  const handleClearCaptions = useCallback(() => {
    clearInterimTimers();
    translationQueueRef.current?.clear();
    localTranslationRef.current?.cancelPending();
    setCaptions([]);
  }, [clearInterimTimers]);

  const handleRetryTranslation = useCallback(
    (captionId: string) => {
      const target = captions.find((item) => item.id === captionId);
      if (!target) return;
      enqueueTranslationForCaption(target.id, target.englishText, 'high');
    },
    [captions, enqueueTranslationForCaption]
  );

  const handleExportTranscript = useCallback(
    async (format: TranscriptExportFormat) => {
      if (captions.length === 0) return;
      const content = formatTranscript(captions, format);
      const suggestedName = buildSuggestedExportFilename(format);
      if (window.electronAPI?.captions) {
        const res = await window.electronAPI.captions.exportFile({
          format,
          content,
          suggestedName
        });
        if (res.saved && res.filePath) {
          setLayoutNotice(`자막 기록이 저장되었습니다: ${res.filePath}`);
        } else if (res.error) {
          setLayoutNotice(`저장 오류: ${res.error}`);
        }
        return;
      }

      // Fallback browser download
      const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = suggestedName;
      anchor.click();
      URL.revokeObjectURL(url);
    },
    [captions]
  );

  const handleCopyTranscript = useCallback(async (): Promise<boolean> => {
    if (captions.length === 0) return false;
    try {
      const text = formatTranscript(captions, 'txt');
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  }, [captions]);

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

  const handleChangeFontSize = useCallback(
    (nextSize: number) => updateSettings({ fontSizePx: nextSize }),
    [updateSettings]
  );
  const handleChangeCardGap = useCallback(
    (nextGap: number) => updateSettings({ cardGapPx: nextGap }),
    [updateSettings]
  );
  const handleChangeCaptionLayout = useCallback(
    (captionLayout: CaptionLayout) => updateSettings({ captionLayout }),
    [updateSettings]
  );
  const handleChangeLiveView = useCallback(
    (liveView: LiveView) => updateSettings({ liveView }),
    [updateSettings]
  );
  const handleToggleShowEnglish = useCallback(
    () => updateSettings({ showEnglish: !settingsRef.current.showEnglish }),
    [updateSettings]
  );
  const handleChangeTranslationEngine = useCallback(
    (translationEngine: TranslationEngineId) => updateSettings({ translationEngine }),
    [updateSettings]
  );
  const handleToggleTranslateInterim = useCallback(
    () => updateSettings({ translateInterim: !settingsRef.current.translateInterim }),
    [updateSettings]
  );
  const handleRetryPrepareTranslator = useCallback(() => {
    localTranslationRef.current?.prepare();
  }, []);

  const gridStyle = windowState.isPresentationMode
    ? undefined
    : ({
        gridTemplateColumns: `${settings.pptRatio}% ${100 - settings.pptRatio}%`
      } as React.CSSProperties);

  return (
    <div className="app-shell">
      <WindowsTitleBar
        windowState={windowState}
        cleanMode={cleanMode}
        captionStatus={captionStatus}
        translationEngine={settings.translationEngine}
        translatorStatus={translatorStatus}
        onTogglePresentationMode={handleTogglePresentationMode}
        onToggleCleanMode={handleToggleCleanMode}
        onToggleAlwaysOnTop={() => void window.electronAPI?.win.toggleAlwaysOnTop()}
        onMinimize={() => void window.electronAPI?.win.minimize()}
        onToggleMaximize={() => void window.electronAPI?.win.toggleMaximize()}
        onClose={() => void window.electronAPI?.win.close()}
      />

      <main
        className={`workspace-grid ${
          windowState.isPresentationMode ? 'workspace-grid-presentation' : ''
        }`}
        style={gridStyle}
      >
        {!windowState.isPresentationMode &&
          (tiroPanelVisible ? (
            <TiroWorkspacePanel
              visible={tiroPanelVisible}
              savedSelector={settings.tiroSelector}
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
              projectorDisplayId={settings.projectorDisplayId}
              pptRatio={settings.pptRatio}
              pptBorderless={settings.pptBorderless}
              layoutNotice={layoutNotice}
              onChangeProjectorDisplay={(projectorDisplayId) =>
                updateSettings({ projectorDisplayId })
              }
              onChangePptRatio={(pptRatio) => updateSettings({ pptRatio })}
              onTogglePptBorderless={() =>
                updateSettings({ pptBorderless: !settingsRef.current.pptBorderless })
              }
              onStartProjectorPresentation={() => void handleStartProjectorPresentation()}
              onArrangePptOnly={() => void handleArrangePptOnly()}
              onOpenTiroSetup={() => {
                if (activeSource !== 'tiro') {
                  handleSwitchSource('tiro');
                }
                setNativeTiroVisible(true);
              }}
              onToggleFullScreen={handleToggleFullScreen}
              onMoveToDisplay={handleMoveToDisplay}
            />
          ))}

        <CaptionWorkspace
          captions={captions}
          activeSource={activeSource}
          tiroPanelVisible={tiroPanelVisible}
          tiroTelemetry={tiroTelemetry}
          captionStatus={captionStatus}
          translationStatus={translationStatus}
          translatorStatus={translatorStatus}
          cleanMode={cleanMode}
          fontSizePx={settings.fontSizePx}
          cardGapPx={settings.cardGapPx}
          captionLayout={settings.captionLayout}
          liveView={settings.liveView}
          showEnglish={settings.showEnglish}
          translationEngine={settings.translationEngine}
          translateInterim={settings.translateInterim}
          isPresentationMode={windowState.isPresentationMode}
          onSwitchSource={handleSwitchSource}
          onToggleTiroPanel={handleToggleTiroPanel}
          onChangeFontSize={handleChangeFontSize}
          onChangeCardGap={handleChangeCardGap}
          onChangeCaptionLayout={handleChangeCaptionLayout}
          onChangeLiveView={handleChangeLiveView}
          onToggleShowEnglish={handleToggleShowEnglish}
          onChangeTranslationEngine={handleChangeTranslationEngine}
          onToggleTranslateInterim={handleToggleTranslateInterim}
          onRetryPrepareTranslator={handleRetryPrepareTranslator}
          onExportTranscript={(fmt) => void handleExportTranscript(fmt)}
          onCopyTranscript={handleCopyTranscript}
          onToggleMockStream={handleToggleMockStream}
          onEmitSingleSample={handleEmitSingleSample}
          onEmitBurstSample={handleEmitBurstSample}
          onSimulateErrorSample={handleSimulateErrorSample}
          onClearCaptions={handleClearCaptions}
          onRetryTranslation={handleRetryTranslation}
        />
      </main>
    </div>
  );
};
