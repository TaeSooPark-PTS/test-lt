import React, { useCallback, useEffect, useState } from 'react';
import type { DisplaySummary, WindowState } from '../types/electron';

interface SampleSlide {
  number: number;
  tag: string;
  title: string;
  subtitle: string;
  bullets: string[];
}

const SAMPLE_SLIDES: readonly SampleSlide[] = [
  {
    number: 1,
    tag: 'PHASE 1 LAYOUT PREVIEW · 75% STAGE',
    title: 'Real-Time Bilingual Presentation Workspace',
    subtitle: 'Unified 75% Slide Stage + 25% Synchronized English/Korean Captions',
    bullets: [
      'Left 75%: Aspect-ratio preserved presentation viewport (16:9)',
      'Right 25%: Split 50:50 into English source (12.5%) and Korean translation (12.5%)',
      'Note: PDF/PPT file loader is scheduled for Phase 5 (currently showing layout verification deck)'
    ]
  },
  {
    number: 2,
    tag: 'ARCHITECTURE OVERVIEW',
    title: 'Decoupled Caption & Translation Providers',
    subtitle: 'Interface-first architecture for safe PoC verification & swappable engines',
    bullets: [
      'CaptionProvider: MockCaptionProvider active in Phase 1; Tiro DOM/OCR PoC in Phase 3',
      'TranslationProvider: Async non-blocking queue ensures English renders immediately',
      'Sentence cards lock English and Korean cells into a shared row height'
    ]
  },
  {
    number: 3,
    tag: 'PROJECTOR & MULTI-RESOLUTION',
    title: 'Designed for Conference Room Projectors',
    subtitle: 'Responsive scaling across 1920×1080, 1366×768, 1280×720, and 1024×768',
    bullets: [
      'Keyboard navigation: Left/Right arrows or PageUp/PageDown',
      'Independent rendering: High-frequency caption updates never stutter slide view',
      'Clean Presentation Mode hides control toolbars during live talks'
    ]
  }
];

interface SlideStagePlaceholderProps {
  cleanMode: boolean;
  onToggleCleanMode: () => void;
  windowState: WindowState;
  displays: DisplaySummary[];
  onToggleFullScreen: () => void;
  onMoveToDisplay: (displayId: number) => void;
}

export const SlideStagePlaceholder: React.FC<SlideStagePlaceholderProps> = React.memo(
  ({
    cleanMode,
    onToggleCleanMode,
    windowState,
    displays,
    onToggleFullScreen,
    onMoveToDisplay
  }) => {
    const [slideIndex, setSlideIndex] = useState(0);
    const [zoomPercent, setZoomPercent] = useState(100);

    const totalSlides = SAMPLE_SLIDES.length;
    const currentSlide = SAMPLE_SLIDES[slideIndex];

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

        if (event.key === 'ArrowRight' || event.key === 'PageDown') {
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
      <section className="ppt-region" aria-label="PPT 발표 영역 (75%)">
        {!cleanMode && (
          <header className="ppt-toolbar">
            <div className="ppt-toolbar-left">
              <span className="phase-badge" title="실제 PDF/PPT 파일 열기는 Phase 5에서 구현됩니다">
                PPT 영역 (75%) · 샘플 프리뷰 (PDF 파일 열기 미구현 - Phase 5 예정)
              </span>
            </div>

            <div className="ppt-toolbar-right">
              {displays.length > 1 && (
                <select
                  className="toolbar-select"
                  value={windowState.currentDisplayId}
                  onChange={(e) => onMoveToDisplay(Number(e.target.value))}
                  aria-label="출력 모니터 선택"
                  title="프로젝터 또는 보조 모니터로 이동"
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
                className="toolbar-btn toolbar-btn-text"
                onClick={onToggleCleanMode}
                title="발표 중 상단/하단 제어 바 숨기기"
              >
                클린 모드
              </button>

              <button
                type="button"
                className="toolbar-btn toolbar-btn-primary"
                onClick={onToggleFullScreen}
                title="전체 화면 전환 (F11)"
              >
                {windowState.isFullScreen ? '전체화면 해제' : '전체화면'}
              </button>
            </div>
          </header>
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
            <article className="sample-slide-card">
              <div className="sample-slide-tag">{currentSlide.tag}</div>
              <h1 className="sample-slide-title">{currentSlide.title}</h1>
              <p className="sample-slide-subtitle">{currentSlide.subtitle}</p>
              <ul className="sample-slide-list">
                {currentSlide.bullets.map((bullet, idx) => (
                  <li key={idx}>{bullet}</li>
                ))}
              </ul>
              <footer className="sample-slide-footer">
                <span>16:9 Aspect Ratio Preserved</span>
                <span>
                  Slide {currentSlide.number} / {totalSlides}
                </span>
              </footer>
            </article>
          </div>
        </div>

        <footer className={`ppt-bottom-bar ${cleanMode ? 'ppt-bottom-bar-minimal' : ''}`}>
          <button
            type="button"
            className="toolbar-btn toolbar-btn-text"
            onClick={goPrev}
            disabled={slideIndex === 0}
          >
            ◀ 이전
          </button>
          <span className="slide-indicator" aria-live="polite">
            슬라이드 <strong>{currentSlide.number}</strong> / {totalSlides}
          </span>
          <button
            type="button"
            className="toolbar-btn toolbar-btn-text"
            onClick={goNext}
            disabled={slideIndex === totalSlides - 1}
          >
            다음 ▶
          </button>
        </footer>
      </section>
    );
  }
);

SlideStagePlaceholder.displayName = 'SlideStagePlaceholder';
