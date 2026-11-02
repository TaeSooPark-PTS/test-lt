import { describe, expect, it } from 'vitest';
import { computeVirtualRange } from '../src/utils/virtualWindow';

describe('computeVirtualRange', () => {
  it('renders small lists (<= 40 items) directly without spacer overhead', () => {
    const res = computeVirtualRange({
      itemCount: 15,
      scrollTop: 0,
      viewportHeight: 600,
      gapPx: 8,
      getItemHeight: () => 80
    });

    expect(res.startIndex).toBe(0);
    expect(res.endIndex).toBe(14);
    expect(res.topSpacerPx).toBe(0);
    expect(res.bottomSpacerPx).toBe(0);
    expect(res.totalHeightPx).toBe(15 * 80 + 14 * 8);
  });

  it('virtualizes a 3,000-utterance conference session with exact flex-gap spacer math', () => {
    const itemCount = 3000;
    const gapPx = 8;
    const getItemHeight = (i: number) => (i % 2 === 0 ? 72 : 108);

    const mid = computeVirtualRange({
      itemCount,
      scrollTop: 95_000,
      viewportHeight: 720,
      gapPx,
      overscan: 6,
      getItemHeight
    });

    const renderedCount = mid.endIndex - mid.startIndex + 1;
    expect(renderedCount).toBeLessThanOrEqual(30);
    expect(mid.startIndex).toBeGreaterThan(800);
    expect(mid.endIndex).toBeLessThan(1200);

    // Sum of topSpacer + gap + rendered card heights & inner gaps + gap + bottomSpacer must equal totalHeightPx
    let renderedBlockHeight = 0;
    for (let i = mid.startIndex; i <= mid.endIndex; i += 1) {
      renderedBlockHeight += getItemHeight(i);
      if (i < mid.endIndex) renderedBlockHeight += gapPx;
    }

    const reconstructedTotal =
      (mid.topSpacerPx > 0 ? mid.topSpacerPx + gapPx : 0) +
      renderedBlockHeight +
      (mid.bottomSpacerPx > 0 ? gapPx + mid.bottomSpacerPx : 0);

    expect(reconstructedTotal).toBe(mid.totalHeightPx);
  });
});
