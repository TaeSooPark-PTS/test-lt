import { BrowserWindow, ipcMain, session, WebContentsView } from 'electron';
import * as path from 'path';

export interface TiroBoundsRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TiroViewStateSnapshot {
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

const DEFAULT_TIRO_URL = 'https://tiro.ooo/login';
const TIRO_PARTITION = 'persist:tiro';

function isTrustedMediaOrigin(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol === 'file:') return true;
    if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') return true;
    if (parsed.hostname === 'tiro.ooo' || parsed.hostname.endsWith('.tiro.ooo')) return true;
    if (parsed.hostname === 'tiro.ax' || parsed.hostname.endsWith('.tiro.ax')) return true;
    return false;
  } catch {
    return false;
  }
}

export class TiroSessionManager {
  private mainWindow: BrowserWindow;
  private view: WebContentsView | null = null;
  private bounds: TiroBoundsRect = { x: 0, y: 0, width: 0, height: 0 };
  /** Last non-empty bounds; reused while hidden so Tiro keeps a real layout size. */
  private lastRealBounds: TiroBoundsRect = { x: 0, y: 0, width: 960, height: 900 };
  private visible = false;
  private pickerActive = false;
  private radarActive = false;
  private observing = false;
  private targetSelector: string | null = null;
  /** Selector the user wants observed; re-attached automatically after reloads/navigation. */
  private desiredSelector: string | null = null;
  private lastError: string | null = null;
  private sessionConfigured = false;
  private zoomFactor = 1;
  private getInitialUrl: () => string;
  private onPersistUrl?: (url: string) => void;

  constructor(
    mainWindow: BrowserWindow,
    getInitialUrl: () => string = () => DEFAULT_TIRO_URL,
    onPersistUrl?: (url: string) => void
  ) {
    this.mainWindow = mainWindow;
    this.getInitialUrl = getInitialUrl;
    this.onPersistUrl = onPersistUrl;
  }

  private maybePersistWorkspaceUrl(rawUrl: string): void {
    if (!this.onPersistUrl || !rawUrl) return;
    try {
      const parsed = new URL(rawUrl);
      const isTiroDomain =
        parsed.protocol === 'https:' &&
        (parsed.hostname === 'tiro.ooo' ||
          parsed.hostname.endsWith('.tiro.ooo') ||
          parsed.hostname === 'tiro.ax' ||
          parsed.hostname.endsWith('.tiro.ax'));
      if (!isTiroDomain) return;
      const isAuthPath = /^\/(ko\/|en\/|ja\/)?(login|signin|auth)(\/|$)/i.test(parsed.pathname);
      if (!isAuthPath) {
        this.onPersistUrl(rawUrl);
      }
    } catch {
      // ignore invalid URLs
    }
  }

  private configureSessionOnce(): void {
    if (this.sessionConfigured) return;
    this.sessionConfigured = true;

    const tiroSession = session.fromPartition(TIRO_PARTITION);

    // Strip Electron/app tokens so standard Google / Microsoft / SSO OAuth flows succeed normally
    const cleanUA = tiroSession
      .getUserAgent()
      .replace(/\s*Electron\/[^\s]+/gi, '')
      .replace(/\s*tiro-live-bilingual-caption-workspace\/[^\s]+/gi, '');
    tiroSession.setUserAgent(cleanUA);

    const allowedPermissions = new Set([
      'media',
      'audioCapture',
      'notifications',
      'clipboard-read',
      'clipboard-sanitized-write'
    ]);

    tiroSession.setPermissionCheckHandler((webContents, permission, requestingOrigin) => {
      const originToCheck = requestingOrigin || webContents?.getURL() || '';
      if (!isTrustedMediaOrigin(originToCheck)) return false;
      return allowedPermissions.has(permission);
    });

    tiroSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
      const originToCheck = details.requestingUrl || webContents.getURL() || '';
      if (isTrustedMediaOrigin(originToCheck) && allowedPermissions.has(permission)) {
        callback(true);
      } else {
        callback(false);
      }
    });
  }

  public ensureView(initialUrl?: string): WebContentsView {
    if (this.view && !this.view.webContents.isDestroyed()) {
      return this.view;
    }

    this.configureSessionOnce();

    const view = new WebContentsView({
      webPreferences: {
        partition: TIRO_PARTITION,
        preload: path.join(__dirname, 'tiroPreload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
        spellcheck: false
      }
    });

    this.view = view;
    this.mainWindow.contentView.addChildView(view);
    view.setVisible(this.visible);
    this.applyBounds();

    const wc = view.webContents;

    // Allow SSO / OAuth popups in a child BrowserWindow sharing persist:tiro session
    wc.setWindowOpenHandler(({ url }) => {
      if (url.startsWith('https://') || url.startsWith('http://localhost')) {
        return {
          action: 'allow',
          overrideBrowserWindowOptions: {
            parent: this.mainWindow,
            width: 540,
            height: 700,
            autoHideMenuBar: true,
            webPreferences: {
              partition: TIRO_PARTITION,
              contextIsolation: true,
              nodeIntegration: false,
              sandbox: true
            }
          }
        };
      }
      return { action: 'deny' };
    });

    const emitState = () => this.broadcastViewState();
    wc.on('did-start-loading', emitState);
    wc.on('did-stop-loading', emitState);
    wc.on('did-navigate', (_event, url) => {
      this.pickerActive = false;
      this.radarActive = false;
      this.observing = false;
      this.lastError = null;
      this.maybePersistWorkspaceUrl(url);
      emitState();
    });
    wc.on('did-navigate-in-page', (_event, url) => {
      this.maybePersistWorkspaceUrl(url);
      emitState();
      this.scheduleReattach(800);
    });
    wc.on('did-finish-load', () => {
      if (this.zoomFactor !== 1) wc.setZoomFactor(this.zoomFactor);
      this.scheduleReattach(600);
    });
    wc.on('page-title-updated', emitState);
    wc.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (isMainFrame && errorCode !== -3) {
        this.lastError = `로드 실패 (${errorCode}): ${errorDescription} [${validatedURL}]`;
        emitState();
      }
    });
    wc.on('render-process-gone', (_event, details) => {
      if (this.isShuttingDown) return;
      this.lastError = `Tiro 화면이 종료되었습니다 (${details.reason}). 자동으로 다시 불러옵니다.`;
      this.observing = false;
      emitState();
      setTimeout(() => {
        if (!this.isShuttingDown && !wc.isDestroyed()) wc.reload();
      }, 1500);
    });

    const targetUrl = initialUrl || this.getInitialUrl() || DEFAULT_TIRO_URL;
    void wc.loadURL(targetUrl);

    return view;
  }

  private reattachTimer: ReturnType<typeof setTimeout> | null = null;
  private isShuttingDown = false;

  /** Re-sends the observer command for the saved selector (preload waits until the element exists). */
  private scheduleReattach(delayMs: number): void {
    if (this.isShuttingDown || !this.desiredSelector) return;
    if (this.reattachTimer) clearTimeout(this.reattachTimer);
    this.reattachTimer = setTimeout(() => {
      this.reattachTimer = null;
      if (!this.desiredSelector || !this.view || this.view.webContents.isDestroyed()) return;
      this.view.webContents.send('tiro-preload:command', {
        action: 'start-observer',
        selector: this.desiredSelector,
        waitForElement: true,
        preserveHistory: true
      });
    }, delayMs);
  }

  public setZoom(factor: number): void {
    this.zoomFactor = Math.min(1.5, Math.max(0.4, factor));
    if (this.view && !this.view.webContents.isDestroyed()) {
      this.view.webContents.setZoomFactor(this.zoomFactor);
    }
  }

  public setDesiredSelector(selector: string | null): void {
    this.desiredSelector = selector ? selector.trim() : null;
    if (this.desiredSelector) {
      this.scheduleReattach(300);
    }
  }

  public getState(): TiroViewStateSnapshot {
    const wc = this.view && !this.view.webContents.isDestroyed() ? this.view.webContents : null;
    return {
      visible: this.visible,
      url: wc ? wc.getURL() || DEFAULT_TIRO_URL : DEFAULT_TIRO_URL,
      title: wc ? wc.getTitle() || '' : '',
      isLoading: wc ? wc.isLoading() : false,
      canGoBack: wc ? wc.navigationHistory.canGoBack() : false,
      canGoForward: wc ? wc.navigationHistory.canGoForward() : false,
      pickerActive: this.pickerActive,
      radarActive: this.radarActive,
      observing: this.observing,
      targetSelector: this.targetSelector,
      lastError: this.lastError
    };
  }

  public setVisible(visible: boolean): TiroViewStateSnapshot {
    this.visible = visible;
    if (visible) {
      this.ensureView();
    }
    if (this.view && !this.view.webContents.isDestroyed()) {
      this.view.setVisible(visible);
      this.applyBounds();
    }
    this.broadcastViewState();
    return this.getState();
  }

  public setBounds(rect: TiroBoundsRect): void {
    this.bounds = {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.max(0, Math.round(rect.width)),
      height: Math.max(0, Math.round(rect.height))
    };
    if (this.bounds.width > 0 && this.bounds.height > 0) {
      this.lastRealBounds = { ...this.bounds };
    }
    this.applyBounds();
  }

  private applyBounds(): void {
    if (!this.view || this.view.webContents.isDestroyed()) return;
    if (!this.visible || this.bounds.width <= 0 || this.bounds.height <= 0) {
      // Keep a real layout size while hidden: virtualized transcript lists may stop rendering at 0×0.
      this.view.setVisible(false);
      this.view.setBounds(this.lastRealBounds);
      return;
    }
    this.view.setVisible(true);
    this.view.setBounds(this.bounds);
  }

  public async navigate(url: string): Promise<TiroViewStateSnapshot> {
    const trimmed = url.trim();
    const normalized =
      trimmed.startsWith('http://') ||
      trimmed.startsWith('https://') ||
      trimmed.startsWith('file://')
        ? trimmed
        : `https://${trimmed}`;

    const view = this.ensureView(normalized);
    this.lastError = null;
    if (view.webContents.getURL() !== normalized) {
      await view.webContents.loadURL(normalized);
    }
    this.broadcastViewState();
    return this.getState();
  }

  public goBack(): void {
    if (this.view && this.view.webContents.navigationHistory.canGoBack()) {
      this.view.webContents.navigationHistory.goBack();
    }
  }

  public goForward(): void {
    if (this.view && this.view.webContents.navigationHistory.canGoForward()) {
      this.view.webContents.navigationHistory.goForward();
    }
  }

  public reload(): void {
    this.view?.webContents.reload();
  }

  public sendPreloadCommand(payload: {
    action: string;
    selector?: string;
    latencySampleMs?: number;
  }): TiroViewStateSnapshot {
    const view = this.ensureView();
    let outbound: Record<string, unknown> = { ...payload };
    if (payload.action === 'start-picker') {
      this.pickerActive = true;
    } else if (payload.action === 'stop-picker') {
      this.pickerActive = false;
    } else if (payload.action === 'start-radar') {
      this.radarActive = true;
    } else if (payload.action === 'stop-radar') {
      this.radarActive = false;
    } else if (payload.action === 'start-observer' && payload.selector) {
      this.observing = true;
      this.targetSelector = payload.selector;
      this.desiredSelector = payload.selector;
      outbound = { ...outbound, waitForElement: true };
    } else if (payload.action === 'stop-observer') {
      this.observing = false;
      this.desiredSelector = null;
    }

    view.webContents.send('tiro-preload:command', outbound);
    this.broadcastViewState();
    return this.getState();
  }

  public async checkCapturePageSupport(): Promise<boolean> {
    if (!this.view || this.view.webContents.isDestroyed()) return false;
    try {
      const image = await this.view.webContents.capturePage({ x: 0, y: 0, width: 32, height: 32 });
      return !image.isEmpty() || image.getSize().width >= 0;
    } catch {
      return false;
    }
  }

  public isSenderTiroView(sender: Electron.WebContents): boolean {
    return Boolean(this.view && !this.view.webContents.isDestroyed() && sender === this.view.webContents);
  }

  public handlePreloadPickerFinished(): void {
    this.pickerActive = false;
    this.broadcastViewState();
  }

  public handlePreloadTelemetry(observing: boolean, selector: string | null, err?: string): void {
    this.observing = observing;
    if (selector) {
      this.targetSelector = selector;
    }
    if (err) {
      this.lastError = err;
    }
    this.broadcastViewState();
  }

  private broadcastViewState(): void {
    if (this.mainWindow.isDestroyed()) return;
    this.mainWindow.webContents.send('tiro:view-state', this.getState());
  }

  public destroy(): void {
    void this.destroyAsync();
  }

  public async destroyAsync(): Promise<void> {
    this.isShuttingDown = true;
    if (this.reattachTimer) {
      clearTimeout(this.reattachTimer);
      this.reattachTimer = null;
    }

    const view = this.view;
    this.view = null;
    if (!view) return;

    if (!this.mainWindow.isDestroyed()) {
      try {
        this.mainWindow.contentView.removeChildView(view);
      } catch {
        // ignore if already detached
      }
    }

    const wc = view.webContents;
    if (!wc.isDestroyed()) {
      wc.removeAllListeners();
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          try {
            if (!wc.isDestroyed()) {
              wc.forcefullyCrashRenderer();
            }
          } catch {
            // ignore
          }
          resolve();
        }, 400);

        wc.once('destroyed', () => {
          clearTimeout(timer);
          resolve();
        });

        try {
          wc.close({ waitForBeforeUnload: false });
        } catch {
          clearTimeout(timer);
          resolve();
        }
      });
    }
  }
}

export function registerTiroIpcHandlers(
  getManager: () => TiroSessionManager | null,
  getMainWindow: () => BrowserWindow | null
): void {
  ipcMain.handle('tiro:get-state', () => getManager()?.getState() ?? null);

  ipcMain.handle('tiro:set-visible', (_event, visible: boolean) =>
    getManager()?.setVisible(visible) ?? null
  );

  ipcMain.handle('tiro:set-bounds', (_event, rect: TiroBoundsRect) => {
    getManager()?.setBounds(rect);
  });

  ipcMain.handle('tiro:set-zoom', (_event, factor: number) => {
    getManager()?.setZoom(Number(factor) || 1);
  });

  ipcMain.handle('tiro:navigate', async (_event, url: string) => {
    const mgr = getManager();
    if (!mgr) return null;
    return mgr.navigate(url);
  });

  ipcMain.handle('tiro:nav-action', (_event, action: 'back' | 'forward' | 'reload') => {
    const mgr = getManager();
    if (!mgr) return null;
    if (action === 'back') mgr.goBack();
    else if (action === 'forward') mgr.goForward();
    else if (action === 'reload') mgr.reload();
    return mgr.getState();
  });

  ipcMain.handle(
    'tiro:command',
    (_event, payload: { action: string; selector?: string; latencySampleMs?: number }) => {
      const mgr = getManager();
      if (!mgr) return null;
      return mgr.sendPreloadCommand(payload);
    }
  );

  // Relay messages strictly originating from the isolated Tiro WebContentsView preload
  ipcMain.on('tiro-preload:diagnostics', async (event, diag) => {
    const mgr = getManager();
    const win = getMainWindow();
    if (!mgr || !win || win.isDestroyed() || !mgr.isSenderTiroView(event.sender)) return;
    const capturePageSupported = await mgr.checkCapturePageSupport();
    win.webContents.send('tiro:diagnostics', {
      ...diag,
      capturePageSupported
    });
  });

  ipcMain.on('tiro-preload:radar-candidates', (event, candidates) => {
    const mgr = getManager();
    const win = getMainWindow();
    if (!mgr || !win || win.isDestroyed() || !mgr.isSenderTiroView(event.sender)) return;
    win.webContents.send('tiro:radar-candidates', candidates);
  });

  ipcMain.on('tiro-preload:element-picked', (event, info) => {
    const mgr = getManager();
    const win = getMainWindow();
    if (!mgr || !win || win.isDestroyed() || !mgr.isSenderTiroView(event.sender)) return;
    mgr.handlePreloadPickerFinished();
    win.webContents.send('tiro:element-picked', info);
  });

  ipcMain.on('tiro-preload:picker-cancelled', (event) => {
    const mgr = getManager();
    const win = getMainWindow();
    if (!mgr || !win || win.isDestroyed() || !mgr.isSenderTiroView(event.sender)) return;
    mgr.handlePreloadPickerFinished();
  });

  ipcMain.on('tiro-preload:telemetry', (event, telemetry) => {
    const mgr = getManager();
    const win = getMainWindow();
    if (!mgr || !win || win.isDestroyed() || !mgr.isSenderTiroView(event.sender)) return;
    mgr.handlePreloadTelemetry(telemetry.observing, telemetry.targetSelector, telemetry.errorMessage);
    win.webContents.send('tiro:telemetry', telemetry);
  });

  ipcMain.on('tiro-preload:caption', (event, payload) => {
    const mgr = getManager();
    const win = getMainWindow();
    if (!mgr || !win || win.isDestroyed() || !mgr.isSenderTiroView(event.sender)) return;
    win.webContents.send('tiro:caption', payload);
  });
}
