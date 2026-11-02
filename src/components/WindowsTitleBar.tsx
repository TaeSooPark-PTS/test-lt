import React from 'react';
import type { CaptionProviderStatus } from '../types/caption';
import type { TranslatorStatus, WindowState } from '../types/electron';
import type { TranslationEngineId } from '../types/settings';

interface WindowsTitleBarProps {
  windowState: WindowState;
  cleanMode: boolean;
  captionStatus: CaptionProviderStatus;
  translationEngine: TranslationEngineId;
  translatorStatus: TranslatorStatus | null;
  onTogglePresentationMode: () => void;
  onToggleCleanMode: () => void;
  onToggleAlwaysOnTop: () => void;
  onMinimize: () => void;
  onToggleMaximize: () => void;
  onClose: () => void;
}

export const WindowsTitleBar: React.FC<WindowsTitleBarProps> = ({
  windowState,
  cleanMode,
  captionStatus,
  translationEngine,
  translatorStatus,
  onTogglePresentationMode,
  onToggleCleanMode,
  onToggleAlwaysOnTop,
  onMinimize,
  onToggleMaximize,
  onClose
}) => {
  const isSidebar = windowState.isPresentationMode;

  return (
    <header
      className={`win-titlebar ${cleanMode ? 'win-titlebar-clean' : ''} ${
        isSidebar ? 'win-titlebar-sidebar' : ''
      }`}
      onDoubleClick={(e) => {
        if ((e.target as HTMLElement).closest('.win-no-drag')) return;
        onToggleMaximize();
      }}
    >
      <div className="win-titlebar-left">
        <span className="win-app-logo" aria-hidden="true">
          ⚡
        </span>
        <span className="win-app-title">
          {isSidebar ? 'Tiro 실시간 번역 사이드바' : 'Tiro Live Bilingual Caption Workspace'}
        </span>
        <span
          className={`win-mode-badge ${isSidebar ? 'win-mode-badge-live' : ''}`}
          title={
            isSidebar
              ? '프로젝터 우측 자막 사이드바 모드 동작 중'
              : '설정 및 통합 슬라이드 워크스페이스 모드'
          }
        >
          {isSidebar ? 'LIVE 사이드바' : '워크스페이스'}
        </span>
        {cleanMode && (
          <span className="win-clean-indicator">
            <span className={`status-dot status-dot-${captionStatus.state}`} />
            {translationEngine === 'local' && translatorStatus?.state === 'ready'
              ? '오프라인 AI 활성'
              : captionStatus.isMock
                ? 'Mock'
                : 'Tiro Live'}
          </span>
        )}
      </div>

      <div className="win-titlebar-actions win-no-drag">
        <button
          type="button"
          className={`win-action-pill ${isSidebar ? 'win-action-pill-stop' : 'win-action-pill-live'}`}
          onClick={onTogglePresentationMode}
          data-testid="toggle-presentation-mode"
          title={
            isSidebar
              ? '발표 사이드바 모드를 종료하고 기본 워크스페이스 크기로 복귀합니다'
              : '프로젝터 우측 자막 사이드바로 전환하고 PowerPoint 슬라이드쇼를 좌측에 자동 배치합니다'
          }
        >
          {isSidebar ? '⏹ 발표 종료' : '🚀 프로젝터 발표'}
        </button>

        <button
          type="button"
          className={`win-action-pill ${cleanMode ? 'win-action-pill-active' : ''}`}
          onClick={onToggleCleanMode}
          title="발표 중 불필요한 상하단 설정 툴바 숨기기/표시"
        >
          {cleanMode ? '툴바 표시' : '클린 모드'}
        </button>

        <button
          type="button"
          className={`win-action-pill ${windowState.isAlwaysOnTop ? 'win-action-pill-active' : ''}`}
          onClick={onToggleAlwaysOnTop}
          title="다른 창(PowerPoint 등) 클릭 시에도 자막 창을 항상 맨 위에 유지합니다"
        >
          📌 {windowState.isAlwaysOnTop ? '고정됨' : '항상 위'}
        </button>

        <div className="win-caption-controls" role="group" aria-label="창 제어">
          <button
            type="button"
            className="win-caption-btn"
            onClick={onMinimize}
            aria-label="최소화"
            title="최소화"
          >
            ─
          </button>
          <button
            type="button"
            className="win-caption-btn"
            onClick={onToggleMaximize}
            aria-label={windowState.isMaximized ? '이전 크기로 복원' : '최대화'}
            title={windowState.isMaximized ? '이전 크기로 복원' : '최대화'}
          >
            {windowState.isMaximized ? '❐' : '□'}
          </button>
          <button
            type="button"
            className="win-caption-btn win-caption-btn-close"
            onClick={onClose}
            aria-label="닫기"
            title="종료"
          >
            ✕
          </button>
        </div>
      </div>
    </header>
  );
};
