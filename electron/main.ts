import { app, BrowserWindow, dialog, ipcMain, screen, type Display } from 'electron';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { arrangePowerPoint, type PptArrangeResult, type ScreenRect } from './pptArranger';
import { computeProjectorLayout } from './projectorLayout';
import { SettingsStore, type AppSettings } from './settingsStore';
import { registerTiroIpcHandlers, TiroSessionManager } from './tiroSessionManager';
import { LocalTranslationService } from './translationService';

if (process.platform === 'win32') {
  app.setAppUserModelId('com.tiro.bilingual.workspace');
}

let mainWindow: BrowserWindow | null = null;
let tiroManager: TiroSessionManager | null = null;
let settingsStore: SettingsStore | null = null;
let translator: LocalTranslationService | null = null;
let isPresentationMode = false;
let isExiting = false;

const isSmokeTest = process.argv.includes('--smoke-test');
const isPocVerify = process.argv.includes('--poc-verify');
const isCiMode = process.argv.includes('--ci') || process.env.CI === 'true';
const isHeadlessVerify = isSmokeTest || isPocVerify;

async function shutdownAndExit(exitCode: number): Promise<void> {
  if (isExiting) return;
  isExiting = true;

  // Hard OS-level exit failsafe so headless Windows runs can never hang during teardown
  setTimeout(() => {
    process.exit(exitCode);
  }, 1500).unref();

  try {
    translator?.destroy();
    translator = null;
  } catch {
    // ignore
  }

  try {
    await tiroManager?.destroyAsync();
    tiroManager = null;
  } catch {
    // ignore
  }

  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.destroy();
    }
    mainWindow = null;
  } catch {
    // ignore
  }

  app.exit(exitCode);
}

if (isHeadlessVerify) {
  app.disableHardwareAcceleration();
  setTimeout(() => {
    console.error('[VERIFY_TIMEOUT] Headless Electron verification timed out after 30s');
    void shutdownAndExit(1);
  }, 30000).unref();
}

const SETUP_WINDOW_SIZE = { width: 1440, height: 900 };

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

function getDisplaySummaries(): DisplaySummary[] {
  const primaryId = screen.getPrimaryDisplay().id;
  return screen.getAllDisplays().map((display, index) => ({
    id: display.id,
    label: display.label || `Display ${index + 1}`,
    width: display.bounds.width,
    height: display.bounds.height,
    x: display.bounds.x,
    y: display.bounds.y,
    scaleFactor: display.scaleFactor,
    isPrimary: display.id === primaryId
  }));
}

function getWindowState() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return {
      isFullScreen: false,
      isMaximized: false,
      isAlwaysOnTop: false,
      isPresentationMode,
      currentDisplayId: screen.getPrimaryDisplay().id
    };
  }
  const currentDisplay = screen.getDisplayMatching(mainWindow.getBounds());
  return {
    isFullScreen: mainWindow.isFullScreen(),
    isMaximized: mainWindow.isMaximized(),
    isAlwaysOnTop: mainWindow.isAlwaysOnTop(),
    isPresentationMode,
    currentDisplayId: currentDisplay.id
  };
}

function broadcastWindowState(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('window:state-changed', getWindowState());
}

function broadcastDisplaysChanged(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('window:displays-changed', getDisplaySummaries());
}

function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    width: SETUP_WINDOW_SIZE.width,
    height: SETUP_WINDOW_SIZE.height,
    minWidth: 320,
    minHeight: 420,
    frame: false,
    thickFrame: true,
    backgroundColor: '#070a12',
    autoHideMenuBar: true,
    show: !isHeadlessVerify,
    title: 'Tiro Live Bilingual Caption Workspace',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  });

  mainWindow.setMenuBarVisibility(false);
  tiroManager = new TiroSessionManager(
    mainWindow,
    () => settingsStore?.get().tiroUrl ?? '',
    (persistedUrl) => {
      if (!settingsStore) return;
      const next = settingsStore.update({ tiroUrl: persistedUrl });
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('settings:changed', next);
      }
    }
  );
  const initialSelector = settingsStore?.get().tiroSelector;
  if (initialSelector) {
    tiroManager.setDesiredSelector(initialSelector);
  }

  mainWindow.on('enter-full-screen', broadcastWindowState);
  mainWindow.on('leave-full-screen', broadcastWindowState);
  mainWindow.on('maximize', broadcastWindowState);
  mainWindow.on('unmaximize', broadcastWindowState);
  mainWindow.on('always-on-top-changed', broadcastWindowState);
  mainWindow.on('moved', broadcastWindowState);
  mainWindow.on('resized', broadcastWindowState);

  // Detach WebContentsView BEFORE BrowserWindow itself is destroyed (prevents Windows shutdown hang)
  mainWindow.on('close', () => {
    tiroManager?.destroy();
  });

  mainWindow.on('closed', () => {
    tiroManager?.destroy();
    tiroManager = null;
    mainWindow = null;
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    void mainWindow.loadURL(devServerUrl);
  } else {
    void mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  if (isHeadlessVerify) {
    mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
      console.error(`[VERIFY_FAIL] did-fail-load: ${errorCode} ${errorDescription}`);
      void shutdownAndExit(1);
    });
  }

  if (isPocVerify) {
    mainWindow.webContents.once('did-finish-load', () => {
      void runAutomatedPocVerification();
    });
  }
}

async function runAutomatedPocVerification(): Promise<void> {
  if (!tiroManager || !mainWindow) return;

  try {
    // Prepare a cross-platform local DOM harness (works offline & on Windows C:\ paths via pathToFileURL)
    const tmpHtmlPath = path.join(os.tmpdir(), `tiro-stt-harness-${Date.now()}.html`);
    fs.writeFileSync(
      tmpHtmlPath,
      `<!doctype html>
      <html>
        <head><meta charset="utf-8" /><title>Tiro Harness</title></head>
        <body>
          <div id="live-transcript-feed" aria-live="polite"></div>
        </body>
      </html>`,
      'utf8'
    );
    const harnessFileUrl = pathToFileURL(tmpHtmlPath).href;

    // 1. Verify isolated Preload DOM Diagnostics (try real https://tiro.ooo/login first; fallback to local harness in restricted CI networks)
    tiroManager.setVisible(true);
    tiroManager.setBounds({ x: 0, y: 44, width: 1100, height: 800 });

    let realTiroDiag: Record<string, unknown> | null = null;
    if (!isCiMode) {
      try {
        const diagPromise = new Promise<Record<string, unknown>>((resolve) => {
          ipcMain.once('tiro-preload:diagnostics', (_ev, diag) => resolve(diag));
        });
        await tiroManager.navigate('https://tiro.ooo/login');
        await new Promise((r) => setTimeout(r, 2000));
        tiroManager.sendPreloadCommand({ action: 'diagnostics' });
        realTiroDiag = await Promise.race([
          diagPromise,
          new Promise<Record<string, unknown>>((_, reject) =>
            setTimeout(() => reject(new Error('Timeout waiting for tiro.ooo diagnostics')), 6000)
          )
        ]);
      } catch (netErr) {
        console.warn('[POC_VERIFY_NOTE] Remote tiro.ooo unreachable, verifying diagnostics on local harness:', netErr);
      }
    }

    if (!realTiroDiag) {
      const localDiagPromise = new Promise<Record<string, unknown>>((resolve) => {
        ipcMain.once('tiro-preload:diagnostics', (_ev, diag) => resolve(diag));
      });
      await tiroManager.navigate(harnessFileUrl);
      await new Promise((r) => setTimeout(r, 300));
      tiroManager.sendPreloadCommand({ action: 'diagnostics' });
      realTiroDiag = await Promise.race([
        localDiagPromise,
        new Promise<Record<string, unknown>>((_, reject) =>
          setTimeout(() => reject(new Error('Timeout waiting for local harness diagnostics')), 5000)
        )
      ]);
    }

    const captureSupported = await tiroManager.checkCapturePageSupport();

    console.log(
      '[POC_VERIFY_REAL_TIRO]',
      JSON.stringify({
        url: realTiroDiag.url,
        domAccessible: realTiroDiag.domAccessible,
        isLoginOrAuthPage: realTiroDiag.isLoginOrAuthPage,
        totalElements: realTiroDiag.totalElements,
        canvasCount: realTiroDiag.canvasCount,
        iframeUrls: realTiroDiag.iframeUrls,
        capturePageSupported: captureSupported
      })
    );

    // 2. Verify end-to-end MutationObserver -> Preload -> IPC -> TiroCaptionProvider -> Renderer Translation pipeline
    const receivedCaptions: Array<{
      id: string;
      text: string;
      isFinal: boolean;
      latencyMs: number;
    }> = [];
    let latestTelemetry: Record<string, unknown> = {};

    const captionListener = (
      _ev: Electron.IpcMainEvent,
      payload: { id: string; text: string; isFinal: boolean; mutationAt: number }
    ) => {
      const latencyMs = Date.now() - payload.mutationAt;
      receivedCaptions.push({
        id: payload.id,
        text: payload.text,
        isFinal: payload.isFinal,
        latencyMs
      });
      tiroManager?.sendPreloadCommand({
        action: 'record-latency',
        latencySampleMs: latencyMs
      });
    };
    const telemetryListener = (_ev: Electron.IpcMainEvent, tel: Record<string, unknown>) => {
      latestTelemetry = tel;
    };

    ipcMain.on('tiro-preload:caption', captionListener);
    ipcMain.on('tiro-preload:telemetry', telemetryListener);

    await tiroManager.navigate(harnessFileUrl);
    await new Promise((r) => setTimeout(r, 350));

    // Activate TiroCaptionProvider in Renderer UI as well
    await mainWindow.webContents.executeJavaScript(
      `document.querySelector('[data-testid="switch-provider-tiro"]')?.click();`
    );
    await new Promise((r) => setTimeout(r, 150));

    tiroManager.sendPreloadCommand({
      action: 'start-observer',
      selector: '#live-transcript-feed'
    });
    await new Promise((r) => setTimeout(r, 150));

    const view = tiroManager.ensureView();

    // Utterance 1: progressive word updates (must keep same caption ID!)
    await view.webContents.executeJavaScript(`
      (() => {
        const feed = document.getElementById('live-transcript-feed');
        const p1 = document.createElement('p');
        p1.id = 'u1';
        p1.textContent = 'AI is changing';
        feed.appendChild(p1);
      })()
    `);
    await new Promise((r) => setTimeout(r, 120));

    await view.webContents.executeJavaScript(`
      document.getElementById('u1').textContent = 'AI is changing the way we work.';
    `);
    await new Promise((r) => setTimeout(r, 120));

    // Trigger real DOM re-render (replacing inner node with identical text — must be deduplicated!)
    await view.webContents.executeJavaScript(`
      (() => {
        const u1 = document.getElementById('u1');
        u1.innerHTML = '<span>AI is changing the way we work.</span>';
      })()
    `);
    await new Promise((r) => setTimeout(r, 120));

    // Utterance 2: new sibling paragraph (must finalize u1 and create a distinct ID for u2!)
    await view.webContents.executeJavaScript(`
      (() => {
        const feed = document.getElementById('live-transcript-feed');
        const p2 = document.createElement('p');
        p2.id = 'u2';
        p2.textContent = 'It helps us make better decisions.';
        feed.appendChild(p2);
      })()
    `);
    await new Promise((r) => setTimeout(r, 150));

    // Hide WebContentsView (simulating Slide Presentation Mode) & emit Utterance 3 in background
    tiroManager.setVisible(false);
    await new Promise((r) => setTimeout(r, 100));

    await view.webContents.executeJavaScript(`
      (() => {
        const feed = document.getElementById('live-transcript-feed');
        const p3 = document.createElement('p');
        p3.id = 'u3';
        p3.textContent = 'Background capture works while slides stay visible.';
        feed.appendChild(p3);
      })()
    `);
    // Wait past FINALIZE_QUIET_MS (1100ms) so u3 finalizes AND renderer mock translation completes
    await new Promise((r) => setTimeout(r, 2100));

    ipcMain.removeListener('tiro-preload:caption', captionListener);
    ipcMain.removeListener('tiro-preload:telemetry', telemetryListener);
    try {
      fs.unlinkSync(tmpHtmlPath);
    } catch {
      // ignore cleanup error
    }

    const uniqueIds = Array.from(new Set(receivedCaptions.map((c) => c.id)));
    const finalSentences = receivedCaptions.filter((c) => c.isFinal).map((c) => c.text);
    const avgLatency =
      receivedCaptions.length > 0
        ? Math.round(
            receivedCaptions.reduce((acc, c) => acc + c.latencyMs, 0) / receivedCaptions.length
          )
        : -1;

    const rendererCardCount = Number(
      await mainWindow.webContents.executeJavaScript(
        `document.querySelectorAll('.caption-row-card').length`
      )
    );

    const summary = {
      uniqueUtteranceIds: uniqueIds.length,
      totalEvents: receivedCaptions.length,
      finalSentences,
      dedupedCount: latestTelemetry.dedupedCount,
      avgLatencyMs: avgLatency,
      rendererCardCount
    };

    console.log('[POC_VERIFY_PIPELINE]', JSON.stringify(summary));

    if (uniqueIds.length !== 3 || finalSentences.length !== 3 || rendererCardCount < 3) {
      console.error('[POC_VERIFY_ASSERT_FAIL]', summary);
      await shutdownAndExit(1);
      return;
    }

    await shutdownAndExit(0);
  } catch (err) {
    console.error('[POC_VERIFY_ERROR]', err);
    await shutdownAndExit(1);
  }
}

function resolveProjectorDisplay(preferredId: number | null | undefined): Display {
  const all = screen.getAllDisplays();
  if (preferredId != null) {
    const match = all.find((d) => d.id === preferredId);
    if (match) return match;
  }
  const primaryId = screen.getPrimaryDisplay().id;
  return all.find((d) => d.id !== primaryId) ?? screen.getPrimaryDisplay();
}

interface ApplyLayoutRequest {
  displayId?: number | null;
  pptRatio?: number;
  arrangePpt?: boolean;
  startSlideshow?: boolean;
}

interface ApplyLayoutResult {
  displayId: number;
  displayLabel: string;
  sidebar: ScreenRect;
  ppt: ScreenRect;
  pptResult: PptArrangeResult | null;
}

async function applyPresentationLayout(req: ApplyLayoutRequest): Promise<ApplyLayoutResult | null> {
  if (!mainWindow || mainWindow.isDestroyed() || !settingsStore) return null;
  const settings = settingsStore.update({
    ...(req.displayId !== undefined ? { projectorDisplayId: req.displayId } : {}),
    ...(req.pptRatio !== undefined ? { pptRatio: req.pptRatio } : {})
  });
  mainWindow.webContents.send('settings:changed', settings);

  const display = resolveProjectorDisplay(settings.projectorDisplayId);
  const layout = computeProjectorLayout(display.workArea, settings.pptRatio);

  if (mainWindow.isFullScreen()) mainWindow.setFullScreen(false);
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  isPresentationMode = true;
  mainWindow.setBounds(layout.sidebar);
  broadcastWindowState();

  let pptResult: PptArrangeResult | null = null;
  if (req.arrangePpt) {
    pptResult = await arrangePowerPoint(layout.ppt, {
      borderless: settings.pptBorderless,
      startIfMissing: Boolean(req.startSlideshow)
    });
  }

  return {
    displayId: display.id,
    displayLabel: display.label || `Display ${display.id}`,
    sidebar: layout.sidebar,
    ppt: layout.ppt,
    pptResult
  };
}

function exitPresentationLayout(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  isPresentationMode = false;
  const primary = screen.getPrimaryDisplay().workArea;
  const width = Math.min(SETUP_WINDOW_SIZE.width, primary.width);
  const height = Math.min(SETUP_WINDOW_SIZE.height, primary.height);
  mainWindow.setBounds({
    x: primary.x + Math.round((primary.width - width) / 2),
    y: primary.y + Math.round((primary.height - height) / 2),
    width,
    height
  });
  broadcastWindowState();
}

function registerIpcHandlers(): void {
  ipcMain.handle('app:get-runtime-info', () => ({
    platform: process.platform,
    appVersion: app.getVersion(),
    electronVersion: process.versions.electron,
    chromeVersion: process.versions.chrome,
    nodeVersion: process.versions.node,
    isSmokeTest,
    isPocVerify
  }));

  // ---- Settings ----
  ipcMain.handle('settings:get', () => settingsStore?.get() ?? null);
  ipcMain.handle('settings:update', (_event, patch: Partial<AppSettings>) => {
    if (!settingsStore) return null;
    const next = settingsStore.update(patch ?? {});
    if (patch.tiroSelector !== undefined && tiroManager) {
      tiroManager.setDesiredSelector(next.tiroSelector);
    }
    mainWindow?.webContents.send('settings:changed', next);
    return next;
  });

  // ---- Offline translator ----
  ipcMain.handle('translator:get-status', () => translator?.getStatus() ?? null);
  ipcMain.handle('translator:prepare', () => translator?.prepare() ?? null);
  ipcMain.handle(
    'translator:translate',
    async (_event, text: string, captionId?: string) => {
      if (!translator) throw new Error('번역 엔진이 초기화되지 않았습니다.');
      return translator.translate(String(text ?? ''), captionId);
    }
  );
  ipcMain.handle('translator:cancel-pending', () => {
    translator?.cancelPending();
  });

  // ---- Projector layout ----
  ipcMain.handle('layout:apply', (_event, req: ApplyLayoutRequest) =>
    applyPresentationLayout(req ?? {})
  );
  ipcMain.handle('layout:arrange-ppt', async (_event, startSlideshow: boolean) => {
    if (!settingsStore) return null;
    const settings = settingsStore.get();
    const display = resolveProjectorDisplay(settings.projectorDisplayId);
    const layout = computeProjectorLayout(display.workArea, settings.pptRatio);
    return arrangePowerPoint(layout.ppt, {
      borderless: settings.pptBorderless,
      startIfMissing: Boolean(startSlideshow)
    });
  });
  ipcMain.handle('layout:exit', () => {
    exitPresentationLayout();
  });

  // ---- Transcript File Export ----
  ipcMain.handle(
    'captions:export-file',
    async (
      _event,
      req: { format: 'md' | 'txt' | 'srt' | 'json'; content: string; suggestedName: string }
    ) => {
      if (!mainWindow || mainWindow.isDestroyed()) {
        return { saved: false, error: '창을 찾을 수 없습니다.' };
      }
      const filterMap: Record<string, { name: string; extensions: string[] }> = {
        md: { name: 'Markdown 문서 (*.md)', extensions: ['md'] },
        txt: { name: '텍스트 파일 (*.txt)', extensions: ['txt'] },
        srt: { name: 'SRT 자막 파일 (*.srt)', extensions: ['srt'] },
        json: { name: 'JSON 데이터 (*.json)', extensions: ['json'] }
      };
      const chosenFilter = filterMap[req.format] ?? filterMap.txt;
      const result = await dialog.showSaveDialog(mainWindow, {
        title: '실시간 이중언어 자막 내보내기',
        defaultPath: path.join(app.getPath('documents'), req.suggestedName),
        filters: [chosenFilter, { name: '모든 파일 (*.*)', extensions: ['*'] }]
      });
      if (result.canceled || !result.filePath) {
        return { saved: false };
      }
      try {
        fs.writeFileSync(result.filePath, req.content, 'utf8');
        return { saved: true, filePath: result.filePath };
      } catch (err) {
        return {
          saved: false,
          error: err instanceof Error ? err.message : '파일 저장에 실패했습니다.'
        };
      }
    }
  );

  // ---- Frameless window controls ----
  ipcMain.handle('window:minimize', () => mainWindow?.minimize());
  ipcMain.handle('window:toggle-maximize', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return getWindowState();
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
    broadcastWindowState();
    return getWindowState();
  });
  ipcMain.handle('window:close', () => mainWindow?.close());
  ipcMain.handle('window:toggle-always-on-top', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return false;
    const next = !mainWindow.isAlwaysOnTop();
    mainWindow.setAlwaysOnTop(next, 'floating');
    broadcastWindowState();
    return next;
  });

  ipcMain.handle('window:get-state', () => getWindowState());

  ipcMain.handle('window:toggle-fullscreen', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return getWindowState();
    mainWindow.setFullScreen(!mainWindow.isFullScreen());
    return getWindowState();
  });

  ipcMain.handle('window:get-displays', () => getDisplaySummaries());

  ipcMain.handle('window:move-to-display', (_event, displayId: number) => {
    if (!mainWindow || mainWindow.isDestroyed()) return getWindowState();
    const target = screen.getAllDisplays().find((d) => d.id === displayId);
    if (!target) return getWindowState();

    const wasFullScreen = mainWindow.isFullScreen();
    if (wasFullScreen) {
      mainWindow.setFullScreen(false);
    }

    mainWindow.setBounds({
      x: target.bounds.x + Math.max(0, Math.floor((target.bounds.width - 1440) / 2)),
      y: target.bounds.y + Math.max(0, Math.floor((target.bounds.height - 810) / 2)),
      width: Math.min(1440, target.bounds.width),
      height: Math.min(810, target.bounds.height)
    });

    if (wasFullScreen) {
      mainWindow.setFullScreen(true);
    }

    broadcastWindowState();
    return getWindowState();
  });

  ipcMain.on('smoke-test:ready', (_event, summary: string) => {
    if (isSmokeTest) {
      console.log(`[SMOKE_TEST_PASS] ${summary}`);
      setTimeout(() => {
        void shutdownAndExit(0);
      }, 150);
    }
  });

  registerTiroIpcHandlers(
    () => tiroManager,
    () => mainWindow
  );
}

app.whenReady().then(() => {
  settingsStore = new SettingsStore(
    isHeadlessVerify
      ? {
          inMemory: true,
          initialOverrides: {
            translationEngine: 'mock',
            pptRatio: 75,
            captionLayout: 'columns',
            showEnglish: true
          }
        }
      : {}
  );
  translator = new LocalTranslationService((status) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('translator:status', status);
    }
  });

  registerIpcHandlers();
  createMainWindow();

  screen.on('display-added', broadcastDisplaysChanged);
  screen.on('display-removed', broadcastDisplaysChanged);
  screen.on('display-metrics-changed', broadcastDisplaysChanged);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('before-quit', () => {
  translator?.destroy();
  tiroManager?.destroy();
});

app.on('window-all-closed', () => {
  translator?.destroy();
  tiroManager?.destroy();
  app.quit();
});
