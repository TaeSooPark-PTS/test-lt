import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CaptionCardItem, CaptionProviderStatus } from '../types/caption';
import type {
  TranscriptExportFormat,
  TranscriptSessionSummary,
  TranslatorStatus
} from '../types/electron';
import type {
  CaptionLayout,
  LiveView,
  SourceLanguageSetting,
  TargetLanguageSetting,
  TranslationEngineId
} from '../types/settings';
import type { TiroObserverTelemetry } from '../types/tiro';
import type { TranslationProviderStatus } from '../types/translation';
import {
  SOURCE_LANGUAGE_OPTIONS,
  TARGET_LANGUAGE_OPTIONS
} from '../utils/languageDetector';
import { VirtualizedCaptionList } from './VirtualizedCaptionList';

export type ActiveCaptionSource = 'mock' | 'tiro';

interface CaptionWorkspaceProps {
  captions: CaptionCardItem[];
  activeSource: ActiveCaptionSource;
  tiroPanelVisible: boolean;
  modalOverlayOpen?: boolean;
  tiroTelemetry: TiroObserverTelemetry | null;
  captionStatus: CaptionProviderStatus;
  translationStatus: TranslationProviderStatus;
  translatorStatus: TranslatorStatus | null;
  cleanMode: boolean;
  fontSizePx: number;
  cardGapPx: number;
  captionLayout: CaptionLayout;
  liveView: LiveView;
  showEnglish: boolean;
  translationEngine: TranslationEngineId;
  sourceLanguage: SourceLanguageSetting;
  targetLanguage: TargetLanguageSetting;
  glossaryRaw: string;
  translateInterim: boolean;
  isPresentationMode?: boolean;
  savedSessions: TranscriptSessionSummary[];
  currentSessionSavedAt: number | null;
  recoverableSession: TranscriptSessionSummary | null;
  onDismissRecoverableBanner: () => void;
  onRestoreSession: (sessionId: string) => void;
  onDeleteSession: (sessionId: string) => void;
  onOpenSessionsDir: () => void;
  onOpenReadinessGuide: () => void;
  onSwitchSource: (source: ActiveCaptionSource) => void;
  onToggleTiroPanel: () => void;
  onChangeFontSize: (nextSize: number) => void;
  onChangeCardGap: (nextGap: number) => void;
  onChangeCaptionLayout: (layout: CaptionLayout) => void;
  onChangeLiveView: (view: LiveView) => void;
  onToggleShowEnglish: () => void;
  onChangeTranslationEngine: (engine: TranslationEngineId) => void;
  onChangeSourceLanguage: (lang: SourceLanguageSetting) => void;
  onChangeTargetLanguage: (lang: TargetLanguageSetting) => void;
  onChangeGlossaryRaw: (glossaryRaw: string) => void;
  onToggleTranslateInterim: () => void;
  onRetryPrepareTranslator: () => void;
  onExportTranscript: (format: TranscriptExportFormat) => void;
  onCopyTranscript: () => Promise<boolean>;
  onToggleMockStream: () => void;
  onEmitSingleSample: () => void;
  onEmitBurstSample: () => void;
  onSimulateErrorSample: () => void;
  onClearCaptions: () => void;
  onRetryTranslation: (captionId: string) => void;
}

const SCROLL_BOTTOM_THRESHOLD_PX = 52;

function formatSessionTime(epochMs: number): string {
  try {
    return new Date(epochMs).toLocaleString('ko-KR', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
  } catch {
    return '';
  }
}

function formatBytesToMB(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return '0MB';
  return `${Math.round(bytes / (1024 * 1024))}MB`;
}

export const CaptionWorkspace: React.FC<CaptionWorkspaceProps> = ({
  captions,
  activeSource,
  tiroPanelVisible,
  modalOverlayOpen = false,
  tiroTelemetry,
  captionStatus,
  translationStatus,
  translatorStatus,
  cleanMode,
  fontSizePx,
  cardGapPx,
  captionLayout,
  liveView,
  showEnglish,
  translationEngine,
  sourceLanguage,
  targetLanguage,
  glossaryRaw,
  translateInterim,
  isPresentationMode = false,
  savedSessions,
  currentSessionSavedAt,
  recoverableSession,
  onDismissRecoverableBanner,
  onRestoreSession,
  onDeleteSession,
  onOpenSessionsDir,
  onOpenReadinessGuide,
  onSwitchSource,
  onToggleTiroPanel,
  onChangeFontSize,
  onChangeCardGap,
  onChangeCaptionLayout,
  onChangeLiveView,
  onToggleShowEnglish,
  onChangeTranslationEngine,
  onChangeSourceLanguage,
  onChangeTargetLanguage,
  onChangeGlossaryRaw,
  onToggleTranslateInterim,
  onRetryPrepareTranslator,
  onExportTranscript,
  onCopyTranscript,
  onToggleMockStream,
  onEmitSingleSample,
  onEmitBurstSample,
  onSimulateErrorSample,
  onClearCaptions,
  onRetryTranslation
}) => {
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const tiroSplitHostRef = useRef<HTMLDivElement | null>(null);
  const isPinnedToBottomRef = useRef<boolean>(true);
  const prevCaptionCountRef = useRef<number>(captions.length);

  const [isUserScrolledUp, setIsUserScrolledUp] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [showControlsDrawer, setShowControlsDrawer] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [showRecoveryMenu, setShowRecoveryMenu] = useState(false);
  const [copiedFlash, setCopiedFlash] = useState(false);

  const currentSrcOpt = useMemo(
    () =>
      SOURCE_LANGUAGE_OPTIONS.find((opt) => opt.code === sourceLanguage) ??
      SOURCE_LANGUAGE_OPTIONS[0],
    [sourceLanguage]
  );
  const currentTgtOpt = useMemo(
    () =>
      TARGET_LANGUAGE_OPTIONS.find((opt) => opt.code === targetLanguage) ??
      TARGET_LANGUAGE_OPTIONS[0],
    [targetLanguage]
  );

  const showEmbeddedTiroSplit =
    activeSource === 'tiro' &&
    liveView === 'tiro-split' &&
    !tiroPanelVisible &&
    !modalOverlayOpen;

  // Manage embedded Tiro WebContentsView inside the sidebar when liveView === 'tiro-split'
  const syncTiroSplitBounds = useCallback(() => {
    const api = window.electronAPI?.tiro;
    if (!api) return;
    if (!showEmbeddedTiroSplit || !tiroSplitHostRef.current) {
      return;
    }
    void api.setVisible(true);
    void api.setZoom(0.78);
    const rect = tiroSplitHostRef.current.getBoundingClientRect();
    void api.setBounds({
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height
    });
  }, [showEmbeddedTiroSplit]);

  useEffect(() => {
    const api = window.electronAPI?.tiro;
    if (!api) return;

    if (!showEmbeddedTiroSplit) {
      if (!tiroPanelVisible || modalOverlayOpen) {
        void api.setZoom(1);
        void api.setVisible(false);
        void api.setBounds({ x: 0, y: 0, width: 0, height: 0 });
      }
      return;
    }

    syncTiroSplitBounds();
    const hostEl = tiroSplitHostRef.current;
    if (!hostEl) return;
    const observer = new ResizeObserver(() => syncTiroSplitBounds());
    observer.observe(hostEl);
    window.addEventListener('resize', syncTiroSplitBounds);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', syncTiroSplitBounds);
    };
  }, [
    showEmbeddedTiroSplit,
    tiroPanelVisible,
    modalOverlayOpen,
    syncTiroSplitBounds,
    showControlsDrawer,
    cleanMode
  ]);

  const scrollToLatest = useCallback((behavior: ScrollBehavior = 'smooth') => {
    const el = scrollContainerRef.current;
    if (!el) return;
    el.scrollTo({
      top: el.scrollHeight,
      behavior
    });
    isPinnedToBottomRef.current = true;
    setIsUserScrolledUp(false);
    setUnreadCount(0);
  }, []);

  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const atBottom = distanceFromBottom <= SCROLL_BOTTOM_THRESHOLD_PX;

    isPinnedToBottomRef.current = atBottom;
    setIsUserScrolledUp(!atBottom);
    if (atBottom) {
      setUnreadCount(0);
    }
  }, []);

  useEffect(() => {
    const prevCount = prevCaptionCountRef.current;
    const addedCount = Math.max(0, captions.length - prevCount);
    prevCaptionCountRef.current = captions.length;

    if (captions.length === 0) {
      isPinnedToBottomRef.current = true;
      setIsUserScrolledUp(false);
      setUnreadCount(0);
      return;
    }

    if (isPinnedToBottomRef.current) {
      const el = scrollContainerRef.current;
      if (el) {
        el.scrollTop = el.scrollHeight;
        requestAnimationFrame(() => {
          if (isPinnedToBottomRef.current && scrollContainerRef.current) {
            scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
          }
        });
      }
    } else if (addedCount > 0) {
      setUnreadCount((prev) => prev + addedCount);
    }
  }, [captions]);

  const handleCopyClick = async () => {
    const ok = await onCopyTranscript();
    if (ok) {
      setCopiedFlash(true);
      window.setTimeout(() => setCopiedFlash(false), 1800);
    }
  };

  const isMockConnected = activeSource === 'mock' && captionStatus.state === 'connected';
  const estimatedMB = translatorStatus?.estimatedDownloadMB ?? 680;

  return (
    <aside
      className={`caption-region ${isPresentationMode ? 'caption-region-presentation' : ''}`}
      aria-label="실시간 이중언어 자막 영역"
    >
      {!cleanMode ? (
        <div className="caption-top-panel">
          {/* Provider Switcher: TiroCaptionProvider vs MockCaptionProvider */}
          <div className="provider-mode-tabs" role="tablist" aria-label="자막 입력 소스 선택">
            <button
              type="button"
              role="tab"
              aria-selected={activeSource === 'tiro'}
              data-testid="switch-provider-tiro"
              className={`provider-tab ${activeSource === 'tiro' ? 'provider-tab-active' : ''}`}
              onClick={() => onSwitchSource('tiro')}
            >
              🎤 Tiro 실시간 연동
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeSource === 'mock'}
              data-testid="switch-provider-mock"
              className={`provider-tab ${activeSource === 'mock' ? 'provider-tab-active' : ''}`}
              onClick={() => onSwitchSource('mock')}
            >
              🧪 Mock 시뮬레이터
            </button>
          </div>

          <div className="status-strip">
            <span
              className={`status-pill status-${captionStatus.state}`}
              title={
                captionStatus.isMock
                  ? captionStatus.message
                  : `${captionStatus.message ?? ''} · 음성 인식은 Tiro 온라인 연결이 필요합니다`
              }
            >
              <span className="status-dot" />
              {captionStatus.isMock ? 'Mock' : 'Tiro STT'}:{' '}
              {captionStatus.state === 'connected'
                ? '수신 중'
                : captionStatus.state === 'connecting'
                  ? '연결 대기'
                  : captionStatus.state === 'error'
                    ? '오류'
                    : '대기'}
            </span>

            {/* Translation engine pill with exact online/offline readiness distinction */}
            <span
              className={`status-pill ${
                translationEngine === 'local' &&
                (translatorStatus?.state === 'downloading' || translatorStatus?.state === 'loading')
                  ? 'status-connecting'
                  : translationEngine === 'local' &&
                      translatorStatus &&
                      !translatorStatus.cachedOnDisk &&
                      translatorStatus.state === 'idle'
                    ? 'status-connecting'
                    : `status-${translationStatus.state}`
              }`}
              title={
                translationEngine === 'local'
                  ? `${translatorStatus?.message ?? translationStatus.message} (모델 다운로드 후 번역은 로컬 오프라인 구동)`
                  : translationStatus.message
              }
            >
              <span className="status-dot" />
              {translationEngine === 'local' ? (
                translatorStatus?.state === 'downloading' ? (
                  `AI 다운로드 ${
                    translatorStatus.progress != null
                      ? `${Math.round(translatorStatus.progress * 100)}%`
                      : '중'
                  }`
                ) : translatorStatus?.state === 'loading' ? (
                  `로컬 AI 로드 ${
                    translatorStatus.progress != null
                      ? `${Math.round(translatorStatus.progress * 100)}%`
                      : '중'
                  }`
                ) : translatorStatus?.state === 'ready' ? (
                  translatorStatus.lastLatencyMs != null
                    ? `로컬 AI (${translatorStatus.lastLatencyMs}ms)`
                    : '로컬 AI 준비됨'
                ) : translatorStatus?.state === 'error' ? (
                  'AI 오류'
                ) : translatorStatus?.cachedOnDisk ? (
                  '로컬 AI 대기'
                ) : (
                  `AI 미설치 (~${estimatedMB}MB)`
                )
              ) : (
                'Mock 번역'
              )}
            </span>

            {translationEngine === 'local' &&
              (translatorStatus?.state === 'error' || translatorStatus?.state === 'idle') && (
                <button
                  type="button"
                  className="mini-btn"
                  onClick={
                    translatorStatus?.state === 'idle' && !translatorStatus?.cachedOnDisk
                      ? onOpenReadinessGuide
                      : onRetryPrepareTranslator
                  }
                  title={
                    translatorStatus?.cachedOnDisk
                      ? '디스크에 설치된 로컬 AI 번역 모델을 메모리에 로드합니다'
                      : `최초 1회 약 ${estimatedMB}MB 모델 다운로드 및 온라인/오프라인 안내 보기`
                  }
                >
                  {translatorStatus?.state === 'error'
                    ? 'AI 재시도'
                    : translatorStatus?.cachedOnDisk
                      ? 'AI 시작'
                      : '⬇ 모델 준비'}
                </button>
              )}

            {/* Quick Language Pair Pill */}
            <button
              type="button"
              className="mini-btn"
              onClick={() => setShowControlsDrawer((v) => !v)}
              title="발화 언어(다국어 자동 감지) 및 번역 대상 언어, 전문 용어집 설정 열기"
            >
              🌐 {currentSrcOpt.shortLabel}→{currentTgtOpt.shortLabel}
            </button>

            {activeSource === 'tiro' && Boolean(tiroTelemetry?.selfHealedCount) && (
              <span
                className="status-pill status-ready"
                title={tiroTelemetry?.lastHealMessage ?? 'Tiro DOM 변경 자동 자가 복구 완료'}
              >
                🛡️ 복구됨
              </span>
            )}

            <div className="status-right-btns ml-auto">
              {/* Session Auto-Save & Crash Recovery Menu */}
              <div className="export-dropdown-wrap">
                <button
                  type="button"
                  data-testid="toggle-session-recovery"
                  className={`mini-btn ${showRecoveryMenu ? 'mini-btn-active' : ''}`}
                  onClick={() => {
                    setShowExportMenu(false);
                    setShowRecoveryMenu((v) => !v);
                  }}
                  title={
                    currentSessionSavedAt
                      ? `현재 세션 자동 저장됨 (${formatSessionTime(currentSessionSavedAt)}) · 이전 발표 기록 복구`
                      : '자동 저장된 이전 발표 자막 세션을 조회하거나 복구합니다'
                  }
                >
                  {currentSessionSavedAt ? '💾 자동저장' : '📂 복구'}
                  {savedSessions.length > 0 ? ` (${savedSessions.length})` : ''}
                </button>

                {showRecoveryMenu && (
                  <div className="session-recovery-popover" role="dialog" aria-label="자동 저장 세션 복구">
                    <div className="recovery-popover-head">
                      <span>세션 자동 저장 및 복구</span>
                      <button
                        type="button"
                        className="mini-btn"
                        onClick={() => {
                          setShowRecoveryMenu(false);
                          onOpenSessionsDir();
                        }}
                        title="로컬 디스크의 자동 저장 폴더를 탐색기에서 엽니다"
                      >
                        폴더 열기
                      </button>
                    </div>
                    <div className="recovery-popover-sub">
                      {currentSessionSavedAt
                        ? `✓ 현재 세션 자동 백업됨 (${formatSessionTime(currentSessionSavedAt)})`
                        : '자막이 수집되면 로컬 디스크에 실시간 자동 저장됩니다.'}
                    </div>

                    {savedSessions.length === 0 ? (
                      <div className="recovery-empty">저장된 이전 발표 기록이 없습니다.</div>
                    ) : (
                      <div className="recovery-session-list">
                        {savedSessions.slice(0, 8).map((sess) => (
                          <div key={sess.sessionId} className="recovery-session-item">
                            <div className="recovery-session-meta">
                              <div className="recovery-session-title">{sess.title}</div>
                              <div className="recovery-session-info">
                                {sess.source === 'tiro' ? 'Tiro' : 'Mock'} · {sess.captionCount}문장 ·{' '}
                                {formatSessionTime(sess.updatedAt)}
                              </div>
                            </div>
                            <div className="recovery-session-actions">
                              <button
                                type="button"
                                className="mini-btn mini-btn-active"
                                onClick={() => {
                                  setShowRecoveryMenu(false);
                                  onRestoreSession(sess.sessionId);
                                }}
                              >
                                복구
                              </button>
                              <button
                                type="button"
                                className="mini-btn"
                                onClick={() => onDeleteSession(sess.sessionId)}
                                title="이 저장 기록 삭제"
                              >
                                ✕
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {captions.length > 0 && (
                <>
                  <button
                    type="button"
                    className="mini-btn"
                    onClick={() => void handleCopyClick()}
                    title="전체 자막 대본을 클립보드에 복사합니다"
                  >
                    {copiedFlash ? '복사됨 ✓' : '📋 복사'}
                  </button>
                  <div className="export-dropdown-wrap">
                    <button
                      type="button"
                      className={`mini-btn ${showExportMenu ? 'mini-btn-active' : ''}`}
                      onClick={() => {
                        setShowRecoveryMenu(false);
                        setShowExportMenu((v) => !v);
                      }}
                      title="자막 기록을 파일(SRT, Markdown, TXT, JSON)로 내보냅니다"
                    >
                      💾 저장
                    </button>
                    {showExportMenu && (
                      <div className="export-popover" role="menu">
                        <button
                          type="button"
                          className="export-menu-item"
                          onClick={() => {
                            setShowExportMenu(false);
                            onExportTranscript('srt');
                          }}
                        >
                          🎬 SRT 자막 파일 (.srt)
                        </button>
                        <button
                          type="button"
                          className="export-menu-item"
                          onClick={() => {
                            setShowExportMenu(false);
                            onExportTranscript('md');
                          }}
                        >
                          📝 Markdown 표 (.md)
                        </button>
                        <button
                          type="button"
                          className="export-menu-item"
                          onClick={() => {
                            setShowExportMenu(false);
                            onExportTranscript('txt');
                          }}
                        >
                          📄 텍스트 대본 (.txt)
                        </button>
                        <button
                          type="button"
                          className="export-menu-item"
                          onClick={() => {
                            setShowExportMenu(false);
                            onExportTranscript('json');
                          }}
                        >
                          🧩 JSON 데이터 (.json)
                        </button>
                      </div>
                    )}
                  </div>
                </>
              )}

              <button
                type="button"
                className={`mini-btn ${showControlsDrawer ? 'mini-btn-active' : ''}`}
                onClick={() => setShowControlsDrawer((v) => !v)}
                aria-expanded={showControlsDrawer}
              >
                {showControlsDrawer ? '설정 닫기' : '⚙ 설정'}
              </button>
            </div>
          </div>

          {/* 1-Click Crash/Exit Recovery Prompt Banner */}
          {recoverableSession && (
            <div className="recovery-banner" role="status">
              <span className="recovery-banner-text">
                💾 이전 발표 자동 저장본 ({recoverableSession.captionCount}문장 ·{' '}
                {formatSessionTime(recoverableSession.updatedAt)}): &ldquo;
                {recoverableSession.title}&rdquo;
              </span>
              <div className="control-btn-group">
                <button
                  type="button"
                  className="mini-btn mini-btn-active"
                  onClick={() => onRestoreSession(recoverableSession.sessionId)}
                >
                  기록 복구
                </button>
                <button
                  type="button"
                  className="mini-btn"
                  onClick={onDismissRecoverableBanner}
                  aria-label="복구 알림 닫기"
                >
                  닫기
                </button>
              </div>
            </div>
          )}

          {activeSource === 'mock' ? (
            <div className="quick-actions-row">
              <button
                type="button"
                className={`action-btn ${isMockConnected ? 'action-btn-stop' : 'action-btn-start'}`}
                onClick={onToggleMockStream}
              >
                {isMockConnected ? '■ Mock 중지' : '▶ Mock 자동자막'}
              </button>
              <button
                type="button"
                className="action-btn"
                onClick={onEmitSingleSample}
                title="문장 1개를 발생시킵니다"
              >
                +1 문장
              </button>
              <button
                type="button"
                className="action-btn"
                onClick={onClearCaptions}
                disabled={captions.length === 0}
                title="현재 화면을 비우고 새 세션을 시작합니다 (기존 기록은 자동 저장 보관됨)"
              >
                초기화
              </button>
            </div>
          ) : (
            <div className="quick-actions-row quick-actions-tiro">
              {!isPresentationMode ? (
                <button
                  type="button"
                  className={`action-btn ${tiroPanelVisible ? 'action-btn-active' : 'action-btn-start'}`}
                  onClick={onToggleTiroPanel}
                >
                  {tiroPanelVisible ? '슬라이드 / 배치 화면' : 'Tiro 로그인 / 자막 선택기'}
                </button>
              ) : (
                <button
                  type="button"
                  className={`action-btn ${liveView === 'tiro-split' ? 'action-btn-active' : ''}`}
                  onClick={() => onChangeLiveView(liveView === 'cards' ? 'tiro-split' : 'cards')}
                  title="사이드바 상단에 실제 Tiro 웹 화면을 함께 띄울지 전환합니다"
                >
                  {liveView === 'tiro-split' ? '카드 전용 보기' : 'Tiro 상단 분할 보기'}
                </button>
              )}
              <button
                type="button"
                className="action-btn"
                onClick={onClearCaptions}
                disabled={captions.length === 0}
                title="현재 화면을 비우고 새 세션을 시작합니다 (기존 기록은 자동 저장 보관됨)"
              >
                초기화
              </button>
            </div>
          )}

          {captionStatus.state === 'error' && captionStatus.message && (
            <div className="provider-error-banner">{captionStatus.message}</div>
          )}

          {translationEngine === 'local' && translatorStatus?.state === 'error' && (
            <div className="provider-error-banner">
              {translatorStatus.message}{' '}
              <button type="button" className="retry-btn" onClick={onRetryPrepareTranslator}>
                재시도
              </button>
            </div>
          )}

          {/* Model download / load progress bar banner with exact MB & offline scope explanation */}
          {translationEngine === 'local' &&
            (translatorStatus?.state === 'downloading' ||
              (translatorStatus?.state === 'loading' && translatorStatus.progress != null)) &&
            translatorStatus.progress != null && (
              <div className="download-progress-container">
                <div className="download-progress-label">
                  <span>
                    {translatorStatus.cachedOnDisk
                      ? '로컬 디스크에서 AI 번역 모델 로드 중'
                      : `최초 1회 로컬 AI 모델 다운로드 중 (약 ${estimatedMB}MB · 완료 후 오프라인 번역)${
                          translatorStatus.totalBytes
                            ? ` · ${formatBytesToMB(translatorStatus.downloadedBytes)} / ${formatBytesToMB(
                                translatorStatus.totalBytes
                              )}`
                            : ''
                        }`}
                  </span>
                  <span>{Math.round(translatorStatus.progress * 100)}%</span>
                </div>
                <div className="download-progress-track">
                  <div
                    className="download-progress-bar"
                    style={{ width: `${Math.round(translatorStatus.progress * 100)}%` }}
                  />
                </div>
              </div>
            )}

          {showControlsDrawer && (
            <div className="controls-drawer">
              {/* Multilingual Source & Target Selection */}
              <div className="control-row">
                <label className="control-label" htmlFor="source-lang-select">
                  발화 언어 (원문)
                </label>
                <select
                  id="source-lang-select"
                  className="toolbar-select control-select"
                  value={sourceLanguage}
                  onChange={(e) =>
                    onChangeSourceLanguage(e.target.value as SourceLanguageSetting)
                  }
                >
                  {SOURCE_LANGUAGE_OPTIONS.map((opt) => (
                    <option key={opt.code} value={opt.code}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="control-row">
                <label className="control-label" htmlFor="target-lang-select">
                  번역 대상 언어
                </label>
                <select
                  id="target-lang-select"
                  className="toolbar-select control-select"
                  value={targetLanguage}
                  onChange={(e) =>
                    onChangeTargetLanguage(e.target.value as TargetLanguageSetting)
                  }
                >
                  {TARGET_LANGUAGE_OPTIONS.map((opt) => (
                    <option key={opt.code} value={opt.code}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Custom Domain Terminology Glossary */}
              <div className="control-col">
                <div className="control-row">
                  <label className="control-label" htmlFor="glossary-textarea">
                    전문 용어집 (고유명사 고정 번역: <code>원문 = 번역어</code>)
                  </label>
                </div>
                <textarea
                  id="glossary-textarea"
                  className="glossary-textarea"
                  rows={2}
                  value={glossaryRaw}
                  onChange={(e) => onChangeGlossaryRaw(e.target.value)}
                  placeholder={'예: Tiro = 티로\nONNX Runtime = ONNX 런타임'}
                />
              </div>

              {/* Layout: Columns vs Stacked */}
              <div className="control-row">
                <span className="control-label">자막 배치</span>
                <div className="control-btn-group">
                  <button
                    type="button"
                    className={`mini-btn ${captionLayout === 'columns' ? 'mini-btn-active' : ''}`}
                    onClick={() => onChangeCaptionLayout('columns')}
                    title="좌측 원문 : 우측 번역문 50:50 나란히 배치"
                  >
                    좌우 분할
                  </button>
                  <button
                    type="button"
                    className={`mini-btn ${captionLayout === 'stacked' ? 'mini-btn-active' : ''}`}
                    onClick={() => onChangeCaptionLayout('stacked')}
                    title="상단 원문 / 하단 번역문 상하 배치 (좁은 사이드바 추천)"
                  >
                    상하 분할
                  </button>
                  <button
                    type="button"
                    className={`mini-btn ${!showEnglish ? 'mini-btn-active' : ''}`}
                    onClick={onToggleShowEnglish}
                    title="원문 표시 여부 토글"
                  >
                    {showEnglish ? '원문+번역 표시' : '번역문 전용'}
                  </button>
                </div>
              </div>

              {/* Tiro Live View Mode */}
              {activeSource === 'tiro' && (
                <div className="control-row">
                  <span className="control-label">Tiro 뷰 모드</span>
                  <div className="control-btn-group">
                    <button
                      type="button"
                      className={`mini-btn ${liveView === 'cards' ? 'mini-btn-active' : ''}`}
                      onClick={() => onChangeLiveView('cards')}
                      title="Tiro는 백그라운드에서 수집하고 전체 영역에 번역 카드를 표시합니다"
                    >
                      번역 카드 뷰
                    </button>
                    <button
                      type="button"
                      className={`mini-btn ${liveView === 'tiro-split' ? 'mini-btn-active' : ''}`}
                      onClick={() => onChangeLiveView('tiro-split')}
                      title="상단에 실제 Tiro 웹 화면을 띄우고 하단에 번역 카드를 표시합니다"
                    >
                      상단 Tiro + 하단 번역
                    </button>
                  </div>
                </div>
              )}

              {/* Translation Engine Selection */}
              <div className="control-row">
                <span className="control-label">번역 엔진</span>
                <div className="control-btn-group">
                  <button
                    type="button"
                    className={`mini-btn ${translationEngine === 'local' ? 'mini-btn-active' : ''}`}
                    onClick={() => onChangeTranslationEngine('local')}
                    title="Meta NLLB-200 600M 다국어 로컬 AI 엔진 (최초 다운로드 후 오프라인 동작)"
                  >
                    로컬 AI (무료)
                  </button>
                  <button
                    type="button"
                    className={`mini-btn ${translationEngine === 'mock' ? 'mini-btn-active' : ''}`}
                    onClick={() => onChangeTranslationEngine('mock')}
                    title="테스트 및 리허설용 Mock 사전 번역"
                  >
                    Mock 사전
                  </button>
                  <button
                    type="button"
                    className="mini-btn"
                    onClick={onOpenReadinessGuide}
                    title="네트워크 필요 범위 및 모델 설치 상태 확인"
                  >
                    ❓ 준비 안내
                  </button>
                </div>
              </div>

              {/* Interim Live Translation Toggle */}
              <div className="control-row">
                <span className="control-label">진행 문장 선발 번역</span>
                <div className="control-btn-group">
                  <button
                    type="button"
                    className={`mini-btn ${translateInterim ? 'mini-btn-active' : ''}`}
                    onClick={onToggleTranslateInterim}
                    title="긴 문장이 완전히 끝나기 전에도 완료된 앞 문장은 캐시로 즉시 고정하며 실시간 중간 번역을 표시합니다"
                  >
                    {translateInterim ? '실시간 중간번역 ON' : '문장 완료 후 번역'}
                  </button>
                </div>
              </div>

              {/* Font Size */}
              <div className="control-row">
                <span className="control-label">글자 크기 ({fontSizePx}px)</span>
                <div className="control-btn-group">
                  <button
                    type="button"
                    className="mini-btn"
                    onClick={() => onChangeFontSize(Math.max(12, fontSizePx - 2))}
                  >
                    가−
                  </button>
                  <button
                    type="button"
                    className="mini-btn"
                    onClick={() => onChangeFontSize(20)}
                  >
                    기본 (20)
                  </button>
                  <button
                    type="button"
                    className="mini-btn"
                    onClick={() => onChangeFontSize(Math.min(40, fontSizePx + 2))}
                  >
                    가+
                  </button>
                </div>
              </div>

              {/* Card Gap */}
              <div className="control-row">
                <span className="control-label">카드 간격 ({cardGapPx}px)</span>
                <div className="control-btn-group">
                  <button
                    type="button"
                    className="mini-btn"
                    onClick={() => onChangeCardGap(Math.max(4, cardGapPx - 2))}
                  >
                    좁게
                  </button>
                  <button
                    type="button"
                    className="mini-btn"
                    onClick={() => onChangeCardGap(8)}
                  >
                    기본
                  </button>
                  <button
                    type="button"
                    className="mini-btn"
                    onClick={() => onChangeCardGap(Math.min(24, cardGapPx + 4))}
                  >
                    넓게
                  </button>
                </div>
              </div>

              {activeSource === 'mock' && (
                <div className="control-row">
                  <span className="control-label">시뮬레이션</span>
                  <div className="control-btn-group">
                    <button
                      type="button"
                      className="mini-btn"
                      onClick={onEmitBurstSample}
                      title="연속 3개 문장을 빠르게 입력합니다"
                    >
                      연속 3문장
                    </button>
                    <button
                      type="button"
                      className="mini-btn"
                      onClick={onSimulateErrorSample}
                      title="번역 실패 및 복구를 테스트합니다"
                    >
                      오류 테스트
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      ) : null}

      {/* Optional Split-View Live Tiro Host */}
      {showEmbeddedTiroSplit && (
        <div className="tiro-split-container">
          <div className="tiro-split-header">
            <span>Tiro 원본 실시간 화면 (온라인 STT)</span>
            <button
              type="button"
              className="mini-btn"
              onClick={() => onChangeLiveView('cards')}
              title="Tiro 화면을 백그라운드로 숨기고 번역 카드를 전체 높이로 확장합니다"
            >
              백그라운드로 숨기기
            </button>
          </div>
          <div ref={tiroSplitHostRef} className="tiro-split-host" />
        </div>
      )}

      {/* Column Headers for 'columns' mode */}
      {captionLayout === 'columns' && showEnglish && (
        <div className="caption-column-headers" role="row">
          <div className="caption-col-header caption-col-en" role="columnheader">
            {sourceLanguage === 'auto'
              ? '원문 (다국어 자동 감지)'
              : `${currentSrcOpt.label} (원문)`}
          </div>
          <div className="caption-col-header caption-col-ko" role="columnheader">
            {currentTgtOpt.label} (실시간 번역)
          </div>
        </div>
      )}

      {/* Virtualized Variable-Height Sentence Cards Area */}
      <VirtualizedCaptionList
        captions={captions}
        scrollContainerRef={scrollContainerRef}
        captionLayout={captionLayout}
        showEnglish={showEnglish}
        fontSizePx={fontSizePx}
        cardGapPx={cardGapPx}
        sourceLanguage={sourceLanguage}
        activeSource={activeSource}
        onScroll={handleScroll}
        onRetryTranslation={onRetryTranslation}
      />

      {isUserScrolledUp && (
        <div className="jump-latest-bar">
          <button
            type="button"
            className="jump-latest-btn"
            onClick={() => scrollToLatest('smooth')}
          >
            {unreadCount > 0
              ? `↓ 새 자막 ${unreadCount}건 (전체 ${captions.length}문장) · 최신 자막으로 이동`
              : `↓ 자동 스크롤 일시중지됨 (전체 ${captions.length}문장) · 최신 자막으로 이동`}
          </button>
        </div>
      )}
    </aside>
  );
};
