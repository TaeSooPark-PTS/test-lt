import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CaptionCardItem } from '../types/caption';
import type { CaptionLayout, SourceLanguageSetting } from '../types/settings';
import { computeVirtualRange } from '../utils/virtualWindow';

interface CaptionRowCardProps {
  item: CaptionCardItem;
  isLatest: boolean;
  captionLayout: CaptionLayout;
  showEnglish: boolean;
  fontSizePx: number;
  sourceLanguage: SourceLanguageSetting;
  onRetryTranslation: (captionId: string) => void;
  onMeasureHeight: (captionId: string, heightPx: number) => void;
}

const CaptionRowCard: React.FC<CaptionRowCardProps> = React.memo(
  ({
    item,
    isLatest,
    captionLayout,
    showEnglish,
    fontSizePx,
    sourceLanguage,
    onRetryTranslation,
    onMeasureHeight
  }) => {
    const cardRef = useRef<HTMLElement | null>(null);

    useEffect(() => {
      const el = cardRef.current;
      if (!el) return;

      const report = () => {
        const h = el.getBoundingClientRect().height;
        if (h > 0) {
          onMeasureHeight(item.id, h);
        }
      };
      report();

      if (typeof ResizeObserver !== 'undefined') {
        const ro = new ResizeObserver(report);
        ro.observe(el);
        return () => ro.disconnect();
      }
      return undefined;
    }, [
      item.id,
      item.englishText,
      item.koreanText,
      item.translationState,
      fontSizePx,
      captionLayout,
      showEnglish,
      onMeasureHeight
    ]);

    const showLangBadge =
      Boolean(item.detectedLang) &&
      (sourceLanguage === 'auto' || item.detectedLang !== sourceLanguage);

    return (
      <article
        ref={cardRef}
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
          <div className="caption-cell caption-cell-en" lang={item.detectedLang || 'en'}>
            {showLangBadge && (
              <span className="lang-detect-badge" title={`감지된 발화 언어: ${item.detectedLang?.toUpperCase()}`}>
                {item.detectedLang?.toUpperCase()}
              </span>
            )}
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
  }
);

CaptionRowCard.displayName = 'CaptionRowCard';

interface VirtualizedCaptionListProps {
  captions: CaptionCardItem[];
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
  captionLayout: CaptionLayout;
  showEnglish: boolean;
  fontSizePx: number;
  cardGapPx: number;
  sourceLanguage: SourceLanguageSetting;
  activeSource: 'mock' | 'tiro';
  onScroll: () => void;
  onRetryTranslation: (captionId: string) => void;
}

function estimateCardHeight(
  item: CaptionCardItem,
  fontSizePx: number,
  captionLayout: CaptionLayout,
  showEnglish: boolean
): number {
  const lineH = Math.round(fontSizePx * 1.55);
  const srcLen = item.englishText.length;
  const tgtLen = (item.koreanText ?? '').length;

  if (!showEnglish) {
    const lines = Math.max(1, Math.ceil(Math.max(16, tgtLen) / 26));
    return lines * lineH + 28;
  }

  if (captionLayout === 'stacked') {
    const srcLines = Math.max(1, Math.ceil(srcLen / 42));
    const tgtLines = Math.max(1, Math.ceil(Math.max(12, tgtLen) / 28));
    return (srcLines + tgtLines) * lineH + 38;
  }

  const maxLines = Math.max(
    1,
    Math.ceil(srcLen / 28),
    Math.ceil(Math.max(12, tgtLen) / 18)
  );
  return maxLines * lineH + 28;
}

export const VirtualizedCaptionList: React.FC<VirtualizedCaptionListProps> = ({
  captions,
  scrollContainerRef,
  captionLayout,
  showEnglish,
  fontSizePx,
  cardGapPx,
  sourceLanguage,
  activeSource,
  onScroll,
  onRetryTranslation
}) => {
  const heightCacheRef = useRef<Map<string, number>>(new Map());
  const [scrollMetrics, setScrollMetrics] = useState({ scrollTop: 0, viewportHeight: 800 });
  const [, setMeasureTick] = useState(0);

  // Invalidate cached heights when layout geometry or typography changes
  useEffect(() => {
    heightCacheRef.current.clear();
    setMeasureTick((t) => t + 1);
  }, [fontSizePx, captionLayout, showEnglish]);

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;

    const updateViewport = () => {
      setScrollMetrics({
        scrollTop: el.scrollTop,
        viewportHeight: el.clientHeight || 800
      });
    };
    updateViewport();

    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => {
        heightCacheRef.current.clear();
        updateViewport();
      });
      ro.observe(el);
      return () => ro.disconnect();
    }
    return undefined;
  }, [scrollContainerRef]);

  const handleContainerScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (el) {
      setScrollMetrics({
        scrollTop: el.scrollTop,
        viewportHeight: el.clientHeight || 800
      });
    }
    onScroll();
  }, [onScroll, scrollContainerRef]);

  const handleMeasureHeight = useCallback((captionId: string, heightPx: number) => {
    const rounded = Math.round(heightPx);
    const prev = heightCacheRef.current.get(captionId);
    if (prev === undefined || Math.abs(prev - rounded) >= 2) {
      heightCacheRef.current.set(captionId, rounded);
    }
  }, []);

  const range = useMemo(() => {
    return computeVirtualRange({
      itemCount: captions.length,
      scrollTop: scrollMetrics.scrollTop,
      viewportHeight: scrollMetrics.viewportHeight,
      gapPx: cardGapPx,
      overscan: 8,
      getItemHeight: (index) => {
        const item = captions[index];
        return (
          heightCacheRef.current.get(item.id) ??
          estimateCardHeight(item, fontSizePx, captionLayout, showEnglish)
        );
      }
    });
  }, [
    captions,
    scrollMetrics.scrollTop,
    scrollMetrics.viewportHeight,
    cardGapPx,
    fontSizePx,
    captionLayout,
    showEnglish
  ]);

  const visibleItems = useMemo(() => {
    if (captions.length === 0 || range.endIndex < range.startIndex) return [];
    return captions.slice(range.startIndex, range.endIndex + 1);
  }, [captions, range.startIndex, range.endIndex]);

  return (
    <div
      ref={scrollContainerRef}
      className={`caption-scroll-area layout-${captionLayout} ${
        !showEnglish ? 'layout-korean-only' : ''
      }`}
      onScroll={handleContainerScroll}
      style={{ gap: `${cardGapPx}px` }}
    >
      {captions.length === 0 ? (
        <div className="caption-empty-state">
          {activeSource === 'tiro' ? (
            <>
              <p className="caption-empty-title">Tiro 실시간 다국어 자막 대기 중</p>
              <p className="caption-empty-desc">
                Tiro 화면에서 로그인 후 음성 인식을 시작하면 발화 언어를 자동 감지하여 이곳에{' '}
                <strong>실시간 번역 자막</strong>이 표출됩니다.
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
        <>
          {range.topSpacerPx > 0 && (
            <div
              className="virtual-spacer"
              style={{ height: `${range.topSpacerPx}px`, flexShrink: 0 }}
              aria-hidden="true"
            />
          )}
          {visibleItems.map((item, offsetIdx) => {
            const actualIndex = range.startIndex + offsetIdx;
            const isLatest = actualIndex === captions.length - 1;
            return (
              <CaptionRowCard
                key={item.id}
                item={item}
                isLatest={isLatest}
                captionLayout={captionLayout}
                showEnglish={showEnglish}
                fontSizePx={fontSizePx}
                sourceLanguage={sourceLanguage}
                onRetryTranslation={onRetryTranslation}
                onMeasureHeight={handleMeasureHeight}
              />
            );
          })}
          {range.bottomSpacerPx > 0 && (
            <div
              className="virtual-spacer"
              style={{ height: `${range.bottomSpacerPx}px`, flexShrink: 0 }}
              aria-hidden="true"
            />
          )}
        </>
      )}
    </div>
  );
};
