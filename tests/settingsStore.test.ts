import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, sanitizeSettings, SettingsStore } from '../electron/settingsStore';

describe('SettingsStore & sanitizeSettings', () => {
  it('clamps numeric settings within valid presentation ranges', () => {
    const low = sanitizeSettings({ pptRatio: 10, fontSizePx: 4, cardGapPx: -5 });
    expect(low.pptRatio).toBe(50);
    expect(low.fontSizePx).toBe(12);
    expect(low.cardGapPx).toBe(4);

    const high = sanitizeSettings({ pptRatio: 99, fontSizePx: 100, cardGapPx: 80 });
    expect(high.pptRatio).toBe(85);
    expect(high.fontSizePx).toBe(40);
    expect(high.cardGapPx).toBe(24);
  });

  it('falls back safely on invalid enum values and empty strings', () => {
    const sanitized = sanitizeSettings({
      captionLayout: 'diagonal' as never,
      liveView: 'floating' as never,
      translationEngine: 'cloud' as never,
      tiroSelector: '   ',
      tiroUrl: '   ',
      projectorDisplayId: 'bad-id' as never
    });

    expect(sanitized.captionLayout).toBe(DEFAULT_SETTINGS.captionLayout);
    expect(sanitized.liveView).toBe(DEFAULT_SETTINGS.liveView);
    expect(sanitized.translationEngine).toBe(DEFAULT_SETTINGS.translationEngine);
    expect(sanitized.tiroSelector).toBeNull();
    expect(sanitized.tiroUrl).toBe(DEFAULT_SETTINGS.tiroUrl);
    expect(sanitized.projectorDisplayId).toBeNull();
  });

  it('persists and reloads settings from disk cleanly across Windows/POSIX paths', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tiro-settings-test-'));
    const settingsFile = path.join(tmpDir, 'nested', 'settings.json');

    try {
      const store1 = new SettingsStore({ filePath: settingsFile });
      const updated = store1.update({
        tiroUrl: 'https://tiro.ooo/workspace/session-123',
        tiroSelector: '#live-transcript-feed',
        pptRatio: 74,
        fontSizePx: 24,
        captionLayout: 'stacked',
        showEnglish: false
      });

      expect(updated.tiroSelector).toBe('#live-transcript-feed');
      expect(fs.existsSync(settingsFile)).toBe(true);

      const store2 = new SettingsStore({ filePath: settingsFile });
      expect(store2.get()).toEqual(updated);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('supports isolated in-memory mode without touching disk', () => {
    const store = new SettingsStore({
      inMemory: true,
      initialOverrides: { translationEngine: 'mock', pptRatio: 75 }
    });
    expect(store.get().translationEngine).toBe('mock');
    expect(store.get().pptRatio).toBe(75);
  });
});
