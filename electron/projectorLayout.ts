import type { ScreenRect } from './pptArranger';

export function computeProjectorLayout(
  workArea: ScreenRect,
  pptRatio: number
): { ppt: ScreenRect; sidebar: ScreenRect } {
  const safeRatio = Math.min(85, Math.max(50, Math.round(pptRatio)));
  const pptWidth = Math.round((workArea.width * safeRatio) / 100);
  return {
    ppt: {
      x: workArea.x,
      y: workArea.y,
      width: pptWidth,
      height: workArea.height
    },
    sidebar: {
      x: workArea.x + pptWidth,
      y: workArea.y,
      width: workArea.width - pptWidth,
      height: workArea.height
    }
  };
}
