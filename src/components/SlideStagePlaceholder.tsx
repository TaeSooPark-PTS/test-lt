import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { DisplaySummary, WindowState } from '../types/electron';

interface SampleSlide {
  number: number;
  tag: string;
  title: string;
  subtitle: string;
  bullets: string[];
}

interface LoadedImageSlide {
  name: string;
  url: string;
}

const SAMPLE_SLIDES: readonly SampleSlide[] = [
  {
    number: 1,
    tag: 'WINDOWS 10/11 LIVE PRESENTATION WORKFLOW',
    title: 'Windows 실시간 영·한 이중언어 발표 워크스페이스',
    subtitle: 'PowerPoint 슬라이드쇼 (좌측 72%) + Tiro & 오프라인 AI 실시간 번역 (우측 28%)',
    bullets: [
      'Windows PowerPoint에서 발표 파일을 열고 [🚀 프로젝터 발표 시작]을 누르면 창 모드 슬라이드쇼가 좌측에 테두리 없이 자동 배치됩니다.',
      '우측 사이드바에는 Tiro 실시간 영어 자막과 Meta NLLB-200 오프라인 AI 한국어 번역이 동기화되어 표시됩니다.',
      'PowerPoint 없이 발표할 경우 상단의 [📂 슬라이드 이미지 열기]에 PNG/JPG 슬라이드를 드래그해 즉시 발표할 수 있습니다.'
    ]
  },
  {
    number: 2,
    tag: 'OFFLINE AI & ZERO-ASSUMPTION TIRO CAPTURE',
    title: 'API 키·호출 비용 없는 100% 로컬 AI 번역 엔진',
    subtitle: 'Electron UtilityProcess + Multi-threaded SIMD ONNX Runtime',
    bullets: [
      '최초 1회 모델 다운로드 후 인터넷 연결이나 외부 API 비용 없이 로컬에서 영→한 실시간 번역을 수행합니다.',
      '긴 문장을 말하는 도중에도 중간(Interim) 실시간 선발 번역이 동작하여 청중의 대기 시간을 최소화합니다.',
      '한 번 선택한 Tiro 자막 컨테이너는 자동 저장되어 앱 재실행 및 세션 전환 시에도 자동으로 재연결됩니다.'
    ]
  },
  {
    number: 3,
    tag: 'CONFERENCE ROOM & PROJECTOR CONTROLS',
    title: '회의실 프로젝터 및 다중 모니터 최적화',
    subtitle: 'Per-Monitor DPI v2 정밀 좌표 보정 · 항상 위 고정 · 자막 기록 내보내기',
    bullets: [
      'Windows 디스플레이 배율(100%~200%)을 자동 계산하여 PowerPoint 창과 자막 사이드바를 빈틈없이 정렬합니다.',
      '발표 종료 후 우측 자막 패널의 [💾 저장] 버튼으로 전체 영·한 대본을 SRT 자막, Markdown, TXT로 즉시 내보낼 수 있습니다.',
      '키보드 단축키: 좌/우 화살표 또는 PageUp/PageDown (내장 슬라이드 이동), F11 (통합 전체화면 전환)'
    ]
  }
];

const naturalCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

interface SlideStagePlaceholderProps {
  cleanMode: boolean;
  onToggleCleanMode: () => void;
  windowState: WindowState;
  displays: DisplaySummary[];
  projectorDisplayId: number | null;
  pptRatio: number;
  pptBorderless: boolean;
  layoutNotice: string | null;
  onChangeProjectorDisplay: (displayId: number | null) => void;
  onChangePptRatio: (ratio: number) => void;
  onTogglePptBorderless: () => void;
  onStartProjectorPresentation: () => void;
  onArrangePptOnly: () => void;
  onOpenTiroSetup: () => void;
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
    onChangeProjectorDisplay,
    onChangePptRatio,
    onTogglePptBorderless,
    onStartProjectorPresentation,
    onArrangePptOnly,
    onOpenTiroSetup,
    onToggleFullScreen,
    onMoveToDisplay
  }) => {
    const [slideIndex, setSlideIndex] = useState(0);
    const [zoomPercent, setZoomPercent] = useState(100);
    const [showProjectorSetup, setShowProjectorSetup] = useState(true);
    const [imageSlides, setImageSlides] = useState<LoadedImageSlide[]>([]);
    const [isDragOver, setIsDragOver] = useState(false);
    const fileInputRef = useRef<HTMLInputElement | null>(null);

    const hasCustomDeck = imageSlides.length > 0;
    const totalSlides = hasCustomDeck ? imageSlides.length : SAMPLE_SLIDES.length;
    const safeIndex = Math.min(slideIndex, Math.max(0, totalSlides - 1));
    const currentSample = SAMPLE_SLIDES[safeIndex] ?? SAMPLE_SLIDES[0];
    const currentImage = hasCustomDeck ? imageSlides[safeIndex] : null;

    const loadFilesAsSlides = useCallback((fileList: FileList | File[]) => {
      const files = Array.from(fileList)
        .filter((f) => f.type.startsWith('image/') || /\.(png|jpe?g|webp|svg|bmp)$/i.test(f.name))
        .sort((a, b) => naturalCollator.compare(a.name, b.name));
      if (files.length === 0) return;

      setImageSlides((prev) => {
        prev.forEach((s) => URL.revokeObjectURL(s.url));
        return files.map((file) => ({
          name: file.name,
          url: URL.createObjectURL(file)
        }));
      });
      setSlideIndex(0);
    }, []);

    useEffect(() => {
      return () => {
        imageSlides.forEach((s) => URL.revokeObjectURL(s.url));
      };
    }, [imageSlides]);

    const handleResetDeck = useCallback(() => {
      setImageSlides((prev) => {
        prev.forEach((s) => URL.revokeObjectURL(s.url));
        return [];
      });
      setSlideIndex(0);
    }, []);

    const goPrev = useCallback(() => {
      setSlideIndex((prev) => Math.max(0, prev - 1));
    }, []);

    const goNext = useCallback(() => {
      setSlideIndex((prev) => Math.min(totalSlides - 1, prev + 1));
    }, [totalSlides]);

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
        } else if (event.key === 'F11') {
          event.preventDefault();
          onToggleFullScreen();
        }
      };

      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }, [goNext, goPrev, onToggleFullScreen]);

    return (
      <section
        className={`ppt-region ${isDragOver ? 'ppt-region-dragover' : ''}`}
        aria-label={`PPT 발표 영역 (${pptRatio}%)`}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragOver(true);
        }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragOver(false);
          if (e.dataTransfer.files?.length) {
            loadFilesAsSlides(e.dataTransfer.files);
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
              loadFilesAsSlides(e.target.files);
              e.target.value = '';
            }
          }}
        />

        {!cleanMode && (
          <header className="ppt-toolbar">
            <div className="ppt-toolbar-left">
              <span
                className="phase-badge"
                title="PowerPoint를 창 모드 슬라이드쇼로 자동 실행하여 프로젝터 왼쪽 영역에 배치합니다"
              >
                🖥 슬라이드 영역 ({pptRatio}%) : 자막 ({100 - pptRatio}%)
              </span>

              <button
                type="button"
                className="toolbar-btn toolbar-btn-primary"
                onClick={onStartProjectorPresentation}
                title="프로젝터에 우측 자막 사이드바를 배치하고 PowerPoint 슬라이드쇼를 좌측에 자동 정렬합니다"
              >
                🚀 프로젝터 발표 시작 (PPT 자동 정렬)
              </button>

              <button
                type="button"
                className="toolbar-btn"
                onClick={onArrangePptOnly}
                title="현재 열려 있는 PowerPoint 슬라이드쇼 창의 위치만 다시 맞춥니다"
              >
                ⚡ PPT 창 맞춤
              </button>

              <button
                type="button"
                className="toolbar-btn"
                onClick={() => fileInputRef.current?.click()}
                title="내보낸 슬라이드 이미지(PNG/JPG) 여러 장을 불러와 내장 슬라이드 뷰어로 발표합니다"
              >
                📂 슬라이드 이미지 열기
              </button>

              {hasCustomDeck && (
                <button
                  type="button"
                  className="toolbar-btn"
                  onClick={handleResetDeck}
                  title="불러온 슬라이드 이미지를 닫고 가이드 화면으로 돌아갑니다"
                >
                  가이드 보기
                </button>
              )}
            </div>

            <div className="ppt-toolbar-right">
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
                className="toolbar-btn toolbar-btn-primary"
                onClick={onToggleFullScreen}
                title="통합 전체 화면 전환 (F11)"
              >
                {windowState.isFullScreen ? '전체화면 해제' : '통합 전체화면'}
              </button>
            </div>
          </header>
        )}

        {/* Windows Projector & PowerPoint Quick Configuration Bar */}
        {!cleanMode && showProjectorSetup && (
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
              <span className="projector-config-label">PPT 화면 비율:</span>
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
                aria-label="PPT 화면 비율 슬라이더"
              />
            </div>

            <label className="projector-checkbox-label" title="Windows에서 PowerPoint 창 제목 표시줄 및 테두리를 제거하여 풀스크린처럼 깔끔하게 맞춥니다">
              <input
                type="checkbox"
                checked={pptBorderless}
                onChange={onTogglePptBorderless}
              />
              <span>PPT 창 제목 표시줄 제거 (Borderless)</span>
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
                  <span>16:9 Presentation Stage · 이미지 슬라이드 드래그 앤 드롭 지원</span>
                  <span>
                    Slide {currentSample.number} / {totalSlides}
                  </span>
                </footer>
              </article>
            )}
          </div>
        </div>

        <footer className={`ppt-bottom-bar ${cleanMode ? 'ppt-bottom-bar-minimal' : ''}`}>
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
