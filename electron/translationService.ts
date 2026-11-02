import { app, utilityProcess, type UtilityProcess } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

export type TranslatorState = 'idle' | 'downloading' | 'loading' | 'ready' | 'error';

export interface TranslatorStatus {
  state: TranslatorState;
  /** 0..1 while downloading/loading, otherwise null */
  progress: number | null;
  message: string;
  modelId: string;
  lastLatencyMs: number | null;
  cachedOnDisk?: boolean;
  cacheDir?: string;
  downloadedBytes?: number | null;
  totalBytes?: number | null;
  estimatedDownloadMB?: number;
}

export interface LocalTranslateOptions {
  srcLang?: string;
  tgtLang?: string;
  isInterim?: boolean;
}

const MODEL_ID = 'Xenova/nllb-200-distilled-600M';
const MODEL_DTYPE = 'q8';
const ESTIMATED_DOWNLOAD_MB = 680;
const TRANSLATE_TIMEOUT_MS = 45000;

interface PendingJob {
  captionId?: string;
  resolve: (text: string) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout> | null;
}

interface QueuedReadyJob {
  id: number;
  text: string;
  captionId?: string;
  options?: LocalTranslateOptions;
}

function resolveWorkerScriptPath(): string {
  // Keep worker entry inside app.asar so CommonJS require() resolves app.asar/node_modules/*
  // on clean Windows installations (e.g. C:\Program Files\...), while translationWorker.ts
  // resolves unpacked .mjs/.wasm assets from app.asar.unpacked.
  return path.join(__dirname, 'translationWorker.js');
}

function resolveModelCacheDir(): string {
  const envOverride = process.env.TIRO_MODEL_CACHE_DIR?.trim();
  if (envOverride) {
    return envOverride;
  }
  if (!app.isPackaged) {
    const devCache = path.join(process.cwd(), '.model-cache');
    if (fs.existsSync(path.join(devCache, 'Xenova', 'nllb-200-distilled-600M'))) {
      return devCache;
    }
  }
  return path.join(app.getPath('userData'), 'models');
}

function checkModelCachedOnDisk(cacheDir: string): boolean {
  const modelDir = path.join(cacheDir, ...MODEL_ID.split('/'));
  const encoderPath = path.join(modelDir, 'onnx', 'encoder_model_quantized.onnx');
  const decoderPath = path.join(modelDir, 'onnx', 'decoder_model_merged_quantized.onnx');
  return fs.existsSync(encoderPath) && fs.existsSync(decoderPath);
}

function formatMB(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))}MB`;
}

/**
 * Owns the translation utility process and exposes a Promise-based multilingual translate().
 */
export class LocalTranslationService {
  private child: UtilityProcess | null = null;
  private initSent = false;
  private initFallbackTimer: ReturnType<typeof setTimeout> | null = null;
  private pending = new Map<number, PendingJob>();
  private waitingForReady: QueuedReadyJob[] = [];
  private seq = 0;
  private cachedOnDisk: boolean;
  private readonly cacheDir: string;
  private status: TranslatorStatus;

  constructor(private readonly onStatus: (status: TranslatorStatus) => void) {
    this.cacheDir = resolveModelCacheDir();
    this.cachedOnDisk = checkModelCachedOnDisk(this.cacheDir);
    this.status = {
      state: 'idle',
      progress: null,
      message: this.cachedOnDisk
        ? '로컬 AI 모델이 디스크에 준비되어 있습니다. 시작 시 즉시 오프라인으로 로드됩니다.'
        : `최초 1회 로컬 AI 모델 다운로드(약 ${ESTIMATED_DOWNLOAD_MB}MB, 인터넷 필요) 후 오프라인으로 동작합니다.`,
      modelId: MODEL_ID,
      lastLatencyMs: null,
      cachedOnDisk: this.cachedOnDisk,
      cacheDir: this.cacheDir,
      downloadedBytes: null,
      totalBytes: null,
      estimatedDownloadMB: ESTIMATED_DOWNLOAD_MB
    };
  }

  public getStatus(): TranslatorStatus {
    return { ...this.status };
  }

  private setStatus(patch: Partial<TranslatorStatus>): void {
    this.status = { ...this.status, ...patch };
    this.onStatus(this.getStatus());
  }

  /** Spawns the worker (if needed) and starts download/load of the model. Idempotent. */
  public prepare(): TranslatorStatus {
    if (this.child && this.status.state !== 'error') return this.getStatus();
    this.spawn();
    return this.getStatus();
  }

  private sendInitOnce(cacheDir: string): void {
    if (this.initSent || !this.child) return;
    this.initSent = true;
    if (this.initFallbackTimer) {
      clearTimeout(this.initFallbackTimer);
      this.initFallbackTimer = null;
    }
    this.child.postMessage({
      type: 'init',
      cacheDir,
      modelId: MODEL_ID,
      dtype: MODEL_DTYPE
    });
  }

  private spawn(): void {
    this.child?.kill();
    if (this.initFallbackTimer) {
      clearTimeout(this.initFallbackTimer);
      this.initFallbackTimer = null;
    }
    this.initSent = false;

    const cacheDir = this.cacheDir;
    this.cachedOnDisk = checkModelCachedOnDisk(cacheDir);

    const workerPath = resolveWorkerScriptPath();
    const child = utilityProcess.fork(workerPath, [], {
      serviceName: 'live-caption-translator',
      stdio: 'pipe'
    });
    this.child = child;

    child.stdout?.on('data', (d: Buffer) => process.stdout.write(`[translator] ${d}`));
    child.stderr?.on('data', (d: Buffer) => process.stderr.write(`[translator] ${d}`));

    this.setStatus({
      state: this.cachedOnDisk ? 'loading' : 'downloading',
      progress: null,
      cachedOnDisk: this.cachedOnDisk,
      downloadedBytes: null,
      totalBytes: null,
      message: this.cachedOnDisk
        ? '캐시된 로컬 AI 번역 엔진 시작 중 (오프라인 구동)...'
        : `로컬 AI 번역 모델 다운로드 연결 중 (최초 1회, 약 ${ESTIMATED_DOWNLOAD_MB}MB)...`
    });

    child.on('message', (msg: Record<string, unknown>) => this.handleWorkerMessage(msg, cacheDir));
    child.on('exit', (code) => {
      if (this.child !== child) return;
      this.child = null;
      this.initSent = false;
      this.failAll(new Error(`번역 엔진이 종료되었습니다 (code ${code}).`));
      this.setStatus({
        state: 'error',
        progress: null,
        message: `번역 엔진 종료 (code ${code ?? 'signal'}). 재시도가 필요합니다.`
      });
    });

    this.initFallbackTimer = setTimeout(() => {
      this.sendInitOnce(cacheDir);
    }, 1500);
  }

  private handleWorkerMessage(msg: Record<string, unknown>, cacheDir: string): void {
    switch (msg.type) {
      case 'spawned': {
        this.sendInitOnce(cacheDir);
        break;
      }
      case 'progress': {
        const loaded = Number(msg.loaded) || 0;
        const total = Number(msg.total) || 0;
        const progress = total > 0 ? Math.min(1, loaded / total) : null;
        const pct = progress != null ? Math.round(progress * 100) : 0;
        if (this.cachedOnDisk) {
          this.setStatus({
            state: 'loading',
            progress,
            cachedOnDisk: true,
            downloadedBytes: loaded,
            totalBytes: total,
            message: `로컬 캐시에서 번역 모델 불러오는 중... ${pct}%`
          });
        } else {
          const sizeDetail =
            total > 0 ? ` (${formatMB(loaded)} / ${formatMB(total)})` : '';
          this.setStatus({
            state: 'downloading',
            progress,
            cachedOnDisk: false,
            downloadedBytes: loaded,
            totalBytes: total,
            message: `번역 모델 다운로드 중 (최초 1회)${sizeDetail} · ${pct}%`
          });
        }
        break;
      }
      case 'loading':
        this.setStatus({
          state: 'loading',
          progress: null,
          message: String(msg.message ?? '모델 로드 중...')
        });
        break;
      case 'ready': {
        this.cachedOnDisk = true;
        this.setStatus({
          state: 'ready',
          progress: null,
          cachedOnDisk: true,
          downloadedBytes: null,
          totalBytes: null,
          message: '로컬 AI 번역 준비 완료 (디스크 캐시됨 · 번역은 오프라인 구동)'
        });
        const queued = this.waitingForReady.splice(0);
        for (const job of queued) this.dispatch(job.id, job.text, job.captionId, job.options);
        break;
      }
      case 'init-error':
        this.failAll(new Error(String(msg.message)));
        this.setStatus({
          state: 'error',
          progress: null,
          message: this.cachedOnDisk
            ? `번역 모델 로드 실패: ${String(msg.message).slice(0, 160)}`
            : `모델 다운로드 실패 (최초 1회 인터넷 연결 필요): ${String(msg.message).slice(0, 140)}`
        });
        this.child?.kill();
        this.child = null;
        this.initSent = false;
        break;
      case 'result': {
        const job = this.pending.get(Number(msg.id));
        if (!job) return;
        this.pending.delete(Number(msg.id));
        if (job.timer) clearTimeout(job.timer);
        const elapsed = Number(msg.elapsedMs);
        if (Number.isFinite(elapsed)) {
          this.status.lastLatencyMs = elapsed;
          this.onStatus(this.getStatus());
        }
        job.resolve(String(msg.text ?? ''));
        break;
      }
      case 'superseded': {
        const job = this.pending.get(Number(msg.id));
        if (!job) return;
        this.pending.delete(Number(msg.id));
        if (job.timer) clearTimeout(job.timer);
        job.reject(new Error('SUPERSEDED'));
        break;
      }
      case 'error': {
        const job = this.pending.get(Number(msg.id));
        if (!job) return;
        this.pending.delete(Number(msg.id));
        if (job.timer) clearTimeout(job.timer);
        job.reject(new Error(String(msg.message ?? '번역 실패')));
        break;
      }
      default:
        break;
    }
  }

  private dispatch(
    id: number,
    text: string,
    captionId?: string,
    options?: LocalTranslateOptions
  ): void {
    const job = this.pending.get(id);
    if (!job || !this.child) return;
    job.timer = setTimeout(() => {
      if (this.pending.delete(id)) job.reject(new Error('번역 시간 초과'));
    }, TRANSLATE_TIMEOUT_MS);
    this.child.postMessage({
      type: 'translate',
      id,
      text,
      captionId,
      srcLang: options?.srcLang,
      tgtLang: options?.tgtLang,
      isInterim: options?.isInterim
    });
  }

  public translate(
    text: string,
    captionId?: string,
    options?: LocalTranslateOptions
  ): Promise<string> {
    const clean = text.trim();
    if (!clean) return Promise.resolve('');
    this.prepare();

    this.seq += 1;
    const id = this.seq;
    return new Promise<string>((resolve, reject) => {
      this.pending.set(id, { captionId, resolve, reject, timer: null });
      if (this.status.state === 'ready') {
        this.dispatch(id, clean, captionId, options);
      } else {
        if (captionId) {
          for (let i = this.waitingForReady.length - 1; i >= 0; i -= 1) {
            if (this.waitingForReady[i].captionId === captionId) {
              const old = this.waitingForReady.splice(i, 1)[0];
              const oldPending = this.pending.get(old.id);
              if (oldPending) {
                this.pending.delete(old.id);
                oldPending.reject(new Error('SUPERSEDED'));
              }
            }
          }
        }
        this.waitingForReady.push({ id, text: clean, captionId, options });
      }
    });
  }

  public cancelPending(): void {
    for (const item of this.waitingForReady.splice(0)) {
      const job = this.pending.get(item.id);
      if (job) {
        this.pending.delete(item.id);
        job.reject(new Error('SUPERSEDED'));
      }
    }
    this.child?.postMessage({ type: 'clear-pending' });
  }

  private failAll(err: Error): void {
    for (const job of this.pending.values()) {
      if (job.timer) clearTimeout(job.timer);
      job.reject(err);
    }
    this.pending.clear();
    this.waitingForReady = [];
  }

  public destroy(): void {
    if (this.initFallbackTimer) {
      clearTimeout(this.initFallbackTimer);
      this.initFallbackTimer = null;
    }
    this.failAll(new Error('앱 종료'));
    this.child?.kill();
    this.child = null;
    this.initSent = false;
  }
}
