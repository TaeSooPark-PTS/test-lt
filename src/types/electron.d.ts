import type {
  TiroBoundsRect,
  TiroDomDiagnostics,
  TiroObserverTelemetry,
  TiroRadarCandidate,
  TiroRawCaptionPayload,
  TiroSelectedElementInfo,
  TiroViewState
} from './tiro';

export interface DisplaySummary {
  id: number;
  label: string;
  width: number;
  height: number;
  x: number;
  y: number;
  isPrimary: boolean;
}

export interface WindowState {
  isFullScreen: boolean;
  currentDisplayId: number;
}

export interface RuntimeInfo {
  platform: string;
  appVersion: string;
  electronVersion: string;
  chromeVersion: string;
  nodeVersion: string;
}

export interface ElectronTiroBridge {
  getState: () => Promise<TiroViewState | null>;
  setVisible: (visible: boolean) => Promise<TiroViewState | null>;
  setBounds: (rect: TiroBoundsRect) => Promise<void>;
  navigate: (url: string) => Promise<TiroViewState | null>;
  navAction: (action: 'back' | 'forward' | 'reload') => Promise<TiroViewState | null>;
  sendCommand: (payload: {
    action: string;
    selector?: string;
    latencySampleMs?: number;
  }) => Promise<TiroViewState | null>;
  onViewState: (callback: (state: TiroViewState) => void) => () => void;
  onDiagnostics: (callback: (diag: TiroDomDiagnostics) => void) => () => void;
  onRadarCandidates: (callback: (candidates: TiroRadarCandidate[]) => void) => () => void;
  onElementPicked: (callback: (info: TiroSelectedElementInfo) => void) => () => void;
  onTelemetry: (callback: (telemetry: TiroObserverTelemetry) => void) => () => void;
  onCaption: (callback: (payload: TiroRawCaptionPayload) => void) => () => void;
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
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}
