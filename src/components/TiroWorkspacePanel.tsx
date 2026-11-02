import React, { useCallback, useEffect, useRef, useState } from 'react';
import type {
  TiroDomDiagnostics,
  TiroElementFingerprint,
  TiroObserverTelemetry,
  TiroRadarCandidate,
  TiroSelectedElementInfo,
  TiroViewState
} from '../types/tiro';

interface TiroWorkspacePanelProps {
  visible: boolean;
  modalOverlayOpen?: boolean;
  savedSelector: string | null;
  hasSavedFingerprint?: boolean;
  onHideToSlides: () => void;
  onSelectTargetSelector: (selector: string, fingerprint?: TiroElementFingerprint | null) => void;
  onStopObserving: () => void;
  diagnostics: TiroDomDiagnostics | null;
  radarCandidates: TiroRadarCandidate[];
  pickedInfo: TiroSelectedElementInfo | null;
  telemetry: TiroObserverTelemetry | null;
  viewState: TiroViewState | null;
}

export const TiroWorkspacePanel: React.FC<TiroWorkspacePanelProps> = ({
  visible,
  modalOverlayOpen = false,
  savedSelector,
  hasSavedFingerprint = false,
  onHideToSlides,
  onSelectTargetSelector,
  onStopObserving,
  diagnostics,
  radarCandidates,
  pickedInfo,
  telemetry,
  viewState
}) => {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [urlInput, setUrlInput] = useState('https://tiro.ooo/login');
  const [selectorInput, setSelectorInput] = useState(savedSelector ?? '');
  const [showInspectorDrawer, setShowInspectorDrawer] = useState(true);

  useEffect(() => {
    if (viewState?.url) {
      setUrlInput(viewState.url);
    }
  }, [viewState?.url]);

  useEffect(() => {
    if (savedSelector && !selectorInput) {
      setSelectorInput(savedSelector);
    }
  }, [savedSelector, selectorInput]);

  useEffect(() => {
    if (pickedInfo?.selector) {
      setSelectorInput(pickedInfo.selector);
    }
  }, [pickedInfo?.selector]);

  useEffect(() => {
    if (telemetry?.targetSelector) {
      setSelectorInput(telemetry.targetSelector);
    }
  }, [telemetry?.targetSelector]);

  const syncBounds = useCallback(() => {
    const api = window.electronAPI?.tiro;
    if (!api) return;
    if (!visible || modalOverlayOpen || !hostRef.current) {
      if (modalOverlayOpen) {
        void api.setVisible(false);
      }
      void api.setBounds({ x: 0, y: 0, width: 0, height: 0 });
      return;
    }
    void api.setVisible(true);
    void api.setZoom(1);
    const rect = hostRef.current.getBoundingClientRect();
    void api.setBounds({
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height
    });
  }, [modalOverlayOpen, visible]);

  useEffect(() => {
    syncBounds();
  }, [syncBounds, showInspectorDrawer, diagnostics, radarCandidates.length, pickedInfo]);

  useEffect(() => {
    if (!visible || !hostRef.current) return;
    const observer = new ResizeObserver(() => {
      syncBounds();
    });
    observer.observe(hostRef.current);
    window.addEventListener('resize', syncBounds);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', syncBounds);
    };
  }, [visible, syncBounds]);

  const handleNavigateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!urlInput.trim()) return;
    void window.electronAPI?.tiro.navigate(urlInput.trim());
  };

  const handleAutoDetect = () => {
    setShowInspectorDrawer(true);
    void window.electronAPI?.tiro.sendCommand({ action: 'auto-detect' });
  };

  const handleRunDiagnostics = () => {
    setShowInspectorDrawer(true);
    void window.electronAPI?.tiro.sendCommand({ action: 'diagnostics' });
  };

  const handleToggleRadar = () => {
    setShowInspectorDrawer(true);
    if (viewState?.radarActive) {
      void window.electronAPI?.tiro.sendCommand({ action: 'stop-radar' });
    } else {
      void window.electronAPI?.tiro.sendCommand({ action: 'start-radar' });
    }
  };

  const handleTogglePicker = () => {
    if (viewState?.pickerActive) {
      void window.electronAPI?.tiro.sendCommand({ action: 'stop-picker' });
    } else {
      void window.electronAPI?.tiro.sendCommand({ action: 'start-picker' });
    }
  };

  const handleSelectParent = () => {
    void window.electronAPI?.tiro.sendCommand({ action: 'select-parent' });
  };

  const handleStartManualSelector = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectorInput.trim()) return;
    onSelectTargetSelector(selectorInput.trim());
  };

  if (!visible) return null;

  return (
    <section className="ppt-region tiro-workspace-panel" aria-label="Tiro 세션 및 실시간 자막 연동 패널">
      {/* Row 1: Browser Navigation + Back to Slide View */}
      <header className="tiro-nav-bar">
        <div className="tiro-nav-group">
          <button
            type="button"
            className="toolbar-btn"
            disabled={!viewState?.canGoBack}
            onClick={() => void window.electronAPI?.tiro.navAction('back')}
            title="뒤로"
          >
            ◀
          </button>
          <button
            type="button"
            className="toolbar-btn"
            disabled={!viewState?.canGoForward}
            onClick={() => void window.electronAPI?.tiro.navAction('forward')}
            title="앞으로"
          >
            ▶
          </button>
          <button
            type="button"
            className="toolbar-btn"
            onClick={() => void window.electronAPI?.tiro.navAction('reload')}
            title="새로고침"
          >
            ↻
          </button>
        </div>

        <form className="tiro-url-form" onSubmit={handleNavigateSubmit}>
          <input
            type="text"
            className="tiro-url-input"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            placeholder="https://tiro.ooo"
            aria-label="Tiro 웹 주소"
          />
          <button type="submit" className="toolbar-btn">
            이동
          </button>
        </form>

        <div className="tiro-nav-group">
          <button
            type="button"
            className="toolbar-btn"
            onClick={() => setShowInspectorDrawer((v) => !v)}
          >
            {showInspectorDrawer ? '자막 연결 도구 접기' : '자막 연결 도구 펼치기'}
          </button>
          <button
            type="button"
            className="toolbar-btn toolbar-btn-primary"
            onClick={onHideToSlides}
            title="Tiro 세션을 백그라운드에서 계속 실행하며 발표 슬라이드/프로젝터 설정 화면으로 돌아갑니다"
          >
            슬라이드 / 발표 설정으로 전환 (백그라운드 유지)
          </button>
        </div>
      </header>

      {/* Row 2: Guided Setup + DOM Auto-Detect / Picker / Radar / Telemetry */}
      {showInspectorDrawer && (
        <div className="tiro-poc-drawer">
          <div className="tiro-guide-strip">
            <span>
              <strong>연동 순서:</strong> ① 아래 Tiro에 로그인 후 실시간 기록 시작 → ②{' '}
              <strong>[✨ 자막 영역 자동 연결]</strong> 또는 <strong>[마우스로 영역 선택]</strong> 클릭
              (다중 앵커 DOM 지문이 함께 저장되어 Tiro 클래스가 바뀌어도 자동 자가 복구) → ③ 상단{' '}
              <strong>[🚀 PPT 발표]</strong> 또는 <strong>[🖼 내장 발표]</strong> 클릭
            </span>
            {savedSelector && (
              <span
                className="saved-selector-badge"
                title={`저장된 CSS Selector: ${savedSelector}${
                  hasSavedFingerprint ? ' (구조·좌표 다중 앵커 지문 보호됨)' : ''
                }`}
              >
                {hasSavedFingerprint
                  ? '🛡️ 다중 앵커 자동 재연결 활성'
                  : '💾 자동 재연결 저장됨'}
              </span>
            )}
          </div>

          <div className="tiro-poc-actions">
            <button
              type="button"
              className="toolbar-btn toolbar-btn-primary"
              onClick={handleAutoDetect}
              title="해시 클래스에 의존하지 않고 DOM 구조·스크롤·ARIA·실시간 텍스트 스트림을 분석해 자막 영역을 자동 연결합니다"
            >
              ✨ 자막 영역 자동 연결
            </button>

            <button
              type="button"
              className={`toolbar-btn ${viewState?.pickerActive ? 'toolbar-btn-active' : ''}`}
              onClick={handleTogglePicker}
              title="아래 Tiro 화면에서 자막이 올라오는 영역을 마우스로 직접 클릭해 선택합니다"
            >
              {viewState?.pickerActive ? '취소 (ESC)' : '🎯 마우스로 자막 영역 선택'}
            </button>

            {pickedInfo?.parentSelector && (
              <button
                type="button"
                className="toolbar-btn"
                onClick={handleSelectParent}
                title="개별 문장 대신 전체 자막 목록 부모 컨테이너로 선택 범위를 넓힙니다"
              >
                ↑ 상위 컨테이너 선택
              </button>
            )}

            <button
              type="button"
              className={`toolbar-btn ${viewState?.radarActive ? 'toolbar-btn-active' : ''}`}
              onClick={handleToggleRadar}
              title="말하는 동안 텍스트가 실시간으로 변하는 DOM 후보 목록을 표시합니다"
            >
              {viewState?.radarActive ? '■ Radar 중지' : '📡 변경 요소 후보 (Radar)'}
            </button>

            <button type="button" className="toolbar-btn" onClick={handleRunDiagnostics}>
              🔍 DOM 진단
            </button>

            <form className="tiro-selector-form" onSubmit={handleStartManualSelector}>
              <input
                type="text"
                className="tiro-selector-input"
                value={selectorInput}
                onChange={(e) => setSelectorInput(e.target.value)}
                placeholder="자막 컨테이너 CSS Selector"
              />
              <button
                type="submit"
                className="toolbar-btn toolbar-btn-primary"
                disabled={!selectorInput.trim()}
              >
                감시 시작
              </button>
              {(telemetry?.observing || telemetry?.waitingForElement) && (
                <button type="button" className="toolbar-btn" onClick={onStopObserving}>
                  감시 중지
                </button>
              )}
            </form>
          </div>

          {/* Live Telemetry & Diagnostics Summary */}
          <div className="tiro-telemetry-grid">
            <div className="tiro-telemetry-card">
              <div className="tiro-telemetry-title">실시간 자막 수집 및 자가 복구 상태</div>
              <div className="tiro-telemetry-stats">
                <span>
                  상태:{' '}
                  <strong className={telemetry?.observing ? 'text-ok' : ''}>
                    {telemetry?.observing
                      ? `수신 중 (${telemetry.mode})`
                      : telemetry?.waitingForElement
                        ? '자막 요소 대기 중 (음성인식 시작 또는 DOM 변경 시 자동 자가 복구)'
                        : '대기 중'}
                  </strong>
                </span>
                <span>
                  수집 문장: <strong>{telemetry?.emittedCount ?? 0}</strong> (진행{' '}
                  {telemetry?.interimCount ?? 0} / 확정 {telemetry?.finalCount ?? 0})
                </span>
                <span>
                  중복 차단: <strong>{telemetry?.dedupedCount ?? 0}건</strong>
                </span>
                <span>
                  추출 지연:{' '}
                  <strong>
                    {telemetry?.lastLatencyMs != null
                      ? `${telemetry.lastLatencyMs}ms (평균 ${telemetry.avgLatencyMs ?? telemetry.lastLatencyMs}ms)`
                      : '-'}
                  </strong>
                </span>
                {Boolean(telemetry?.selfHealedCount) && (
                  <span className="text-ok">
                    🛡️ 자가 복구: <strong>{telemetry?.selfHealedCount}회 성공</strong>
                  </span>
                )}
              </div>
              {telemetry?.lastHealMessage && (
                <div className="tiro-diag-note text-ok">{telemetry.lastHealMessage}</div>
              )}
              {telemetry?.errorMessage && (
                <div className="tiro-error-inline">{telemetry.errorMessage}</div>
              )}
            </div>

            {diagnostics && (
              <div className="tiro-telemetry-card">
                <div className="tiro-telemetry-title">DOM / ShadowRoot / iframe 접근 진단</div>
                <div className="tiro-telemetry-stats">
                  <span>
                    DOM 접근:{' '}
                    <strong className={diagnostics.domAccessible ? 'text-ok' : 'text-err'}>
                      {diagnostics.domAccessible ? '가능' : '불가'}
                    </strong>
                  </span>
                  <span>요소: {diagnostics.totalElements}개</span>
                  <span>텍스트 노드: {diagnostics.textBearingElements}개</span>
                  <span>ShadowRoot: {diagnostics.openShadowRootCount}개</span>
                  <span>iframe: {diagnostics.iframeUrls.length}개</span>
                </div>
                {diagnostics.notes[0] && (
                  <div className="tiro-diag-note">{diagnostics.notes[0]}</div>
                )}
              </div>
            )}
          </div>

          {/* Picked Element Preview */}
          {pickedInfo && (
            <div className="tiro-picked-banner">
              <span>
                {pickedInfo.autoHealed ? '🛡️ 자동 자가 복구됨: ' : '선택됨: '}
                <code>{pickedInfo.tagSummary}</code> (하위 요소 {pickedInfo.childElementCount}개) —
                미리보기: &ldquo;{pickedInfo.sampleText || '(비어 있음)'}&rdquo;
              </span>
              <button
                type="button"
                className="mini-btn mini-btn-active"
                onClick={() =>
                  onSelectTargetSelector(pickedInfo.selector, pickedInfo.fingerprint ?? null)
                }
              >
                이 요소로 감시 시작 및 지문 저장
              </button>
            </div>
          )}

          {/* Mutation Radar Auto-Detected Candidates */}
          {radarCandidates.length > 0 && (
            <div className="tiro-radar-list">
              <div className="tiro-telemetry-title">
                실시간 텍스트 스트림 감지 후보 (말하는 동안 변하는 요소)
              </div>
              {radarCandidates.slice(0, 3).map((cand) => (
                <div key={cand.selector} className="tiro-radar-item">
                  <div className="tiro-radar-meta">
                    <code>{cand.tagSummary}</code> · 변경 {cand.mutationCount}회 · 하위블록{' '}
                    {cand.childBlockCount}개 · <span className="muted">{cand.sampleText}</span>
                  </div>
                  <button
                    type="button"
                    className="mini-btn"
                    onClick={() => {
                      setSelectorInput(cand.selector);
                      onSelectTargetSelector(cand.selector);
                    }}
                  >
                    이 요소 연결
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Native Electron WebContentsView Anchor Area */}
      <div ref={hostRef} className="tiro-webview-host">
        {viewState?.lastError && (
          <div className="tiro-host-placeholder">오류: {viewState.lastError}</div>
        )}
      </div>
    </section>
  );
};
