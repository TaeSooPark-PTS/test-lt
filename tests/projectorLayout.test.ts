import { describe, expect, it } from 'vitest';
import { computeProjectorLayout } from '../electron/projectorLayout';

describe('computeProjectorLayout (Windows Multi-Monitor & Projector Split)', () => {
  it('splits standard 1920x1040 Windows taskbar workArea with zero pixel gap or overlap', () => {
    const workArea = { x: 0, y: 0, width: 1920, height: 1040 };
    const { ppt, sidebar } = computeProjectorLayout(workArea, 72);

    expect(ppt).toEqual({ x: 0, y: 0, width: 1382, height: 1040 });
    expect(sidebar).toEqual({ x: 1382, y: 0, width: 538, height: 1040 });
    expect(ppt.width + sidebar.width).toBe(workArea.width);
    expect(ppt.x + ppt.width).toBe(sidebar.x);
  });

  it('handles negative coordinates when projector is positioned to the left of primary monitor on Windows', () => {
    const leftProjector = { x: -1920, y: -120, width: 1920, height: 1080 };
    const { ppt, sidebar } = computeProjectorLayout(leftProjector, 75);

    expect(ppt).toEqual({ x: -1920, y: -120, width: 1440, height: 1080 });
    expect(sidebar).toEqual({ x: -480, y: -120, width: 480, height: 1080 });
    expect(ppt.x + ppt.width).toBe(sidebar.x);
    expect(ppt.width + sidebar.width).toBe(leftProjector.width);
  });

  it('clamps extreme ratios into safe [50, 85] bounds', () => {
    const area = { x: 0, y: 0, width: 1000, height: 700 };
    expect(computeProjectorLayout(area, 20).ppt.width).toBe(500);
    expect(computeProjectorLayout(area, 95).ppt.width).toBe(850);
  });
});
