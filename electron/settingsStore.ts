import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

export type CaptionLayout = 'columns' | 'stacked';
export type LiveView = 'cards' | 'tiro-split';
export type TranslationEngineId = 'local' | 'mock';

export interface AppSettings {
  /** Tiro URL to restore on launch (logged-in session is kept in persist:tiro). */
  tiroUrl: string;
  /** CSS selector of Tiro's English caption container (picked once, re-attached automatically). */
  tiroSelector: string | null;
  /** Display id of the projector. null = auto (first non-primary display). */
  projectorDisplayId: number | null;
  /** Percentage of projector width given to the PowerPoint slideshow (70~75 recommended). */
  pptRatio: number;
  /** Strip PowerPoint's window title bar after arranging. */
  pptBorderless: boolean;
  fontSizePx: number;
  cardGapPx: number;
  captionLayout: CaptionLayout;
  liveView: LiveView;
  /** Show English (Tiro) text next to Korean. */
  showEnglish: boolean;
  translationEngine: TranslationEngineId;
  /** Translate in-progress (interim) sentences so long utterances do not wait for the full stop. */
  translateInterim: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  tiroUrl: 'https://tiro.ooo/login',
  tiroSelector: null,
  projectorDisplayId: null,
  pptRatio: 72,
  pptBorderless: true,
  fontSizePx: 20,
  cardGapPx: 8,
  captionLayout: 'columns',
  liveView: 'cards',
  showEnglish: true,
  translationEngine: 'local',
  translateInterim: true
};

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export function sanitizeSettings(
  input: Partial<AppSettings> | null | undefined,
  base: AppSettings = DEFAULT_SETTINGS
): AppSettings {
  const safeInput = input && typeof input === 'object' ? input : {};
  const next: AppSettings = { ...base, ...safeInput };

  const rawRatio = Number(next.pptRatio);
  next.pptRatio = clamp(
    Math.round(Number.isFinite(rawRatio) ? rawRatio : DEFAULT_SETTINGS.pptRatio),
    50,
    85
  );

  const rawFont = Number(next.fontSizePx);
  next.fontSizePx = clamp(
    Math.round(Number.isFinite(rawFont) ? rawFont : DEFAULT_SETTINGS.fontSizePx),
    12,
    40
  );

  const rawGap = Number(next.cardGapPx);
  next.cardGapPx = clamp(
    Math.round(Number.isFinite(rawGap) ? rawGap : DEFAULT_SETTINGS.cardGapPx),
    4,
    24
  );

  if (next.captionLayout !== 'columns' && next.captionLayout !== 'stacked') {
    next.captionLayout = DEFAULT_SETTINGS.captionLayout;
  }
  if (next.liveView !== 'cards' && next.liveView !== 'tiro-split') {
    next.liveView = DEFAULT_SETTINGS.liveView;
  }
  if (next.translationEngine !== 'local' && next.translationEngine !== 'mock') {
    next.translationEngine = DEFAULT_SETTINGS.translationEngine;
  }
  if (typeof next.tiroSelector === 'string') {
    const trimmed = next.tiroSelector.trim();
    next.tiroSelector = trimmed ? trimmed : null;
  } else {
    next.tiroSelector = null;
  }
  if (typeof next.tiroUrl !== 'string' || !next.tiroUrl.trim()) {
    next.tiroUrl = DEFAULT_SETTINGS.tiroUrl;
  } else {
    next.tiroUrl = next.tiroUrl.trim();
  }
  if (next.projectorDisplayId !== null && typeof next.projectorDisplayId !== 'number') {
    next.projectorDisplayId = null;
  }
  next.pptBorderless = Boolean(next.pptBorderless);
  next.showEnglish = Boolean(next.showEnglish);
  next.translateInterim = Boolean(next.translateInterim);

  return next;
}

export interface SettingsStoreOptions {
  filePath?: string;
  inMemory?: boolean;
  initialOverrides?: Partial<AppSettings>;
}

export class SettingsStore {
  private readonly filePath: string | null;
  private readonly inMemory: boolean;
  private data: AppSettings;

  constructor(options: SettingsStoreOptions = {}) {
    this.inMemory = Boolean(options.inMemory);
    this.filePath = this.inMemory
      ? null
      : (options.filePath ?? path.join(app.getPath('userData'), 'settings.json'));
    const loaded = this.load();
    this.data = options.initialOverrides
      ? sanitizeSettings(options.initialOverrides, loaded)
      : loaded;
  }

  private load(): AppSettings {
    if (this.inMemory || !this.filePath) {
      return { ...DEFAULT_SETTINGS };
    }
    try {
      const raw = fs.readFileSync(this.filePath, 'utf8');
      return sanitizeSettings(JSON.parse(raw) as Partial<AppSettings>, DEFAULT_SETTINGS);
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  public get(): AppSettings {
    return { ...this.data };
  }

  public update(patch: Partial<AppSettings>): AppSettings {
    this.data = sanitizeSettings(patch, this.data);
    if (!this.inMemory && this.filePath) {
      try {
        fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
        fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf8');
      } catch (err) {
        console.error('[settings] failed to persist', err);
      }
    }
    return this.get();
  }
}
