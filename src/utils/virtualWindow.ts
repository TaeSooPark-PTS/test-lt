export interface VirtualRangeParams {
  itemCount: number;
  scrollTop: number;
  viewportHeight: number;
  gapPx: number;
  getItemHeight: (index: number) => number;
  overscan?: number;
}

export interface VirtualRangeResult {
  startIndex: number;
  endIndex: number;
  topSpacerPx: number;
  bottomSpacerPx: number;
  totalHeightPx: number;
}

/**
 * Computes the visible [startIndex, endIndex] window and exact top/bottom spacer heights
 * for variable-height caption cards separated by `gapPx`.
 *
 * When itemCount is small (<= 40), renders all items directly with zero spacer overhead;
 * for long 1~3 hour sessions (hundreds or thousands of utterances), keeps DOM node count
 * bounded to ~25-35 cards for constant-time React rendering and smooth 60fps auto-scroll.
 */
export function computeVirtualRange({
  itemCount,
  scrollTop,
  viewportHeight,
  gapPx,
  getItemHeight,
  overscan = 8
}: VirtualRangeParams): VirtualRangeResult {
  if (itemCount <= 0) {
    return {
      startIndex: 0,
      endIndex: -1,
      topSpacerPx: 0,
      bottomSpacerPx: 0,
      totalHeightPx: 0
    };
  }

  const heights = new Array<number>(itemCount);
  const tops = new Array<number>(itemCount);
  let cursor = 0;

  for (let i = 0; i < itemCount; i += 1) {
    tops[i] = cursor;
    const h = Math.max(24, Math.round(getItemHeight(i)));
    heights[i] = h;
    cursor += h + (i < itemCount - 1 ? gapPx : 0);
  }
  const totalHeightPx = cursor;

  if (itemCount <= 40 || viewportHeight <= 0) {
    return {
      startIndex: 0,
      endIndex: itemCount - 1,
      topSpacerPx: 0,
      bottomSpacerPx: 0,
      totalHeightPx
    };
  }

  const clampedScrollTop = Math.max(0, Math.min(scrollTop, Math.max(0, totalHeightPx - viewportHeight)));
  const viewBottom = clampedScrollTop + viewportHeight;

  // Binary search first item whose bottom edge (tops[i] + heights[i]) >= clampedScrollTop
  let lo = 0;
  let hi = itemCount - 1;
  let firstVisible = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    if (tops[mid] + heights[mid] < clampedScrollTop) {
      lo = mid + 1;
    } else {
      firstVisible = mid;
      hi = mid - 1;
    }
  }

  let lastVisible = firstVisible;
  while (lastVisible + 1 < itemCount && tops[lastVisible + 1] <= viewBottom) {
    lastVisible += 1;
  }

  const startIndex = Math.max(0, firstVisible - overscan);
  const endIndex = Math.min(itemCount - 1, lastVisible + overscan);

  // In a flex-column container with `gap: gapPx`, a rendered top spacer element participates in
  // one flex gap (`gapPx`) between itself and `startIndex`. Subtract one `gapPx` so card positions
  // remain pixel-exact!
  const rawTopHeight = startIndex > 0 ? tops[startIndex] : 0;
  const topSpacerPx = startIndex > 0 ? Math.max(0, rawTopHeight - gapPx) : 0;

  const lastRenderedBottom = tops[endIndex] + heights[endIndex];
  const remainingHeight = totalHeightPx - lastRenderedBottom;
  const bottomSpacerPx =
    endIndex < itemCount - 1 ? Math.max(0, remainingHeight - gapPx) : 0;

  return {
    startIndex,
    endIndex,
    topSpacerPx,
    bottomSpacerPx,
    totalHeightPx
  };
}
