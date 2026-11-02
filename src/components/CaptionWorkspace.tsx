import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { CaptionCardItem, CaptionProviderStatus } from '../types/caption';
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
  cleanMode: boolean;
  fontSizePx: number;
  cardGapPx: number;
  onSwitchSource: (source: ActiveCaptionSource) => void;
  onToggleTiroPanel: () => void;
  onChangeFontSize: (nextSize: number) => void;
  onChangeCardGap: (nextGap: number) => void;
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
  cleanMode,
  fontSizePx,
  cardGapPx,
  onSwitchSource,
  onToggleTiroPanel,
  onChangeFontSize,
  onChangeCardGap,
  onToggleMockStream,
  onEmitSingleSample,
  onEmitBurstSample,
  onSimulateErrorSample,
  onClearCaptions,
  onRetryTranslation
}) => {
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const isPinnedToBottomRef = useRef<boolean>(true);
  const prevCaptionCountRef = useRef<number>(captions.length);

  const [isUserScrolledUp, setIsUserScrolledUp] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [showControlsDrawer, setShowControlsDrawer] = useState(false);

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

  const isMockConnected = activeSource === 'mock' && captionStatus.state === 'connected';

  return (
    <aside className="caption-region" aria-label="실시간 영어·한국어 자막 영역 (25%)">
      {!cleanMode ? (
        <div className="caption-top-panel">
          {/* Provider Switcher: MockCaptionProvider vs TiroCaptionProvider */}
          <div className="provider-mode-tabs" role="tablist" aria-label="자막 입력 소스 선택">
            <button
              type="button"
              role="tab"
              aria-selected={activeSource === 'mock'}
              data-testid="switch-provider-mock"
              className={`provider-tab ${activeSource === 'mock' ? 'provider-tab-active' : ''}`}
              onClick={() => onSwitchSource('mock')}
            >
              Mock 자막 테스트
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeSource === 'tiro'}
              data-testid="switch-provider-tiro"
              className={`provider-tab ${activeSource === 'tiro' ? 'provider-tab-active' : ''}`}
              onClick={() => onSwitchSource('tiro')}
            >
              Tiro 웹 연동 (PoC)
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
                  ? '선택 대기'
                  : captionStatus.state === 'error'
                    ? '오류'
                    : '대기'}
            </span>

            <span
              className={`status-pill status-${translationStatus.state}`}
              title={translationStatus.message}
            >
              <span className="status-dot" />
              번역: {translationStatus.isMock ? 'Mock' : translationStatus.providerName}
            </span>

            {activeSource === 'tiro' && tiroTelemetry?.avgLatencyMs != null && (
              <span className="status-pill" title="DOM 변경 감지 → 자막 수신 평균 지연 시간">
                지연 ~{tiroTelemetry.avgLatencyMs}ms
              </span>
            )}

            <button
              type="button"
              className="mini-btn ml-auto"
              onClick={() => setShowControlsDrawer((v) => !v)}
              aria-expanded={showControlsDrawer}
            >
              {showControlsDrawer ? '설정 닫기' : '설정'}
            </button>
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
                title="영어 문장 1개를 즉시 발생시켜 원문 우선 표시 및 번역을 확인합니다"
              >
                +1 문장
              </button>
              <button
                type="button"
                className="action-btn"
                onClick={onClearCaptions}
                disabled={captions.length === 0}
                title="자막 목록 초기화"
              >
                초기화
              </button>
            </div>
          ) : (
            <div className="quick-actions-row quick-actions-tiro">
              <button
                type="button"
                className={`action-btn ${tiroPanelVisible ? 'action-btn-active' : 'action-btn-start'}`}
                onClick={onToggleTiroPanel}
              >
                {tiroPanelVisible ? '슬라이드로 전환' : 'Tiro 화면 열기 / 설정'}
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
          )}

          {captionStatus.state === 'error' && captionStatus.message && (
            <div className="provider-error-banner">{captionStatus.message}</div>
          )}

          {showControlsDrawer && (
            <div className="controls-drawer">
              <div className="control-row">
                <span className="control-label">글자 크기 ({fontSizePx}px)</span>
                <div className="control-btn-group">
                  <button
                    type="button"
                    className="mini-btn"
                    onClick={() => onChangeFontSize(Math.max(12, fontSizePx - 1))}
                  >
                    가−
                  </button>
                  <button
                    type="button"
                    className="mini-btn"
                    onClick={() => onChangeFontSize(15)}
                  >
                    기본
                  </button>
                  <button
                    type="button"
                    className="mini-btn"
                    onClick={() => onChangeFontSize(Math.min(26, fontSizePx + 1))}
                  >
                    가+
                  </button>
                </div>
              </div>

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
                    onClick={() => onChangeCardGap(Math.min(24, cardGapPx + 2))}
                  >
                    넓게
                  </button>
                </div>
              </div>

              {activeSource === 'mock' && (
                <div className="control-row">
                  <span className="control-label">큐/오류 검증</span>
                  <div className="control-btn-group">
                    <button
                      type="button"
                      className="mini-btn"
                      onClick={onEmitBurstSample}
                      title="연속 3개 문장을 빠르게 입력해 순서 보장 여부를 검증합니다"
                    >
                      연속 3문장
                    </button>
                    <button
                      type="button"
                      className="mini-btn"
                      onClick={onSimulateErrorSample}
                      title="번역 실패 및 재시도 동작을 검증합니다"
                    >
                      오류 테스트
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="caption-clean-status" title="클린 발표 모드 활성화됨">
          <span className={`status-dot status-dot-${captionStatus.state}`} />
          <span>{captionStatus.isMock ? 'MOCK CAPTION' : 'TIRO PO-C LIVE'}</span>
        </div>
      )}

      {/* Fixed 50:50 Column Header */}
      <div className="caption-column-headers" role="row">
        <div className="caption-col-header caption-col-en" role="columnheader">
          English
        </div>
        <div className="caption-col-header caption-col-ko" role="columnheader">
          한국어
        </div>
      </div>

      {/* Independent Scrollable Synchronized Sentence Cards */}
      <div
        ref={scrollContainerRef}
        className="caption-scroll-area"
        onScroll={handleScroll}
        style={{ gap: `${cardGapPx}px` }}
      >
        {captions.length === 0 ? (
          <div className="caption-empty-state">
            {activeSource === 'tiro' ? (
              <>
                <p className="caption-empty-title">Tiro 실시간 자막 대기 중</p>
                <p className="caption-empty-desc">
                  좌측 Tiro 화면에서 로그인 후 음성 인식을 시작하고,{' '}
                  <strong>2. 변경 요소 자동 탐지 (Radar)</strong> 또는{' '}
                  <strong>3. 마우스로 자막 영역 선택</strong>으로 자막 컨테이너를 연결하세요.
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
                className={`caption-row-card ${isLatest ? 'caption-row-latest' : ''} ${
                  item.captionStatus === 'interim' ? 'caption-row-interim' : ''
                }`}
                style={{ fontSize: `${fontSizePx}px` }}
                data-caption-id={item.id}
                data-sequence={item.sequence}
              >
                <div className="caption-cell caption-cell-en" lang="en">
                  <span className="caption-text-en">{item.englishText}</span>
                  {item.captionStatus === 'interim' && (
                    <span className="interim-badge" title="음성 인식 진행 중">
                      인식 중
                    </span>
                  )}
                </div>

                <div className="caption-cell caption-cell-ko" lang="ko">
                  {item.translationState === 'translated' && item.koreanText ? (
                    <span className="caption-text-ko">{item.koreanText}</span>
                  ) : item.translationState === 'error' ? (
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
                  ) : item.captionStatus === 'interim' ? (
                    <span className="translation-loading">문장 확정 대기 중...</span>
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
