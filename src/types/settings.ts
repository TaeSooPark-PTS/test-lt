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
  /** Strip PowerPoint's window title bar & resize border after arranging on Windows. */
  pptBorderless: boolean;
  /** Caption font size in pixels (12..40). */
  fontSizePx: number;
  /** Vertical gap between caption cards in pixels (4..24). */
  cardGapPx: number;
  /** Bilingual card layout: side-by-side 50:50 columns or stacked top/bottom. */
  captionLayout: CaptionLayout;
  /** Live view mode: pure caption cards or split with live Tiro web view on top. */
  liveView: LiveView;
  /** Show English (Tiro) source text alongside Korean translation. */
  showEnglish: boolean;
  /** Active translation engine ('local' offline NLLB-200 ONNX or 'mock' simulator). */
  translationEngine: TranslationEngineId;
  /** Translate in-progress (interim) sentences so long utterances do not wait for full stop. */
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
