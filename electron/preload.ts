import { contextBridge, ipcRenderer } from 'electron';

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

export interface TiroBoundsRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const tiroAPI = {
  getState: () => ipcRenderer.invoke('tiro:get-state'),
  setVisible: (visible: boolean) => ipcRenderer.invoke('tiro:set-visible', visible),
  setBounds: (rect: TiroBoundsRect) => ipcRenderer.invoke('tiro:set-bounds', rect),
  navigate: (url: string) => ipcRenderer.invoke('tiro:navigate', url),
  navAction: (action: 'back' | 'forward' | 'reload') =>
    ipcRenderer.invoke('tiro:nav-action', action),
  sendCommand: (payload: {
    action: string;
    selector?: string;
    latencySampleMs?: number;
    waitForElement?: boolean;
    preserveHistory?: boolean;
  }) => ipcRenderer.invoke('tiro:command', payload),
  setZoom: (factor: number) => ipcRenderer.invoke('tiro:set-zoom', factor),
  onViewState: (callback: (state: unknown) => void): (() => void) => {
    const listener = (_ev: Electron.IpcRendererEvent, state: unknown) => callback(state);
    ipcRenderer.on('tiro:view-state', listener);
    return () => ipcRenderer.removeListener('tiro:view-state', listener);
  },
  onDiagnostics: (callback: (diag: unknown) => void): (() => void) => {
    const listener = (_ev: Electron.IpcRendererEvent, diag: unknown) => callback(diag);
    ipcRenderer.on('tiro:diagnostics', listener);
    return () => ipcRenderer.removeListener('tiro:diagnostics', listener);
  },
  onRadarCandidates: (callback: (candidates: unknown) => void): (() => void) => {
    const listener = (_ev: Electron.IpcRendererEvent, candidates: unknown) => callback(candidates);
    ipcRenderer.on('tiro:radar-candidates', listener);
    return () => ipcRenderer.removeListener('tiro:radar-candidates', listener);
  },
  onElementPicked: (callback: (info: unknown) => void): (() => void) => {
    const listener = (_ev: Electron.IpcRendererEvent, info: unknown) => callback(info);
    ipcRenderer.on('tiro:element-picked', listener);
    return () => ipcRenderer.removeListener('tiro:element-picked', listener);
  },
  onTelemetry: (callback: (telemetry: unknown) => void): (() => void) => {
    const listener = (_ev: Electron.IpcRendererEvent, telemetry: unknown) => callback(telemetry);
    ipcRenderer.on('tiro:telemetry', listener);
    return () => ipcRenderer.removeListener('tiro:telemetry', listener);
  },
  onCaption: (callback: (payload: unknown) => void): (() => void) => {
    const listener = (_ev: Electron.IpcRendererEvent, payload: unknown) => callback(payload);
    ipcRenderer.on('tiro:caption', listener);
    return () => ipcRenderer.removeListener('tiro:caption', listener);
  }
};

const settingsAPI = {
  get: () => ipcRenderer.invoke('settings:get'),
  update: (patch: unknown) => ipcRenderer.invoke('settings:update', patch),
  onChanged: (callback: (settings: unknown) => void): (() => void) => {
    const listener = (_ev: Electron.IpcRendererEvent, s: unknown) => callback(s);
    ipcRenderer.on('settings:changed', listener);
    return () => ipcRenderer.removeListener('settings:changed', listener);
  }
};

const translatorAPI = {
  getStatus: () => ipcRenderer.invoke('translator:get-status'),
  prepare: () => ipcRenderer.invoke('translator:prepare'),
  translate: (text: string, captionId?: string) =>
    ipcRenderer.invoke('translator:translate', text, captionId),
  cancelPending: () => ipcRenderer.invoke('translator:cancel-pending'),
  onStatus: (callback: (status: unknown) => void): (() => void) => {
    const listener = (_ev: Electron.IpcRendererEvent, s: unknown) => callback(s);
    ipcRenderer.on('translator:status', listener);
    return () => ipcRenderer.removeListener('translator:status', listener);
  }
};

const layoutAPI = {
  apply: (req: unknown) => ipcRenderer.invoke('layout:apply', req),
  arrangePpt: (startSlideshow: boolean) => ipcRenderer.invoke('layout:arrange-ppt', startSlideshow),
  exit: () => ipcRenderer.invoke('layout:exit')
};

const windowControlsAPI = {
  minimize: () => ipcRenderer.invoke('window:minimize'),
  toggleMaximize: () => ipcRenderer.invoke('window:toggle-maximize'),
  close: () => ipcRenderer.invoke('window:close'),
  toggleAlwaysOnTop: () => ipcRenderer.invoke('window:toggle-always-on-top')
};

const captionsAPI = {
  exportFile: (req: { format: string; content: string; suggestedName: string }) =>
    ipcRenderer.invoke('captions:export-file', req)
};

const electronAPI = {
  getRuntimeInfo: (): Promise<RuntimeInfo> => ipcRenderer.invoke('app:get-runtime-info'),
  getWindowState: (): Promise<WindowState> => ipcRenderer.invoke('window:get-state'),
  toggleFullScreen: (): Promise<WindowState> => ipcRenderer.invoke('window:toggle-fullscreen'),
  getDisplays: (): Promise<DisplaySummary[]> => ipcRenderer.invoke('window:get-displays'),
  moveToDisplay: (displayId: number): Promise<WindowState> =>
    ipcRenderer.invoke('window:move-to-display', displayId),
  onWindowStateChanged: (callback: (state: WindowState) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: WindowState) => callback(state);
    ipcRenderer.on('window:state-changed', listener);
    return () => ipcRenderer.removeListener('window:state-changed', listener);
  },
  onDisplaysChanged: (callback: (displays: DisplaySummary[]) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, displays: DisplaySummary[]) =>
      callback(displays);
    ipcRenderer.on('window:displays-changed', listener);
    return () => ipcRenderer.removeListener('window:displays-changed', listener);
  },
  notifySmokeTestReady: (summary: string): void => {
    ipcRenderer.send('smoke-test:ready', summary);
  },
  tiro: tiroAPI,
  settings: settingsAPI,
  translator: translatorAPI,
  layout: layoutAPI,
  win: windowControlsAPI,
  captions: captionsAPI
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);
