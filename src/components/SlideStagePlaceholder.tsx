import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { DisplaySummary, WindowState } from '../types/electron';

interface SampleSlide {
  number: number;
  tag: string;
  title: string;
  subtitle: string;
  bullets: string[];
}

export interface LoadedImageSlide {
  name: string;
  url: string;
}

const SAMPLE_SLIDES: readonly SampleSlide[] = [
  {
    number: 1,
    tag: 'WINDOWS 10/11 DUAL PRESENTATION WORKFLOW',
    title: 'Windows 실시간 다국어 이중언어 발표 워크스페이스',
    subtitle: 'PowerPoint 자동 정렬 모드 & PowerPoint 없는 내장 슬라이드 통합 발표 모드',
    bullets: [
      'PowerPoint 설치 PC: [🚀 PPT 프로젝터 발표] 클릭 시 창 모드 슬라이드쇼가 좌측에 테두리 없이 자동 배치됩니다.',
      'PowerPoint 없는 PC: [📂 슬라이드 이미지 열기]로 PNG/JPG 슬라이드를 불러온 뒤 [🖼 내장 슬라이드 발표]를 누르면 프로젝터 전체 화면에 슬라이드와 실시간 번역 자막을 함께 송출합니다.',
      '영어·일본어·중국어·스페인어·프랑스어·독일어·베트남어·한국어 발화를 자동 감지하여 실시간 번역합니다.'
    ]
  },
  {
    number: 2,
    tag: 'NETWORK SCOPE · LOCAL AI & ADAPTIVE TIRO CAPTURE',
    title: '네트워크 필요 범위 안내 및 로컬 AI 다국어 번역',
    subtitle: '음성 인식은 Tiro 온라인 연결 필요 · 번역 AI는 최초 1회 다운로드 후 로컬 오프라인 구동',
    bullets: [
      '실시간 음성 인식(STT)은 Tiro 웹 서비스를 통해 동작하므로 발표 중 인터넷 및 Tiro 연결이 필요합니다.',
      'Meta NLLB-200 600M 번역 엔진은 최초 1회 약 680MB 다운로드 후 외부 API 키·비용 없이 로컬에서 오프라인으로 동작합니다.',
      '다중 앵커 DOM 지문(구조·역할·화면 좌표·텍스트 스트림) 기반 자가 복구로 Tiro 내부 클래스가 바뀌어도 자막 연결을 자동 유지합니다.'
    ]
  },
  {
    number: 3,
    tag: 'CRASH-SAFE AUTO-SAVE & LONG CONFERENCE VIRTUALIZATION',
    title: '세션 자동 저장·복구 및 장시간 컨퍼런스 가상화 렌더링',
    subtitle: 'Per-Monitor DPI v2 정밀 보정 · 실시간 자동 백업 · 가상화 스크롤',
    bullets: [
      '발표 중 수집되는 모든 원문·번역 자막은 세션별로 로컬 디스크에 자동 저장되어 앱 재시작 후에도 1클릭으로 복구됩니다.',
      '수천 문장이 누적되는 장시간 컨퍼런스에서도 가변 높이 목록 가상화(Virtualization)로 메모리와 렌더링 속도를 일정하게 유지합니다.',
      '단축키: 좌/우 화살표 · PageUp/PageDown · Space (내장 슬라이드 이동), Home/End (처음/끝), F11 (통합 전체화면)'
    ]
  }
];

const naturalCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

export function createLoadedSlidesFromFiles(fileList: FileList | File[]): LoadedImageSlide[] {
  const files = Array.from(fileList)
    .filter((f) => f.type.startsWith('image/') || /\.(png|jpe?g|webp|svg|bmp)$/i.test(f.name))
    .sort((a, b) => naturalCollator.compare(a.name, b.name));

  return files.map((file) => ({
    name: file.name,
    url: URL.createObjectURL(file)
  }));
}

interface SlideStagePlaceholderProps {
  cleanMode: boolean;
  onToggleCleanMode: () => void;
  windowState: WindowState;
  displays: DisplaySummary[];
  projectorDisplayId: number | null;
  pptRatio: number;
  pptBorderless: boolean;
  layoutNotice: string | null;
  imageSlides: LoadedImageSlide[];
  slideIndex: number;
  onLoadImageFiles: (files: FileList | File[]) => void;
  onResetDeck: () => void;
  onChangeSlideIndex: (index: number) => void;
  onChangeProjectorDisplay: (displayId: number | null) => void;
  onChangePptRatio: (ratio: number) => void;
  onTogglePptBorderless: () => void;
  onStartProjectorPresentation: () => void;
  onStartBuiltinPresentation: () => void;
  onExitPresentationMode: () => void;
  onArrangePptOnly: () => void;
  onOpenTiroSetup: () => void;
  onOpenReadinessGuide: () => void;
  onToggleFullScreen: () => void;
  onMoveToDisplay: (displayId: number) => void;
}

export const SlideStagePlaceholder: React.FC<SlideStagePlaceholderProps> = React.memo(
  ({
    cleanMode,
    onToggleCleanMode,
    windowState,
    displays,
    projectorDisplayId,
    pptRatio,
    pptBorderless,
    layoutNotice,
    imageSlides,
    slideIndex,
    onLoadImageFiles,
    onResetDeck,
    onChangeSlideIndex,
    onChangeProjectorDisplay,
    onChangePptRatio,
    onTogglePptBorderless,
    onStartProjectorPresentation,
    onStartBuiltinPresentation,
    onExitPresentationMode,
    onArrangePptOnly,
    onOpenTiroSetup,
    onOpenReadinessGuide,
    onToggleFullScreen,
    onMoveToDisplay
  }) => {
    const [zoomPercent, setZoomPercent] = useState(100);
    const [showProjectorSetup, setShowProjectorSetup] = useState(true);
    const [isDragOver, setIsDragOver] = useState(false);
    const fileInputRef = useRef<HTMLInputElement | null>(null);

    const isBuiltinLive =
      windowState.isPresentationMode && windowState.presentationStageMode === 'builtin-deck';
    const hasCustomDeck = imageSlides.length > 0;
    const totalSlides = hasCustomDeck ? imageSlides.length : SAMPLE_SLIDES.length;
    const safeIndex = Math.min(slideIndex, Math.max(0, totalSlides - 1));
    const currentSample = SAMPLE_SLIDES[safeIndex] ?? SAMPLE_SLIDES[0];
    const currentImage = hasCustomDeck ? imageSlides[safeIndex] : null;

    const goPrev = useCallback(() => {
      onChangeSlideIndex(Math.max(0, safeIndex - 1));
    }, [onChangeSlideIndex, safeIndex]);

    const goNext = useCallback(() => {
      onChangeSlideIndex(Math.min(totalSlides - 1, safeIndex + 1));
    }, [onChangeSlideIndex, safeIndex, totalSlides]);

    useEffect(() => {
      const handleKeyDown = (event: KeyboardEvent) => {
        const target = event.target as HTMLElement | null;
        if (
          target &&
          (target.tagName === 'INPUT' ||
            target.tagName === 'TEXTAREA' ||
            target.tagName === 'SELECT' ||
            target.isContentEditable)
        ) {
          return;
        }

        if (event.key === 'ArrowRight' || event.key === 'PageDown' || event.key === ' ') {
          event.preventDefault();
          goNext();
        } else if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
          event.preventDefault();
          goPrev();
        } else if (event.key === 'Home') {
          event.preventDefault();
          onChangeSlideIndex(0);
        } else if (event.key === 'End') {
          event.preventDefault();
          onChangeSlideIndex(Math.max(0, totalSlides - 1));
        } else if (event.key === 'F11') {
          event.preventDefault();
          onToggleFullScreen();
        }
      };

      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }, [goNext, goPrev, onChangeSlideIndex, onToggleFullScreen, totalSlides]);

    return (
      <section
        className={`ppt-region ${isDragOver ? 'ppt-region-dragover' : ''} ${
          isBuiltinLive ? 'builtin-presentation-stage' : ''
        }`}
        aria-label={`발표 슬라이드 영역 (${pptRatio}%)`}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragOver(true);
        }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragOver(false);
          if (e.dataTransfer.files?.length) {
            onLoadImageFiles(e.dataTransfer.files);
          }
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files?.length) {
              onLoadImageFiles(e.target.files);
              e.target.value = '';
            }
          }}
        />

        {!cleanMode && isBuiltinLive && (
          <header className="ppt-toolbar ppt-toolbar-live">
            <div className="ppt-toolbar-left">
              <span className="phase-badge phase-badge-live">
                🟢 내장 슬라이드 프로젝터 발표 중 ({pptRatio}% : {100 - pptRatio}%)
              </span>
              <button
                type="button"
                className="toolbar-btn"
                onClick={() => fileInputRef.current?.click()}
                title="발표할 슬라이드 이미지(PNG/JPG)를 불러오거나 교체합니다"
              >
                📂 슬라이드 이미지 열기
              </button>
            </div>
            <div className="ppt-toolbar-right">
              <div className="zoom-controls" role="group" aria-label="슬라이드 확대/축소">
                <button
                  type="button"
                  className="toolbar-btn"
                  onClick={() => setZoomPercent((z) => Math.max(60, z - 10))}
                  title="슬라이드 축소"
                >
                  −
                </button>
                <button
                  type="button"
                  className="toolbar-btn toolbar-btn-text"
                  onClick={() => setZoomPercent(100)}
                  title="화면 맞춤 (100%)"
                >
                  {zoomPercent}%
                </button>
                <button
                  type="button"
                  className="toolbar-btn"
                  onClick={() => setZoomPercent((z) => Math.min(150, z + 10))}
                  title="슬라이드 확대"
                >
                  +
                </button>
              </div>
              <button
                type="button"
                className="toolbar-btn"
                onClick={onToggleCleanMode}
                title="상하단 툴바를 숨겨 슬라이드와 자막만 깔끔하게 표시합니다"
              >
                클린 모드
              </button>
              <button
                type="button"
                className="toolbar-btn toolbar-btn-stop"
                onClick={onExitPresentationMode}
                title="내장 슬라이드 프로젝터 발표 모드를 종료합니다"
              >
                ⏹ 발표 종료
              </button>
            </div>
          </header>
        )}

        {!cleanMode && !isBuiltinLive && (
          <header className="ppt-toolbar">
            <div className="ppt-toolbar-left">
              <span
                className="phase-badge"
                title="좌측 슬라이드 영역과 우측 자막 영역 비율"
              >
                🖥 슬라이드 ({pptRatio}%) : 자막 ({100 - pptRatio}%)
              </span>

              <button
                type="button"
                className="toolbar-btn toolbar-btn-primary"
                onClick={onStartProjectorPresentation}
                title="프로젝터에 우측 자막 사이드바를 배치하고 PowerPoint 슬라이드쇼를 좌측에 자동 정렬합니다"
              >
                🚀 PPT 프로젝터 발표
              </button>

              <button
                type="button"
                className="toolbar-btn toolbar-btn-primary"
                data-testid="start-builtin-presentation"
                onClick={onStartBuiltinPresentation}
                title="PowerPoint 없이 프로젝터 전체 화면에 내장 이미지 슬라이드와 실시간 자막을 함께 송출합니다"
              >
                🖼 내장 슬라이드 발표
              </button>

              <button
                type="button"
                className="toolbar-btn"
                onClick={() => fileInputRef.current?.click()}
                title="내보낸 슬라이드 이미지(PNG/JPG) 여러 장을 불러와 PowerPoint 없이 발표합니다"
              >
                📂 슬라이드 이미지 열기{hasCustomDeck ? ` (${imageSlides.length}장)` : ''}
              </button>

              <button
                type="button"
                className="toolbar-btn"
                onClick={onArrangePptOnly}
                title="현재 열려 있는 PowerPoint 슬라이드쇼 창의 위치만 다시 맞춥니다"
              >
                ⚡ PPT 창 맞춤
              </button>

              {hasCustomDeck && (
                <button
                  type="button"
                  className="toolbar-btn"
                  onClick={onResetDeck}
                  title="불러온 슬라이드 이미지를 닫고 가이드 화면으로 돌아갑니다"
                >
                  가이드 보기
                </button>
              )}
            </div>

            <div className="ppt-toolbar-right">
              <button
                type="button"
                className="toolbar-btn"
                onClick={onOpenReadinessGuide}
                title="온라인/오프라인 동작 범위, AI 모델 다운로드 용량 및 준비 상태를 확인합니다"
              >
                ❓ 준비 안내
              </button>

              <button
                type="button"
                className={`toolbar-btn ${showProjectorSetup ? 'toolbar-btn-active' : ''}`}
                onClick={() => setShowProjectorSetup((v) => !v)}
              >
                {showProjectorSetup ? '배치 설정 접기' : '배치 설정'}
              </button>

              {displays.length > 1 && (
                <select
                  className="toolbar-select"
                  value={windowState.currentDisplayId}
                  onChange={(e) => onMoveToDisplay(Number(e.target.value))}
                  aria-label="현재 창 모니터 이동"
                  title="현재 창을 다른 모니터로 이동"
                >
                  {displays.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.label} ({d.width}×{d.height}){d.isPrimary ? ' [주 모니터]' : ''}
                    </option>
                  ))}
                </select>
              )}

              <div className="zoom-controls" role="group" aria-label="슬라이드 확대/축소">
                <button
                  type="button"
                  className="toolbar-btn"
                  onClick={() => setZoomPercent((z) => Math.max(60, z - 10))}
                  title="슬라이드 축소"
                >
                  −
                </button>
                <button
                  type="button"
                  className="toolbar-btn toolbar-btn-text"
                  onClick={() => setZoomPercent(100)}
                  title="화면 맞춤 (100%)"
                >
                  {zoomPercent}%
                </button>
                <button
                  type="button"
                  className="toolbar-btn"
                  onClick={() => setZoomPercent((z) => Math.min(150, z + 10))}
                  title="슬라이드 확대"
                >
                  +
                </button>
              </div>

              <button
                type="button"
                className="toolbar-btn"
                onClick={onToggleFullScreen}
                title="통합 전체 화면 전환 (F11)"
              >
                {windowState.isFullScreen ? '전체화면 해제' : '전체화면'}
              </button>
            </div>
          </header>
        )}

        {/* Windows Projector & PowerPoint Quick Configuration Bar */}
        {!cleanMode && !isBuiltinLive && showProjectorSetup && (
          <div className="projector-config-bar">
            <div className="projector-config-group">
              <label className="projector-config-label" htmlFor="projector-display-select">
                대상 프로젝터/모니터:
              </label>
              <select
                id="projector-display-select"
                className="toolbar-select"
                value={projectorDisplayId == null ? 'auto' : String(projectorDisplayId)}
                onChange={(e) =>
                  onChangeProjectorDisplay(
                    e.target.value === 'auto' ? null : Number(e.target.value)
                  )
                }
              >
                <option value="auto">자동 선택 (연결된 보조 프로젝터 우선)</option>
                {displays.map((d) => (
                  <option key={d.id} value={String(d.id)}>
                    {d.label} ({d.width}×{d.height}){d.isPrimary ? ' · 주 모니터' : ' · 보조'}
                  </option>
                ))}
              </select>
            </div>

            <div className="projector-config-group">
              <span className="projector-config-label">슬라이드 화면 비율:</span>
              <div className="control-btn-group">
                {[70, 72, 75, 80].map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    className={`mini-btn ${pptRatio === preset ? 'mini-btn-active' : ''}`}
                    onClick={() => onChangePptRatio(preset)}
                  >
                    {preset}:{100 - preset}
                  </button>
                ))}
              </div>
              <input
                type="range"
                min={50}
                max={85}
                step={1}
                value={pptRatio}
                onChange={(e) => onChangePptRatio(Number(e.target.value))}
                className="ratio-slider"
                aria-label="슬라이드 화면 비율 슬라이더"
              />
            </div>

            <label
              className="projector-checkbox-label"
              title="Windows에서 PowerPoint 창 제목 표시줄 및 테두리를 제거하여 풀스크린처럼 깔끔하게 맞춥니다"
            >
              <input
                type="checkbox"
                checked={pptBorderless}
                onChange={onTogglePptBorderless}
              />
              <span>PPT 창 테두리 제거 (Borderless)</span>
            </label>

            <button
              type="button"
              className="mini-btn"
              onClick={onOpenTiroSetup}
              title="Tiro 로그인 및 실시간 자막 요소 선택 화면 열기"
            >
              🎤 Tiro 로그인/설정 열기
            </button>
          </div>
        )}

        {!cleanMode && layoutNotice && (
          <div className="projector-notice-banner" role="status">
            {layoutNotice}
          </div>
        )}

        {cleanMode && (
          <button
            type="button"
            className="clean-mode-restore-btn"
            onClick={onToggleCleanMode}
            title="상단 제어 바 다시 표시"
          >
            제어 바 표시
          </button>
        )}

        <div className="slide-viewport">
          <div
            className="slide-canvas-wrapper"
            style={{
              transform: `scale(${zoomPercent / 100})`
            }}
          >
            {currentImage ? (
              <div className="image-slide-frame">
                <img
                  src={currentImage.url}
                  alt={currentImage.name}
                  className="image-slide-img"
                  draggable={false}
                />
              </div>
            ) : (
              <article className="sample-slide-card">
                <div className="sample-slide-tag">{currentSample.tag}</div>
                <h1 className="sample-slide-title">{currentSample.title}</h1>
                <p className="sample-slide-subtitle">{currentSample.subtitle}</p>
                <ul className="sample-slide-list">
                  {currentSample.bullets.map((bullet, idx) => (
                    <li key={idx}>{bullet}</li>
                  ))}
                </ul>
                <footer className="sample-slide-footer">
                  <span>16:9 Presentation Stage · PNG/JPG 슬라이드 드래그 앤 드롭 발표 지원</span>
                  <span>
                    Slide {currentSample.number} / {totalSlides}
                  </span>
                </footer>
              </article>
            )}
          </div>
        </div>

        <footer className={`ppt-bottom-bar ${cleanMode || isBuiltinLive ? 'ppt-bottom-bar-minimal' : ''}`}>
          <button
            type="button"
            className="toolbar-btn toolbar-btn-text"
            onClick={goPrev}
            disabled={safeIndex === 0}
          >
            ◀ 이전
          </button>
          <span className="slide-indicator" aria-live="polite">
            {currentImage ? `${currentImage.name} · ` : '슬라이드 '}
            <strong>{safeIndex + 1}</strong> / {totalSlides}
          </span>
          <button
            type="button"
            className="toolbar-btn toolbar-btn-text"
            onClick={goNext}
            disabled={safeIndex === totalSlides - 1}
          >
            다음 ▶
          </button>
        </footer>
      </section>
    );
  }
);

SlideStagePlaceholder.displayName = 'SlideStagePlaceholder';
