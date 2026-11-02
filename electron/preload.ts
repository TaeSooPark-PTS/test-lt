import { contextBridge, ipcRenderer } from 'electron';

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
  sendCommand: (payload: { action: string; selector?: string; latencySampleMs?: number }) =>
    ipcRenderer.invoke('tiro:command', payload),
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
  tiro: tiroAPI
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);
