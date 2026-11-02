import type { AppSettings, CaptionLayout, LiveView, TranslationEngineId } from './settings';
import type {
  TiroBoundsRect,
  TiroDomDiagnostics,
  TiroObserverTelemetry,
  TiroRadarCandidate,
  TiroRawCaptionPayload,
  TiroSelectedElementInfo,
  TiroViewState
} from './tiro';

export type { AppSettings, CaptionLayout, LiveView, TranslationEngineId };

export interface DisplaySummary {
  id: number;
  label: string;
  width: number;
  height: number;
  x: number;
  y: number;
  scaleFactor?: number;
  isPrimary: boolean;
}

export interface WindowState {
  isFullScreen: boolean;
  isMaximized: boolean;
  isAlwaysOnTop: boolean;
  isPresentationMode: boolean;
  currentDisplayId: number;
}

export interface RuntimeInfo {
  platform: string;
  appVersion: string;
  electronVersion: string;
  chromeVersion: string;
  nodeVersion: string;
  isSmokeTest?: boolean;
  isPocVerify?: boolean;
}

export type TranslatorState = 'idle' | 'downloading' | 'loading' | 'ready' | 'error';

export interface TranslatorStatus {
  state: TranslatorState;
  progress: number | null;
  message: string;
  modelId: string;
  lastLatencyMs: number | null;
  cachedOnDisk?: boolean;
}

export interface ScreenRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PptArrangeResult {
  ok: boolean;
  reason?:
    | 'unsupported-platform'
    | 'powerpoint-not-running'
    | 'no-presentation'
    | 'window-not-found'
    | 'script-error';
  message: string;
  startedSlideshow?: boolean;
  windowTitle?: string;
  windowClass?: string;
}

export interface ApplyLayoutRequest {
  displayId?: number | null;
  pptRatio?: number;
  arrangePpt?: boolean;
  startSlideshow?: boolean;
}

export interface ApplyLayoutResult {
  displayId: number;
  displayLabel: string;
  sidebar: ScreenRect;
  ppt: ScreenRect;
  pptResult: PptArrangeResult | null;
}

export type TranscriptExportFormat = 'md' | 'txt' | 'srt' | 'json';

export interface ExportFileRequest {
  format: TranscriptExportFormat;
  content: string;
  suggestedName: string;
}

export interface ExportFileResult {
  saved: boolean;
  filePath?: string;
  error?: string;
}

export interface ElectronTiroBridge {
  getState: () => Promise<TiroViewState | null>;
  setVisible: (visible: boolean) => Promise<TiroViewState | null>;
  setBounds: (rect: TiroBoundsRect) => Promise<void>;
  setZoom: (factor: number) => Promise<void>;
  navigate: (url: string) => Promise<TiroViewState | null>;
  navAction: (action: 'back' | 'forward' | 'reload') => Promise<TiroViewState | null>;
  sendCommand: (payload: {
    action: string;
    selector?: string;
    latencySampleMs?: number;
    waitForElement?: boolean;
    preserveHistory?: boolean;
  }) => Promise<TiroViewState | null>;
  onViewState: (callback: (state: TiroViewState) => void) => () => void;
  onDiagnostics: (callback: (diag: TiroDomDiagnostics) => void) => () => void;
  onRadarCandidates: (callback: (candidates: TiroRadarCandidate[]) => void) => () => void;
  onElementPicked: (callback: (info: TiroSelectedElementInfo) => void) => () => void;
  onTelemetry: (callback: (telemetry: TiroObserverTelemetry) => void) => () => void;
  onCaption: (callback: (payload: TiroRawCaptionPayload) => void) => () => void;
}

export interface ElectronSettingsBridge {
  get: () => Promise<AppSettings>;
  update: (patch: Partial<AppSettings>) => Promise<AppSettings>;
  onChanged: (callback: (settings: AppSettings) => void) => () => void;
}

export interface ElectronTranslatorBridge {
  getStatus: () => Promise<TranslatorStatus>;
  prepare: () => Promise<TranslatorStatus>;
  translate: (text: string, captionId?: string) => Promise<string>;
  cancelPending: () => Promise<void>;
  onStatus: (callback: (status: TranslatorStatus) => void) => () => void;
}

export interface ElectronLayoutBridge {
  apply: (req: ApplyLayoutRequest) => Promise<ApplyLayoutResult | null>;
  arrangePpt: (startSlideshow: boolean) => Promise<PptArrangeResult | null>;
  exit: () => Promise<void>;
}

export interface ElectronWindowControlsBridge {
  minimize: () => Promise<void>;
  toggleMaximize: () => Promise<WindowState>;
  close: () => Promise<void>;
  toggleAlwaysOnTop: () => Promise<boolean>;
}

export interface ElectronCaptionsBridge {
  exportFile: (req: ExportFileRequest) => Promise<ExportFileResult>;
}

export interface ElectronAPI {
  getRuntimeInfo: () => Promise<RuntimeInfo>;
  getWindowState: () => Promise<WindowState>;
  toggleFullScreen: () => Promise<WindowState>;
  getDisplays: () => Promise<DisplaySummary[]>;
  moveToDisplay: (displayId: number) => Promise<WindowState>;
  onWindowStateChanged: (callback: (state: WindowState) => void) => () => void;
  onDisplaysChanged: (callback: (displays: DisplaySummary[]) => void) => () => void;
  notifySmokeTestReady: (summary: string) => void;
  tiro: ElectronTiroBridge;
  settings: ElectronSettingsBridge;
  translator: ElectronTranslatorBridge;
  layout: ElectronLayoutBridge;
  win: ElectronWindowControlsBridge;
  captions: ElectronCaptionsBridge;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}
