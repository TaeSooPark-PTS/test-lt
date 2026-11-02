import { app, BrowserWindow, ipcMain, screen } from 'electron';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { registerTiroIpcHandlers, TiroSessionManager } from './tiroSessionManager';

if (process.platform === 'win32') {
  app.setAppUserModelId('com.tiro.bilingual.workspace');
}

let mainWindow: BrowserWindow | null = null;
let tiroManager: TiroSessionManager | null = null;

const isSmokeTest = process.argv.includes('--smoke-test');
const isPocVerify = process.argv.includes('--poc-verify');
const isHeadlessVerify = isSmokeTest || isPocVerify;

export interface DisplaySummary {
  id: number;
  label: string;
  width: number;
  height: number;
  x: number;
  y: number;
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
    isPrimary: display.id === primaryId
  }));
}

function getWindowState() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return {
      isFullScreen: false,
      currentDisplayId: screen.getPrimaryDisplay().id
    };
  }
  const currentDisplay = screen.getDisplayMatching(mainWindow.getBounds());
  return {
    isFullScreen: mainWindow.isFullScreen(),
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
    width: 1600,
    height: 900,
    minWidth: 1024,
    minHeight: 720,
    backgroundColor: '#0b0f17',
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
  tiroManager = new TiroSessionManager(mainWindow);

  mainWindow.on('enter-full-screen', broadcastWindowState);
  mainWindow.on('leave-full-screen', broadcastWindowState);
  mainWindow.on('moved', broadcastWindowState);
  mainWindow.on('resized', broadcastWindowState);

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
      app.exit(1);
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
    // 1. Verify real https://tiro.ooo/login loading & isolated Preload DOM Diagnostics
    const diagPromise = new Promise<Record<string, unknown>>((resolve) => {
      ipcMain.once('tiro-preload:diagnostics', (_ev, diag) => resolve(diag));
    });

    tiroManager.setVisible(true);
    tiroManager.setBounds({ x: 0, y: 44, width: 1100, height: 800 });
    await tiroManager.navigate('https://tiro.ooo/login');
    await new Promise((r) => setTimeout(r, 2500));
    tiroManager.sendPreloadCommand({ action: 'diagnostics' });

    const realTiroDiag = await Promise.race([
      diagPromise,
      new Promise<Record<string, unknown>>((_, reject) =>
        setTimeout(() => reject(new Error('Timeout waiting for tiro.ooo diagnostics')), 8000)
      )
    ]);
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

    // 2. Verify end-to-end MutationObserver -> Preload -> IPC -> TiroCaptionProvider pipeline
    const tmpHtmlPath = path.join(os.tmpdir(), `tiro-stt-harness-${Date.now()}.html`);
    fs.writeFileSync(
      tmpHtmlPath,
      `<!doctype html>
      <html><body>
        <div id="live-transcript-feed"></div>
      </body></html>`,
      'utf8'
    );

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

    await tiroManager.navigate(`file://${tmpHtmlPath}`);
    await new Promise((r) => setTimeout(r, 300));

    // Activate TiroCaptionProvider in Renderer UI as well
    await mainWindow.webContents.executeJavaScript(
      `document.querySelector('[data-testid="switch-provider-tiro"]')?.click();`
    );

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
    // Wait past FINALIZE_QUIET_MS (1100ms) so u3 also finalizes cleanly
    await new Promise((r) => setTimeout(r, 1300));

    ipcMain.removeListener('tiro-preload:caption', captionListener);
    ipcMain.removeListener('tiro-preload:telemetry', telemetryListener);
    fs.unlinkSync(tmpHtmlPath);

    const uniqueIds = Array.from(new Set(receivedCaptions.map((c) => c.id)));
    const finalSentences = receivedCaptions.filter((c) => c.isFinal).map((c) => c.text);
    const avgLatency =
      receivedCaptions.length > 0
        ? Math.round(
            receivedCaptions.reduce((acc, c) => acc + c.latencyMs, 0) / receivedCaptions.length
          )
        : -1;

    const rendererCardCount = await mainWindow.webContents.executeJavaScript(
      `document.querySelectorAll('.caption-row-card').length`
    );

    console.log(
      '[POC_VERIFY_PIPELINE]',
      JSON.stringify({
        uniqueUtteranceIds: uniqueIds.length,
        totalEvents: receivedCaptions.length,
        finalSentences,
        dedupedCount: latestTelemetry.dedupedCount,
        avgLatencyMs: avgLatency,
        rendererCardCount
      })
    );

    app.exit(0);
  } catch (err) {
    console.error('[POC_VERIFY_ERROR]', err);
    app.exit(1);
  }
}

function registerIpcHandlers(): void {
  ipcMain.handle('app:get-runtime-info', () => ({
    platform: process.platform,
    appVersion: app.getVersion(),
    electronVersion: process.versions.electron,
    chromeVersion: process.versions.chrome,
    nodeVersion: process.versions.node
  }));

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
        app.exit(0);
      }, 150);
    }
  });

  registerTiroIpcHandlers(
    () => tiroManager,
    () => mainWindow
  );
}

app.whenReady().then(() => {
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

app.on('window-all-closed', () => {
  app.quit();
});
