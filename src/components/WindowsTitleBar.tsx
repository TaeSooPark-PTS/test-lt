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
  onStartBuiltinPresentation: () => void;
  onOpenReadinessGuide: () => void;
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
  onStartBuiltinPresentation,
  onOpenReadinessGuide,
  onToggleCleanMode,
  onToggleAlwaysOnTop,
  onMinimize,
  onToggleMaximize,
  onClose
}) => {
  const isPresenting = windowState.isPresentationMode;
  const isBuiltinDeck = isPresenting && windowState.presentationStageMode === 'builtin-deck';
  const isExternalSidebar = isPresenting && !isBuiltinDeck;

  return (
    <header
      className={`win-titlebar ${cleanMode ? 'win-titlebar-clean' : ''} ${
        isExternalSidebar ? 'win-titlebar-sidebar' : ''
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
          {isExternalSidebar
            ? 'Tiro 실시간 번역 사이드바'
            : isBuiltinDeck
              ? 'Tiro 내장 슬라이드 + 실시간 다국어 자막 발표'
              : 'Tiro Live Bilingual Caption Workspace'}
        </span>
        <span
          className={`win-mode-badge ${isPresenting ? 'win-mode-badge-live' : ''}`}
          title={
            isBuiltinDeck
              ? 'PowerPoint 없이 내장 슬라이드 스테이지 + 자막 통합 발표 중'
              : isExternalSidebar
                ? '프로젝터 우측 자막 사이드바 모드 동작 중'
                : '설정 및 통합 슬라이드 워크스페이스 모드'
          }
        >
          {isBuiltinDeck ? 'LIVE 통합 발표' : isExternalSidebar ? 'LIVE 사이드바' : '워크스페이스'}
        </span>
        {cleanMode && (
          <span className="win-clean-indicator">
            <span className={`status-dot status-dot-${captionStatus.state}`} />
            {translationEngine === 'local'
              ? translatorStatus?.state === 'ready'
                ? '로컬 AI 활성'
                : translatorStatus?.cachedOnDisk
                  ? '로컬 AI 준비'
                  : 'AI 모델 다운로드 필요'
              : captionStatus.isMock
                ? 'Mock'
                : 'Tiro Live'}
          </span>
        )}
      </div>

      <div className="win-titlebar-actions win-no-drag">
        {isPresenting ? (
          <button
            type="button"
            className="win-action-pill win-action-pill-stop"
            onClick={onTogglePresentationMode}
            data-testid="toggle-presentation-mode"
            title="발표 모드를 종료하고 기본 워크스페이스 크기로 복귀합니다"
          >
            ⏹ 발표 종료
          </button>
        ) : (
          <>
            <button
              type="button"
              className="win-action-pill win-action-pill-live"
              onClick={onTogglePresentationMode}
              data-testid="toggle-presentation-mode"
              title="프로젝터 우측 자막 사이드바로 전환하고 PowerPoint 슬라이드쇼를 좌측에 자동 배치합니다"
            >
              🚀 PPT 발표
            </button>
            <button
              type="button"
              className="win-action-pill win-action-pill-live"
              onClick={onStartBuiltinPresentation}
              data-testid="titlebar-builtin-presentation"
              title="PowerPoint 없이 프로젝터 전체 화면에 내장 이미지 슬라이드 + 실시간 번역 자막을 함께 송출합니다"
            >
              🖼 내장 발표
            </button>
          </>
        )}

        <button
          type="button"
          className="win-action-pill"
          onClick={onOpenReadinessGuide}
          data-testid="open-readiness-guide"
          title="온라인/오프라인 범위, AI 모델 용량 및 발표 준비 상태를 확인합니다"
        >
          ❓ 준비 안내
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
