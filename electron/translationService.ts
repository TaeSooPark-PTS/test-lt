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
}

const MODEL_ID = 'Xenova/nllb-200-distilled-600M';
const MODEL_DTYPE = 'q8';
const TRANSLATE_TIMEOUT_MS = 45000;

interface PendingJob {
  captionId?: string;
  resolve: (text: string) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout> | null;
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

/**
 * Owns the translation utility process and exposes a Promise-based translate().
 */
export class LocalTranslationService {
  private child: UtilityProcess | null = null;
  private initSent = false;
  private initFallbackTimer: ReturnType<typeof setTimeout> | null = null;
  private pending = new Map<number, PendingJob>();
  private waitingForReady: Array<{ id: number; text: string; captionId?: string }> = [];
  private seq = 0;
  private cachedOnDisk = false;
  private status: TranslatorStatus = {
    state: 'idle',
    progress: null,
    message: '번역 모델이 아직 로드되지 않았습니다.',
    modelId: MODEL_ID,
    lastLatencyMs: null,
    cachedOnDisk: false
  };

  constructor(private readonly onStatus: (status: TranslatorStatus) => void) {}

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

    const cacheDir = resolveModelCacheDir();
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
      state: 'loading',
      progress: null,
      cachedOnDisk: this.cachedOnDisk,
      message: this.cachedOnDisk
        ? '오프라인 번역 엔진 시작 중...'
        : '번역 엔진 시작 및 모델 확인 중...'
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

    // Fallback in case 'spawned' arrived before listener registration
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
            message: `오프라인 번역 모델 불러오는 중... ${pct}%`
          });
        } else {
          this.setStatus({
            state: 'downloading',
            progress,
            cachedOnDisk: false,
            message: `번역 모델 다운로드 중 (최초 1회, 약 900MB) ${pct}%`
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
          message: '오프라인 AI 번역 준비 완료'
        });
        const queued = this.waitingForReady.splice(0);
        for (const job of queued) this.dispatch(job.id, job.text, job.captionId);
        break;
      }
      case 'init-error':
        this.failAll(new Error(String(msg.message)));
        this.setStatus({
          state: 'error',
          progress: null,
          message: `번역 모델 로드 실패: ${String(msg.message).slice(0, 160)}`
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
        // Resolve empty or reject silently as superseded
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

  private dispatch(id: number, text: string, captionId?: string): void {
    const job = this.pending.get(id);
    if (!job || !this.child) return;
    job.timer = setTimeout(() => {
      if (this.pending.delete(id)) job.reject(new Error('번역 시간 초과'));
    }, TRANSLATE_TIMEOUT_MS);
    this.child.postMessage({ type: 'translate', id, text, captionId });
  }

  public translate(text: string, captionId?: string): Promise<string> {
    const clean = text.trim();
    if (!clean) return Promise.resolve('');
    this.prepare();

    this.seq += 1;
    const id = this.seq;
    return new Promise<string>((resolve, reject) => {
      this.pending.set(id, { captionId, resolve, reject, timer: null });
      if (this.status.state === 'ready') {
        this.dispatch(id, clean, captionId);
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
        this.waitingForReady.push({ id, text: clean, captionId });
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
    for (const [, job] of this.pending) {
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
    const child = this.child;
    this.child = null;
    this.initSent = false;
    this.failAll(new Error('번역 엔진 종료'));
    child?.kill();
  }
}
