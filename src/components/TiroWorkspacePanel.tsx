import React, { useCallback, useEffect, useRef, useState } from 'react';
import type {
  TiroDomDiagnostics,
  TiroObserverTelemetry,
  TiroRadarCandidate,
  TiroSelectedElementInfo,
  TiroViewState
} from '../types/tiro';

interface TiroWorkspacePanelProps {
  visible: boolean;
  onHideToSlides: () => void;
  onSelectTargetSelector: (selector: string) => void;
  onStopObserving: () => void;
  diagnostics: TiroDomDiagnostics | null;
  radarCandidates: TiroRadarCandidate[];
  pickedInfo: TiroSelectedElementInfo | null;
  telemetry: TiroObserverTelemetry | null;
  viewState: TiroViewState | null;
}

export const TiroWorkspacePanel: React.FC<TiroWorkspacePanelProps> = ({
  visible,
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
  const [selectorInput, setSelectorInput] = useState('');
  const [showInspectorDrawer, setShowInspectorDrawer] = useState(true);

  useEffect(() => {
    if (viewState?.url) {
      setUrlInput(viewState.url);
    }
  }, [viewState?.url]);

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
    if (!visible || !hostRef.current) {
      void api.setBounds({ x: 0, y: 0, width: 0, height: 0 });
      return;
    }
    const rect = hostRef.current.getBoundingClientRect();
    void api.setBounds({
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height
    });
  }, [visible]);

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
    <section className="ppt-region tiro-workspace-panel" aria-label="Tiro 세션 및 자막 추출 PoC 패널">
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
            {showInspectorDrawer ? 'PoC 도구 접기' : 'PoC 도구 펼치기'}
          </button>
          <button
            type="button"
            className="toolbar-btn toolbar-btn-primary"
            onClick={onHideToSlides}
            title="Tiro 세션을 백그라운드에서 계속 실행하며 발표 슬라이드 화면으로 돌아갑니다"
          >
            슬라이드 화면으로 전환 (백그라운드 유지)
          </button>
        </div>
      </header>

      {/* Row 2: Collapsible PoC DOM Inspector, Mutation Radar & Telemetry */}
      {showInspectorDrawer && (
        <div className="tiro-poc-drawer">
          <div className="tiro-poc-actions">
            <button type="button" className="toolbar-btn" onClick={handleRunDiagnostics}>
              1. DOM 구조 진단
            </button>

            <button
              type="button"
              className={`toolbar-btn ${viewState?.radarActive ? 'toolbar-btn-active' : ''}`}
              onClick={handleToggleRadar}
              title="Tiro에서 음성을 인식 중일 때 텍스트가 실시간으로 변하는 DOM 요소를 자동 탐지합니다"
            >
              {viewState?.radarActive ? '■ Radar 탐지 중지' : '2. 변경 요소 자동 탐지 (Radar)'}
            </button>

            <button
              type="button"
              className={`toolbar-btn ${viewState?.pickerActive ? 'toolbar-btn-active' : ''}`}
              onClick={handleTogglePicker}
              title="아래 Tiro 화면에서 영어 자막 영역을 마우스로 직접 클릭해 선택합니다"
            >
              {viewState?.pickerActive ? '취소 (ESC)' : '3. 마우스로 자막 영역 선택'}
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

            <form className="tiro-selector-form" onSubmit={handleStartManualSelector}>
              <input
                type="text"
                className="tiro-selector-input"
                value={selectorInput}
                onChange={(e) => setSelectorInput(e.target.value)}
                placeholder="검증된 자막 컨테이너 CSS Selector (Inspector 또는 Radar로 선택)"
              />
              <button
                type="submit"
                className="toolbar-btn toolbar-btn-primary"
                disabled={!selectorInput.trim()}
              >
                감시 시작
              </button>
              {telemetry?.observing && (
                <button type="button" className="toolbar-btn" onClick={onStopObserving}>
                  감시 중지
                </button>
              )}
            </form>
          </div>

          {/* Live Telemetry & Diagnostics Summary */}
          <div className="tiro-telemetry-grid">
            <div className="tiro-telemetry-card">
              <div className="tiro-telemetry-title">MutationObserver 수집 상태</div>
              <div className="tiro-telemetry-stats">
                <span>
                  상태:{' '}
                  <strong>
                    {telemetry?.observing ? `수집 중 (${telemetry.mode})` : '대기 중'}
                  </strong>
                </span>
                <span>
                  추출 이벤트: <strong>{telemetry?.emittedCount ?? 0}</strong> (중간{' '}
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
              </div>
              {telemetry?.errorMessage && (
                <div className="tiro-error-inline">{telemetry.errorMessage}</div>
              )}
            </div>

            {diagnostics && (
              <div className="tiro-telemetry-card">
                <div className="tiro-telemetry-title">DOM 접근 진단 결과</div>
                <div className="tiro-telemetry-stats">
                  <span>
                    DOM 접근:{' '}
                    <strong className={diagnostics.domAccessible ? 'text-ok' : 'text-err'}>
                      {diagnostics.domAccessible ? '가능' : '불가'}
                    </strong>
                  </span>
                  <span>요소: {diagnostics.totalElements}개</span>
                  <span>텍스트 노드: {diagnostics.textBearingElements}개</span>
                  <span>Canvas: {diagnostics.canvasCount}개</span>
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
                선택됨: <code>{pickedInfo.tagSummary}</code> (하위 요소 {pickedInfo.childElementCount}
                개) — 미리보기: &ldquo;{pickedInfo.sampleText || '(비어 있음)'}&rdquo;
              </span>
              <button
                type="button"
                className="mini-btn"
                onClick={() => onSelectTargetSelector(pickedInfo.selector)}
              >
                이 요소로 감시 시작
              </button>
            </div>
          )}

          {/* Mutation Radar Auto-Detected Candidates */}
          {radarCandidates.length > 0 && (
            <div className="tiro-radar-list">
              <div className="tiro-telemetry-title">
                실시간 텍스트 변경 감지 후보 (말하는 동안 변하는 요소)
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
