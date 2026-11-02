export interface TiroDomDiagnostics {
  timestamp: number;
  url: string;
  title: string;
  isAllowedHost: boolean;
  isLoginOrAuthPage: boolean;
  domAccessible: boolean;
  totalElements: number;
  textBearingElements: number;
  canvasCount: number;
  iframeUrls: string[];
  openShadowRootCount: number;
  ariaLiveDescriptors: string[];
  capturePageSupported?: boolean;
  notes: string[];
}

export interface TiroRadarCandidate {
  selector: string;
  tagSummary: string;
  mutationCount: number;
  childBlockCount: number;
  sampleText: string;
  lastUpdatedAt: number;
}

export interface TiroSelectedElementInfo {
  selector: string;
  parentSelector: string | null;
  tagSummary: string;
  childElementCount: number;
  sampleText: string;
}

export interface TiroObserverTelemetry {
  observing: boolean;
  targetSelector: string | null;
  mode: 'idle' | 'container-blocks' | 'single-node';
  emittedCount: number;
  interimCount: number;
  finalCount: number;
  dedupedCount: number;
  lastLatencyMs: number | null;
  avgLatencyMs: number | null;
  lastSampleText: string;
  errorMessage?: string;
}

export interface TiroRawCaptionPayload {
  id: string;
  text: string;
  isFinal: boolean;
  mutationAt: number;
  preloadEmitAt: number;
}

export interface TiroViewState {
  visible: boolean;
  url: string;
  title: string;
  isLoading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  pickerActive: boolean;
  radarActive: boolean;
  observing: boolean;
  targetSelector: string | null;
  lastError: string | null;
}

export interface TiroBoundsRect {
  x: number;
  y: number;
  width: number;
  height: number;
}
