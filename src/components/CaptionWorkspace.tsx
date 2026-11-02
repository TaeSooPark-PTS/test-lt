import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { CaptionCardItem, CaptionProviderStatus } from '../types/caption';
import type { TranscriptExportFormat, TranslatorStatus } from '../types/electron';
import type { CaptionLayout, LiveView, TranslationEngineId } from '../types/settings';
import type { TiroObserverTelemetry } from '../types/tiro';
import type { TranslationProviderStatus } from '../types/translation';

export type ActiveCaptionSource = 'mock' | 'tiro';

interface CaptionWorkspaceProps {
  captions: CaptionCardItem[];
  activeSource: ActiveCaptionSource;
  tiroPanelVisible: boolean;
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
  translateInterim: boolean;
  isPresentationMode?: boolean;
  onSwitchSource: (source: ActiveCaptionSource) => void;
  onToggleTiroPanel: () => void;
  onChangeFontSize: (nextSize: number) => void;
  onChangeCardGap: (nextGap: number) => void;
  onChangeCaptionLayout: (layout: CaptionLayout) => void;
  onChangeLiveView: (view: LiveView) => void;
  onToggleShowEnglish: () => void;
  onChangeTranslationEngine: (engine: TranslationEngineId) => void;
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

const SCROLL_BOTTOM_THRESHOLD_PX = 44;

export const CaptionWorkspace: React.FC<CaptionWorkspaceProps> = ({
  captions,
  activeSource,
  tiroPanelVisible,
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
  translateInterim,
  isPresentationMode = false,
  onSwitchSource,
  onToggleTiroPanel,
  onChangeFontSize,
  onChangeCardGap,
  onChangeCaptionLayout,
  onChangeLiveView,
  onToggleShowEnglish,
  onChangeTranslationEngine,
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
  const [copiedFlash, setCopiedFlash] = useState(false);

  const showEmbeddedTiroSplit =
    activeSource === 'tiro' && liveView === 'tiro-split' && !tiroPanelVisible;

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
      if (!tiroPanelVisible) {
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
  }, [showEmbeddedTiroSplit, tiroPanelVisible, syncTiroSplitBounds, showControlsDrawer, cleanMode]);

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
              title={captionStatus.message}
            >
              <span className="status-dot" />
              {captionStatus.isMock ? 'Mock' : 'Tiro'}:{' '}
              {captionStatus.state === 'connected'
                ? '수신 중'
                : captionStatus.state === 'connecting'
                  ? '연결 대기'
                  : captionStatus.state === 'error'
                    ? '오류'
                    : '대기'}
            </span>

            {/* Translation engine pill */}
            <span
              className={`status-pill ${
                translationEngine === 'local' &&
                (translatorStatus?.state === 'downloading' || translatorStatus?.state === 'loading')
                  ? 'status-connecting'
                  : `status-${translationStatus.state}`
              }`}
              title={translatorStatus?.message ?? translationStatus.message}
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
                  `AI 로드 ${
                    translatorStatus.progress != null
                      ? `${Math.round(translatorStatus.progress * 100)}%`
                      : '중'
                  }`
                ) : translatorStatus?.state === 'ready' ? (
                  translatorStatus.lastLatencyMs != null
                    ? `오프라인 AI (${translatorStatus.lastLatencyMs}ms)`
                    : '오프라인 AI 준비'
                ) : translatorStatus?.state === 'error' ? (
                  'AI 오류'
                ) : (
                  'AI 대기'
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
                  onClick={onRetryPrepareTranslator}
                  title="오프라인 AI 번역 모델을 다시 불러옵니다"
                >
                  {translatorStatus?.state === 'error' ? 'AI 재시도' : 'AI 시작'}
                </button>
              )}

            {activeSource === 'tiro' && tiroTelemetry?.avgLatencyMs != null && (
              <span className="status-pill muted-pill" title="Tiro 자막 수신 평균 지연">
                ~{tiroTelemetry.avgLatencyMs}ms
              </span>
            )}

            <div className="status-right-btns ml-auto">
              {captions.length > 0 && (
                <>
                  <button
                    type="button"
                    className="mini-btn"
                    onClick={() => void handleCopyClick()}
                    title="전체 영·한 자막을 클립보드에 복사합니다"
                  >
                    {copiedFlash ? '복사됨 ✓' : '📋 복사'}
                  </button>
                  <div className="export-dropdown-wrap">
                    <button
                      type="button"
                      className={`mini-btn ${showExportMenu ? 'mini-btn-active' : ''}`}
                      onClick={() => setShowExportMenu((v) => !v)}
                      title="자막 기록을 파일(SRT, Markdown, TXT, JSON)로 저장합니다"
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
                title="영어 문장 1개를 발생시킵니다"
              >
                +1 문장
              </button>
              <button
                type="button"
                className="action-btn"
                onClick={onClearCaptions}
                disabled={captions.length === 0}
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

          {/* Model download / load progress bar banner */}
          {translationEngine === 'local' &&
            (translatorStatus?.state === 'downloading' ||
              (translatorStatus?.state === 'loading' && translatorStatus.progress != null)) &&
            translatorStatus.progress != null && (
              <div className="download-progress-container">
                <div className="download-progress-label">
                  <span>
                    {translatorStatus.cachedOnDisk
                      ? '오프라인 번역 AI 모델 불러오는 중'
                      : '오프라인 번역 AI 모델 다운로드 중 (최초 1회, 약 900MB)'}
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
              {/* Layout: Columns vs Stacked */}
              <div className="control-row">
                <span className="control-label">자막 배치</span>
                <div className="control-btn-group">
                  <button
                    type="button"
                    className={`mini-btn ${captionLayout === 'columns' ? 'mini-btn-active' : ''}`}
                    onClick={() => onChangeCaptionLayout('columns')}
                    title="좌측 영어 원문 : 우측 한국어 번역문 50:50 나란히 배치"
                  >
                    좌우 분할
                  </button>
                  <button
                    type="button"
                    className={`mini-btn ${captionLayout === 'stacked' ? 'mini-btn-active' : ''}`}
                    onClick={() => onChangeCaptionLayout('stacked')}
                    title="상단 영어 원문 / 하단 한국어 번역문 상하 배치 (좁은 사이드바 추천)"
                  >
                    상하 분할
                  </button>
                  <button
                    type="button"
                    className={`mini-btn ${!showEnglish ? 'mini-btn-active' : ''}`}
                    onClick={onToggleShowEnglish}
                    title="영어 원문 표시 여부 토글"
                  >
                    {showEnglish ? '영+한 표시' : '한국어 전용'}
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
                      title="상단에 실제 Tiro 웹 화면을 띄우고 하단에 한국어 번역 카드를 표시합니다"
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
                    title="Meta NLLB-200 600M 오프라인 AI 엔진 (API 키/비용 없음)"
                  >
                    오프라인 AI (무료)
                  </button>
                  <button
                    type="button"
                    className={`mini-btn ${translationEngine === 'mock' ? 'mini-btn-active' : ''}`}
                    onClick={() => onChangeTranslationEngine('mock')}
                    title="테스트 및 리허설용 Mock 사전 번역"
                  >
                    Mock 사전
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
                    title="긴 영어 문장이 완전히 끝나기 전에도 실시간으로 중간 한국어 번역을 표시합니다"
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
            <span>Tiro 원본 실시간 화면</span>
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
            English (원문)
          </div>
          <div className="caption-col-header caption-col-ko" role="columnheader">
            한국어 (실시간 번역)
          </div>
        </div>
      )}

      {/* Synchronized Sentence Cards Area */}
      <div
        ref={scrollContainerRef}
        className={`caption-scroll-area layout-${captionLayout} ${
          !showEnglish ? 'layout-korean-only' : ''
        }`}
        onScroll={handleScroll}
        style={{ gap: `${cardGapPx}px` }}
      >
        {captions.length === 0 ? (
          <div className="caption-empty-state">
            {activeSource === 'tiro' ? (
              <>
                <p className="caption-empty-title">Tiro 실시간 자막 대기 중</p>
                <p className="caption-empty-desc">
                  Tiro 화면에서 로그인 후 영어 음성 인식을 시작하면 영어 자막이 즉시 수집되고,
                  이곳에 <strong>실시간 한국어 번역</strong>이 자동으로 표출됩니다.
                </p>
              </>
            ) : (
              <>
                <p className="caption-empty-title">표시된 실시간 자막이 없습니다.</p>
                <p className="caption-empty-desc">
                  상단의 <strong>▶ Mock 자동자막</strong> 또는 <strong>+1 문장</strong> 버튼을 눌러
                  동기화 자막 카드를 확인하세요.
                </p>
              </>
            )}
          </div>
        ) : (
          captions.map((item, idx) => {
            const isLatest = idx === captions.length - 1;
            return (
              <article
                key={item.id}
                className={`caption-row-card layout-${captionLayout} ${
                  !showEnglish ? 'card-korean-only' : ''
                } ${isLatest ? 'caption-row-latest' : ''} ${
                  item.captionStatus === 'interim' ? 'caption-row-interim' : ''
                }`}
                style={{ fontSize: `${fontSizePx}px` }}
                data-caption-id={item.id}
                data-sequence={item.sequence}
              >
                {showEnglish && (
                  <div className="caption-cell caption-cell-en" lang="en">
                    <span className="caption-text-en">{item.englishText}</span>
                    {item.captionStatus === 'interim' && (
                      <span className="interim-badge" title="음성 인식 진행 중">
                        인식 중
                      </span>
                    )}
                  </div>
                )}

                <div className="caption-cell caption-cell-ko" lang="ko">
                  {item.translationState === 'error' ? (
                    <div className="translation-error-box">
                      <span className="translation-error-msg">
                        번역 실패: {item.errorMessage ?? '오류 발생'}
                      </span>
                      <button
                        type="button"
                        className="retry-btn"
                        onClick={() => onRetryTranslation(item.id)}
                      >
                        재시도
                      </button>
                    </div>
                  ) : item.koreanText ? (
                    <span
                      className={`caption-text-ko ${
                        item.captionStatus === 'interim' ? 'caption-text-ko-interim' : ''
                      }`}
                    >
                      {item.koreanText}
                      {item.translationState === 'translating' && (
                        <span className="loading-spinner inline-spinner" title="번역 갱신 중" />
                      )}
                    </span>
                  ) : item.captionStatus === 'interim' && item.translationState !== 'translating' ? (
                    <span className="translation-loading">문장 인식 중...</span>
                  ) : (
                    <span className="translation-loading" aria-live="polite">
                      <span className="loading-spinner" />
                      번역 중...
                    </span>
                  )}
                </div>
              </article>
            );
          })
        )}
      </div>

      {isUserScrolledUp && (
        <div className="jump-latest-bar">
          <button
            type="button"
            className="jump-latest-btn"
            onClick={() => scrollToLatest('smooth')}
          >
            {unreadCount > 0
              ? `↓ 새 자막 ${unreadCount}건 · 최신 자막으로 이동`
              : '↓ 자동 스크롤 일시중지됨 · 최신 자막으로 이동'}
          </button>
        </div>
      )}
    </aside>
  );
};
