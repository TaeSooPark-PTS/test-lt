import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  CaptionWorkspace,
  type ActiveCaptionSource
} from './components/CaptionWorkspace';
import { ReadinessGuideModal } from './components/ReadinessGuideModal';
import {
  createLoadedSlidesFromFiles,
  SlideStagePlaceholder,
  type LoadedImageSlide
} from './components/SlideStagePlaceholder';
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
  TranscriptSessionSummary,
  TranslatorStatus,
  WindowState
} from './types/electron';
import {
  DEFAULT_SETTINGS,
  type AppSettings,
  type CaptionLayout,
  type LiveView,
  type SourceLanguageSetting,
  type TargetLanguageSetting,
  type TranslationEngineId
} from './types/settings';
import type {
  TiroDomDiagnostics,
  TiroElementFingerprint,
  TiroObserverTelemetry,
  TiroRadarCandidate,
  TiroSelectedElementInfo,
  TiroViewState
} from './types/tiro';
import type { TranslationProviderStatus } from './types/translation';
import { detectSpeechLanguage } from './utils/languageDetector';
import {
  buildSuggestedExportFilename,
  formatTranscript
} from './utils/transcriptExport';

const INTERIM_DEBOUNCE_MS = 380;
const INTERIM_MIN_CHARS = 12;
const SESSION_AUTOSAVE_DEBOUNCE_MS = 650;

function createSessionId(): string {
  return `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

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
  const userRequestedLocalPrepareRef = useRef<boolean>(false);

  // Crash-safe session persistence tracking
  const sessionIdRef = useRef<string>(createSessionId());
  const sessionStartedAtRef = useRef<number>(Date.now());
  const hasUserTranscriptActivityRef = useRef<boolean>(false);
  const autoSaveTimerRef = useRef<number | null>(null);

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
  const activeSourceRef = useRef<ActiveCaptionSource>(activeSource);
  activeSourceRef.current = activeSource;

  const [tiroPanelVisible, setTiroPanelVisible] = useState(false);
  const [showReadinessModal, setShowReadinessModal] = useState(false);

  const [captions, setCaptions] = useState<CaptionCardItem[]>([]);
  const captionsRef = useRef<CaptionCardItem[]>(captions);
  captionsRef.current = captions;

  // Lifted built-in image slide deck state so Tiro panel / presentation mode toggles never lose slides
  const [imageSlides, setImageSlides] = useState<LoadedImageSlide[]>([]);
  const imageSlidesRef = useRef<LoadedImageSlide[]>(imageSlides);
  imageSlidesRef.current = imageSlides;
  const [slideIndex, setSlideIndex] = useState<number>(0);

  // Session auto-save & recovery state
  const [savedSessions, setSavedSessions] = useState<TranscriptSessionSummary[]>([]);
  const [currentSessionSavedAt, setCurrentSessionSavedAt] = useState<number | null>(null);
  const [recoverableSession, setRecoverableSession] = useState<TranscriptSessionSummary | null>(
    null
  );

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
    presentationStageMode: 'none',
    currentDisplayId: 0
  });
  const [displays, setDisplays] = useState<DisplaySummary[]>([]);

  // Cleanup any remaining blob slide URLs on unmount
  useEffect(() => {
    return () => {
      imageSlidesRef.current.forEach((s) => URL.revokeObjectURL(s.url));
    };
  }, []);

  const handleLoadImageFiles = useCallback((fileList: FileList | File[]) => {
    const nextSlides = createLoadedSlidesFromFiles(fileList);
    if (nextSlides.length === 0) return;
    setImageSlides((prev) => {
      prev.forEach((s) => URL.revokeObjectURL(s.url));
      return nextSlides;
    });
    setSlideIndex(0);
  }, []);

  const handleResetDeck = useCallback(() => {
    setImageSlides((prev) => {
      prev.forEach((s) => URL.revokeObjectURL(s.url));
      return [];
    });
    setSlideIndex(0);
  }, []);

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

  const refreshSavedSessions = useCallback(async () => {
    const api = window.electronAPI?.captions;
    if (!api) return [];
    const list = await api.listSessions();
    setSavedSessions(list);
    return list;
  }, []);

  const flushSessionSaveNow = useCallback(
    async (itemsSnapshot?: CaptionCardItem[], sourceSnapshot?: ActiveCaptionSource) => {
      const api = window.electronAPI?.captions;
      if (!api || !hasUserTranscriptActivityRef.current) return;
      const itemsToSave = itemsSnapshot ?? captionsRef.current;
      if (itemsToSave.length === 0) return;

      if (autoSaveTimerRef.current !== null) {
        window.clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = null;
      }

      const saved = await api.saveSession({
        sessionId: sessionIdRef.current,
        source: sourceSnapshot ?? activeSourceRef.current,
        sourceLanguage: settingsRef.current.sourceLanguage,
        targetLanguage: settingsRef.current.targetLanguage,
        startedAt: sessionStartedAtRef.current,
        items: itemsToSave
      });
      if (saved) {
        setCurrentSessionSavedAt(saved.updatedAt);
        void refreshSavedSessions();
      }
    },
    [refreshSavedSessions]
  );

  const rotateToFreshSession = useCallback(() => {
    sessionIdRef.current = createSessionId();
    sessionStartedAtRef.current = Date.now();
    hasUserTranscriptActivityRef.current = false;
    setCurrentSessionSavedAt(null);
  }, []);

  // Debounced automatic per-session disk backup whenever captions update
  useEffect(() => {
    if (!window.electronAPI?.captions) return;
    if (!hasUserTranscriptActivityRef.current || captions.length === 0) return;

    if (autoSaveTimerRef.current !== null) {
      window.clearTimeout(autoSaveTimerRef.current);
    }
    autoSaveTimerRef.current = window.setTimeout(() => {
      autoSaveTimerRef.current = null;
      void flushSessionSaveNow(captions, activeSourceRef.current);
    }, SESSION_AUTOSAVE_DEBOUNCE_MS);

    return () => {
      if (autoSaveTimerRef.current !== null) {
        window.clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = null;
      }
    };
  }, [captions, flushSessionSaveNow]);

  // Flush unsaved transcript snapshot immediately before window close / reload
  useEffect(() => {
    const handleBeforeUnload = () => {
      void flushSessionSaveNow();
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [flushSessionSaveNow]);

  const clearInterimTimers = useCallback(() => {
    for (const timerId of interimTimersRef.current.values()) {
      window.clearTimeout(timerId);
    }
    interimTimersRef.current.clear();
    lastInterimLenRef.current.clear();
  }, []);

  const enqueueTranslationForCaption = useCallback(
    (
      captionId: string,
      sourceText: string,
      priority: QueueTaskPriority = 'high',
      isInterim = false
    ) => {
      const queue = translationQueueRef.current;
      if (!queue) return;

      queue.enqueue({
        captionId,
        text: sourceText,
        sourceLanguage: settingsRef.current.sourceLanguage,
        targetLanguage: settingsRef.current.targetLanguage,
        priority,
        options: {
          isInterim,
          glossaryRaw: settingsRef.current.glossaryRaw
        },
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
      if (activeSourceRef.current === 'tiro') {
        hasUserTranscriptActivityRef.current = true;
      }

      const configuredSrc = settingsRef.current.sourceLanguage;
      const detectedLang =
        configuredSrc === 'auto' ? detectSpeechLanguage(event.text, 'en') : configuredSrc;

      setCaptions((prev) => {
        const existingIndex = prev.findIndex((item) => item.id === event.id);
        if (existingIndex === -1) {
          sequenceRef.current += 1;
          const nextItem: CaptionCardItem = {
            id: event.id,
            sequence: sequenceRef.current,
            englishText: event.text,
            koreanText: null,
            detectedLang,
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
          detectedLang,
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
        enqueueTranslationForCaption(event.id, event.text, 'high', false);
      } else if (settingsRef.current.translateInterim) {
        const clean = event.text.replace(/\.\.\.$/, '').trim();
        const prevLen = lastInterimLenRef.current.get(event.id) ?? 0;
        if (clean.length >= INTERIM_MIN_CHARS && Math.abs(clean.length - prevLen) >= 5) {
          const timerId = window.setTimeout(() => {
            interimTimersRef.current.delete(event.id);
            lastInterimLenRef.current.set(event.id, clean.length);
            enqueueTranslationForCaption(event.id, clean, 'normal', true);
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
      // Only auto-start worker immediately if model is already cached on disk or user explicitly requested download
      if (!isHeadlessRuntimeRef.current && userRequestedLocalPrepareRef.current) {
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

  // Hydrate runtime info, settings, window state, Tiro, Translator & saved sessions
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
      api.translator.getStatus(),
      api.captions.listSessions()
    ]).then(([runtime, loadedSettings, winSt, dispList, tiroSt, transSt, sessionList]) => {
      if (cancelled) return;
      const isHeadless = Boolean(runtime?.isSmokeTest || runtime?.isPocVerify);
      isHeadlessRuntimeRef.current = isHeadless;

      if (transSt) {
        setTranslatorStatus(transSt);
        if (transSt.cachedOnDisk) {
          userRequestedLocalPrepareRef.current = true;
        }
      }

      if (loadedSettings) {
        setSettings(loadedSettings);
        settingsRef.current = loadedSettings;
        if (loadedSettings.tiroSelector) {
          tiroProviderRef.current?.setTargetSelector(
            loadedSettings.tiroSelector,
            loadedSettings.tiroFingerprint ?? null
          );
        }

        // First-run clarity: if Local AI is selected, model is not yet cached on disk, and guide hasn't been shown,
        // open the Pre-Flight Readiness Guide instead of silently starting a ~680MB background download.
        if (
          !isHeadless &&
          loadedSettings.translationEngine === 'local' &&
          !transSt?.cachedOnDisk &&
          !loadedSettings.firstRunGuideDismissed
        ) {
          setShowReadinessModal(true);
        }
      }

      if (winSt) setWindowState(winSt);
      if (dispList) setDisplays(dispList);
      if (tiroSt) setTiroViewState(tiroSt);
      if (sessionList) {
        setSavedSessions(sessionList);
        if (!isHeadless && sessionList.length > 0 && sessionList[0].captionCount > 0) {
          setRecoverableSession(sessionList[0]);
        }
      }

      setSettingsHydrated(true);

      // If user already configured Tiro selector on a real desktop session, connect Tiro automatically;
      // otherwise seed 2 sample bilingual cards in Mock mode for instant preview & smoke test verification.
      if (!isHeadless && loadedSettings?.tiroSelector) {
        setActiveSource('tiro');
        activeSourceRef.current = 'tiro';
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
        tiroProviderRef.current?.setTargetSelector(info.selector, info.fingerprint ?? null);
        updateSettings({
          tiroSelector: info.selector,
          tiroFingerprint: info.fingerprint ?? null
        });
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

      void flushSessionSaveNow(captionsRef.current, activeSourceRef.current);
      rotateToFreshSession();

      clearInterimTimers();
      translationQueueRef.current?.clear();
      localTranslationRef.current?.cancelPending();
      setCaptions([]);

      if (nextSource === 'tiro') {
        void mockProviderRef.current?.disconnect();
        setActiveSource('tiro');
        activeSourceRef.current = 'tiro';
        if (settingsRef.current.tiroSelector) {
          tiroProviderRef.current?.setTargetSelector(
            settingsRef.current.tiroSelector,
            settingsRef.current.tiroFingerprint ?? null
          );
        }
        void tiroProviderRef.current?.connect();
        if (!windowState.isPresentationMode && !settingsRef.current.tiroSelector) {
          setNativeTiroVisible(true);
        }
      } else {
        void tiroProviderRef.current?.disconnect();
        setNativeTiroVisible(false);
        setActiveSource('mock');
        activeSourceRef.current = 'mock';
      }
    },
    [
      activeSource,
      clearInterimTimers,
      flushSessionSaveNow,
      rotateToFreshSession,
      setNativeTiroVisible,
      windowState.isPresentationMode
    ]
  );

  const handleToggleTiroPanel = useCallback(() => {
    setNativeTiroVisible(!tiroPanelVisible);
  }, [setNativeTiroVisible, tiroPanelVisible]);

  const handleSelectTargetSelector = useCallback(
    (selector: string, fingerprint?: TiroElementFingerprint | null) => {
      const nextPatch: Partial<AppSettings> = { tiroSelector: selector };
      if (fingerprint !== undefined) {
        nextPatch.tiroFingerprint = fingerprint;
      }
      updateSettings(nextPatch);
      void tiroProviderRef.current?.observeSelector(selector, fingerprint);
    },
    [updateSettings]
  );

  const handleStopObservingTiro = useCallback(() => {
    updateSettings({ tiroSelector: null, tiroFingerprint: null });
    void tiroProviderRef.current?.disconnect();
  }, [updateSettings]);

  const handleStartProjectorPresentation = useCallback(async () => {
    const api = window.electronAPI;
    if (!api) return;
    if (tiroPanelVisible) {
      setNativeTiroVisible(false);
    }
    const hasCustomDeck = imageSlidesRef.current.length > 0;
    const res = await api.layout.apply({
      displayId: settingsRef.current.projectorDisplayId,
      pptRatio: settingsRef.current.pptRatio,
      arrangePpt: true,
      startSlideshow: true,
      stageMode: hasCustomDeck ? 'auto' : 'external-ppt',
      hasCustomDeck
    });
    if (res?.stageMode === 'builtin-deck') {
      setLayoutNotice(
        'PowerPoint 슬라이드쇼가 감지되지 않아 불러온 이미지 슬라이드 + 실시간 자막 통합 프로젝터 모드로 전환했습니다.'
      );
    } else if (res?.pptResult) {
      setLayoutNotice(res.pptResult.message);
    }
  }, [setNativeTiroVisible, tiroPanelVisible]);

  const handleStartBuiltinPresentation = useCallback(async () => {
    const api = window.electronAPI;
    if (!api) {
      if (!document.fullscreenElement) {
        void document.documentElement.requestFullscreen();
      }
      return;
    }
    if (tiroPanelVisible) {
      setNativeTiroVisible(false);
    }
    const res = await api.layout.apply({
      displayId: settingsRef.current.projectorDisplayId,
      pptRatio: settingsRef.current.pptRatio,
      arrangePpt: false,
      startSlideshow: false,
      stageMode: 'builtin-deck',
      hasCustomDeck: imageSlidesRef.current.length > 0
    });
    if (res) {
      setLayoutNotice(
        `프로젝터(${res.displayLabel})에 내장 슬라이드 스테이지(${settingsRef.current.pptRatio}%)와 실시간 자막(${
          100 - settingsRef.current.pptRatio
        }%)을 함께 배치했습니다.`
      );
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
      hasUserTranscriptActivityRef.current = true;
      void provider.connect();
    }
  }, []);

  const handleEmitSingleSample = useCallback(() => {
    hasUserTranscriptActivityRef.current = true;
    mockProviderRef.current?.emitNextSentence();
  }, []);

  const handleEmitBurstSample = useCallback(() => {
    hasUserTranscriptActivityRef.current = true;
    mockProviderRef.current?.emitBurst(3);
  }, []);

  const handleSimulateErrorSample = useCallback(() => {
    hasUserTranscriptActivityRef.current = true;
    if (settingsRef.current.translationEngine !== 'mock') {
      updateSettings({ translationEngine: 'mock' });
    }
    mockTranslationRef.current?.setSimulateFailureNext(true);
    mockProviderRef.current?.emitNextSentence();
  }, [updateSettings]);

  const handleClearCaptions = useCallback(() => {
    void flushSessionSaveNow(captionsRef.current, activeSourceRef.current);
    rotateToFreshSession();
    clearInterimTimers();
    translationQueueRef.current?.clear();
    localTranslationRef.current?.cancelPending();
    setCaptions([]);
  }, [clearInterimTimers, flushSessionSaveNow, rotateToFreshSession]);

  const handleRestoreSession = useCallback(
    async (targetSessionId: string) => {
      const api = window.electronAPI?.captions;
      if (!api) return;

      if (sessionIdRef.current !== targetSessionId) {
        await flushSessionSaveNow(captionsRef.current, activeSourceRef.current);
      }

      const record = await api.loadSession(targetSessionId);
      if (!record || record.items.length === 0) return;

      clearInterimTimers();
      translationQueueRef.current?.clear();

      sessionIdRef.current = record.sessionId;
      sessionStartedAtRef.current = record.startedAt;
      hasUserTranscriptActivityRef.current = true;

      const maxSeq = record.items.reduce((acc, item) => Math.max(acc, item.sequence || 0), 0);
      sequenceRef.current = Math.max(sequenceRef.current, maxSeq);

      setCaptions(record.items);
      setCurrentSessionSavedAt(record.updatedAt);
      setRecoverableSession(null);
      setLayoutNotice(`"${record.title}" 세션(${record.items.length}문장)을 복구했습니다.`);

      // Resume translation for any items that were pending/translating when the app exited
      for (const item of record.items) {
        if (
          !item.koreanText &&
          (item.translationState === 'pending' || item.translationState === 'translating')
        ) {
          enqueueTranslationForCaption(
            item.id,
            item.englishText,
            'high',
            item.captionStatus === 'interim'
          );
        }
      }
    },
    [clearInterimTimers, enqueueTranslationForCaption, flushSessionSaveNow]
  );

  const handleDeleteSession = useCallback(
    async (targetSessionId: string) => {
      const api = window.electronAPI?.captions;
      if (!api) return;
      await api.deleteSession(targetSessionId);
      if (recoverableSession?.sessionId === targetSessionId) {
        setRecoverableSession(null);
      }
      await refreshSavedSessions();
    },
    [recoverableSession?.sessionId, refreshSavedSessions]
  );

  const handleOpenSessionsDir = useCallback(() => {
    void window.electronAPI?.captions.openSessionsDir();
  }, []);

  const handleRetryTranslation = useCallback(
    (captionId: string) => {
      const target = captions.find((item) => item.id === captionId);
      if (!target) return;
      enqueueTranslationForCaption(
        target.id,
        target.englishText,
        'high',
        target.captionStatus === 'interim'
      );
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
    (translationEngine: TranslationEngineId) => {
      if (translationEngine === 'local') {
        userRequestedLocalPrepareRef.current = true;
      }
      updateSettings({ translationEngine });
      if (translationEngine === 'local' && !isHeadlessRuntimeRef.current) {
        localTranslationRef.current?.prepare();
      }
    },
    [updateSettings]
  );
  const handleChangeSourceLanguage = useCallback(
    (sourceLanguage: SourceLanguageSetting) => updateSettings({ sourceLanguage }),
    [updateSettings]
  );
  const handleChangeTargetLanguage = useCallback(
    (targetLanguage: TargetLanguageSetting) => updateSettings({ targetLanguage }),
    [updateSettings]
  );
  const handleChangeGlossaryRaw = useCallback(
    (glossaryRaw: string) => updateSettings({ glossaryRaw }),
    [updateSettings]
  );
  const handleToggleTranslateInterim = useCallback(
    () => updateSettings({ translateInterim: !settingsRef.current.translateInterim }),
    [updateSettings]
  );
  const handleRetryPrepareTranslator = useCallback(() => {
    userRequestedLocalPrepareRef.current = true;
    updateSettings({ firstRunGuideDismissed: true });
    localTranslationRef.current?.prepare();
  }, [updateSettings]);

  const handleStartModelDownloadFromGuide = useCallback(() => {
    userRequestedLocalPrepareRef.current = true;
    updateSettings({
      translationEngine: 'local',
      firstRunGuideDismissed: true
    });
    localTranslationRef.current?.prepare();
  }, [updateSettings]);

  const handleUseMockEngineFromGuide = useCallback(() => {
    updateSettings({
      translationEngine: 'mock',
      firstRunGuideDismissed: true
    });
    setShowReadinessModal(false);
  }, [updateSettings]);

  const handleCloseReadinessGuide = useCallback(() => {
    if (!settingsRef.current.firstRunGuideDismissed) {
      updateSettings({ firstRunGuideDismissed: true });
    }
    setShowReadinessModal(false);
  }, [updateSettings]);

  const handleOpenTiroFromModal = useCallback(() => {
    setShowReadinessModal(false);
    if (!settingsRef.current.firstRunGuideDismissed) {
      updateSettings({ firstRunGuideDismissed: true });
    }
    if (activeSourceRef.current !== 'tiro') {
      handleSwitchSource('tiro');
    }
    setNativeTiroVisible(true);
  }, [handleSwitchSource, setNativeTiroVisible, updateSettings]);

  const isBuiltinPresentation =
    windowState.isPresentationMode && windowState.presentationStageMode === 'builtin-deck';
  const isExternalSidebarPresentation =
    windowState.isPresentationMode && !isBuiltinPresentation;
  const showLeftStage = !isExternalSidebarPresentation;

  const gridStyle = isExternalSidebarPresentation
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
        onStartBuiltinPresentation={() => void handleStartBuiltinPresentation()}
        onOpenReadinessGuide={() => setShowReadinessModal(true)}
        onToggleCleanMode={handleToggleCleanMode}
        onToggleAlwaysOnTop={() => void window.electronAPI?.win.toggleAlwaysOnTop()}
        onMinimize={() => void window.electronAPI?.win.minimize()}
        onToggleMaximize={() => void window.electronAPI?.win.toggleMaximize()}
        onClose={() => void window.electronAPI?.win.close()}
      />

      <main
        className={`workspace-grid ${
          isExternalSidebarPresentation ? 'workspace-grid-presentation' : ''
        }`}
        style={gridStyle}
      >
        {showLeftStage &&
          (tiroPanelVisible && !isBuiltinPresentation ? (
            <TiroWorkspacePanel
              visible={tiroPanelVisible}
              modalOverlayOpen={showReadinessModal}
              savedSelector={settings.tiroSelector}
              hasSavedFingerprint={Boolean(settings.tiroFingerprint)}
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
              imageSlides={imageSlides}
              slideIndex={slideIndex}
              onLoadImageFiles={handleLoadImageFiles}
              onResetDeck={handleResetDeck}
              onChangeSlideIndex={setSlideIndex}
              onChangeProjectorDisplay={(projectorDisplayId) =>
                updateSettings({ projectorDisplayId })
              }
              onChangePptRatio={(pptRatio) => updateSettings({ pptRatio })}
              onTogglePptBorderless={() =>
                updateSettings({ pptBorderless: !settingsRef.current.pptBorderless })
              }
              onStartProjectorPresentation={() => void handleStartProjectorPresentation()}
              onStartBuiltinPresentation={() => void handleStartBuiltinPresentation()}
              onExitPresentationMode={() => void handleExitPresentationMode()}
              onArrangePptOnly={() => void handleArrangePptOnly()}
              onOpenTiroSetup={() => {
                if (activeSource !== 'tiro') {
                  handleSwitchSource('tiro');
                }
                setNativeTiroVisible(true);
              }}
              onOpenReadinessGuide={() => setShowReadinessModal(true)}
              onToggleFullScreen={handleToggleFullScreen}
              onMoveToDisplay={handleMoveToDisplay}
            />
          ))}

        <CaptionWorkspace
          captions={captions}
          activeSource={activeSource}
          tiroPanelVisible={tiroPanelVisible}
          modalOverlayOpen={showReadinessModal}
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
          sourceLanguage={settings.sourceLanguage}
          targetLanguage={settings.targetLanguage}
          glossaryRaw={settings.glossaryRaw}
          translateInterim={settings.translateInterim}
          isPresentationMode={windowState.isPresentationMode}
          savedSessions={savedSessions}
          currentSessionSavedAt={currentSessionSavedAt}
          recoverableSession={recoverableSession}
          onDismissRecoverableBanner={() => setRecoverableSession(null)}
          onRestoreSession={(sid) => void handleRestoreSession(sid)}
          onDeleteSession={(sid) => void handleDeleteSession(sid)}
          onOpenSessionsDir={handleOpenSessionsDir}
          onOpenReadinessGuide={() => setShowReadinessModal(true)}
          onSwitchSource={handleSwitchSource}
          onToggleTiroPanel={handleToggleTiroPanel}
          onChangeFontSize={handleChangeFontSize}
          onChangeCardGap={handleChangeCardGap}
          onChangeCaptionLayout={handleChangeCaptionLayout}
          onChangeLiveView={handleChangeLiveView}
          onToggleShowEnglish={handleToggleShowEnglish}
          onChangeTranslationEngine={handleChangeTranslationEngine}
          onChangeSourceLanguage={handleChangeSourceLanguage}
          onChangeTargetLanguage={handleChangeTargetLanguage}
          onChangeGlossaryRaw={handleChangeGlossaryRaw}
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

      <ReadinessGuideModal
        open={showReadinessModal}
        translatorStatus={translatorStatus}
        translationEngine={settings.translationEngine}
        hasSavedTiroSelector={Boolean(settings.tiroSelector)}
        hasCustomSlideDeck={imageSlides.length > 0}
        onStartModelDownload={handleStartModelDownloadFromGuide}
        onUseMockEngine={handleUseMockEngineFromGuide}
        onOpenTiroSetup={handleOpenTiroFromModal}
        onClose={handleCloseReadinessGuide}
      />
    </div>
  );
};
