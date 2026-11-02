import type { TiroElementFingerprint } from './tiro';
import type {
  SourceLanguageSetting,
  TargetLanguageSetting
} from '../utils/languageDetector';

export type CaptionLayout = 'columns' | 'stacked';
export type LiveView = 'cards' | 'tiro-split';
export type TranslationEngineId = 'local' | 'mock';
export type PresentationStagePref = 'auto' | 'external-ppt' | 'builtin-deck';

export type { SourceLanguageSetting, TargetLanguageSetting };

export interface AppSettings {
  /** Tiro URL to restore on launch (logged-in session is kept in persist:tiro). */
  tiroUrl: string;
  /** CSS selector of Tiro's caption container (picked once, re-attached automatically). */
  tiroSelector: string | null;
  /** Multi-anchor structural & spatial DOM fingerprint for self-healing when Tiro selectors change. */
  tiroFingerprint: TiroElementFingerprint | null;
  /** Display id of the projector. null = auto (first non-primary display). */
  projectorDisplayId: number | null;
  /** Percentage of projector width given to the slide stage / PowerPoint (70~75 recommended). */
  pptRatio: number;
  /** Strip PowerPoint's window title bar & resize border after arranging on Windows. */
  pptBorderless: boolean;
  /** Preferred projector presentation stage ('auto' | 'external-ppt' | 'builtin-deck'). */
  presentationStagePref: PresentationStagePref;
  /** Caption font size in pixels (12..40). */
  fontSizePx: number;
  /** Vertical gap between caption cards in pixels (4..24). */
  cardGapPx: number;
  /** Bilingual card layout: side-by-side 50:50 columns or stacked top/bottom. */
  captionLayout: CaptionLayout;
  /** Live view mode: pure caption cards or split with live Tiro web view on top. */
  liveView: LiveView;
  /** Show source text alongside translated text. */
  showEnglish: boolean;
  /** Active translation engine ('local' offline NLLB-200 ONNX or 'mock' simulator). */
  translationEngine: TranslationEngineId;
  /** Source speech language ('auto' detects EN/JA/ZH/ES/FR/DE/VI/KO per utterance). */
  sourceLanguage: SourceLanguageSetting;
  /** Target translation language (default 'ko'). */
  targetLanguage: TargetLanguageSetting;
  /** User-defined terminology glossary lines ("Source = Target"). */
  glossaryRaw: string;
  /** Translate in-progress (interim) sentences so long utterances do not wait for full stop. */
  translateInterim: boolean;
  /** Whether the user has acknowledged the first-run offline/online readiness guide. */
  firstRunGuideDismissed: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  tiroUrl: 'https://tiro.ooo/login',
  tiroSelector: null,
  tiroFingerprint: null,
  projectorDisplayId: null,
  pptRatio: 72,
  pptBorderless: true,
  presentationStagePref: 'auto',
  fontSizePx: 20,
  cardGapPx: 8,
  captionLayout: 'columns',
  liveView: 'cards',
  showEnglish: true,
  translationEngine: 'local',
  sourceLanguage: 'auto',
  targetLanguage: 'ko',
  glossaryRaw: '',
  translateInterim: true,
  firstRunGuideDismissed: false
};
