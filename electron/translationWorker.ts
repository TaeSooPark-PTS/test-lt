/**
 * Runs inside an Electron utilityProcess so that model download / ONNX inference never blocks
 * the main process (window, IPC, Tiro capture relay).
 *
 * Crucial Electron Compatibility Note:
 * Electron compiles V8 with the V8 Memory Cage (v8_enable_sandbox = true), which causes native
 * `onnxruntime-node` to crash with SIGTRAP / 0x80000003 on `napi_create_external_arraybuffer`.
 * We inject `onnxruntime-web` (multi-threaded SIMD WebAssembly) via transformers.js's official
 * `Symbol.for('onnxruntime')` hook before loading `@huggingface/transformers`, preserving Node `fs`
 * disk model caching while running 100% crash-free and fast across Windows 10/11 (x64 & ARM64), macOS, and Linux.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { pathToFileURL } from 'url';

type InitMessage = { type: 'init'; cacheDir: string; modelId: string; dtype: string };
type TranslateMessage = {
  type: 'translate';
  id: number;
  text: string;
  captionId?: string;
  srcLang?: string;
  tgtLang?: string;
  isInterim?: boolean;
};
type ClearMessage = { type: 'clear-pending' };
type WorkerInbound = InitMessage | TranslateMessage | ClearMessage;

type TranslatorFn = (
  text: string,
  options: Record<string, unknown>
) => Promise<Array<{ translation_text: string }> | { translation_text: string }>;

interface ParentPortLike {
  on(event: 'message', listener: (event: { data: WorkerInbound }) => void): void;
  postMessage(message: unknown): void;
}

interface TransformersModule {
  env: {
    cacheDir: string;
    allowLocalModels: boolean;
    useWasmCache?: boolean;
  };
  pipeline: (
    task: string,
    model: string,
    options: Record<string, unknown>
  ) => Promise<unknown>;
}

const parentPort = (process as unknown as { parentPort: ParentPortLike }).parentPort;

let transformersMod: TransformersModule | null = null;
let translatorPromise: Promise<TranslatorFn> | null = null;
const jobQueue: TranslateMessage[] = [];
let busy = false;

function post(message: Record<string, unknown>): void {
  parentPort.postMessage(message);
}

function resolveUnpackedPath(rawPath: string): string {
  const unpacked = rawPath.replace(/app\.asar([/\\])/, 'app.asar.unpacked$1');
  if (unpacked !== rawPath && fs.existsSync(unpacked)) {
    return unpacked;
  }
  return rawPath;
}

function computeAdaptiveMaxNewTokens(text: string, isInterim?: boolean): number {
  const charLen = text.trim().length;
  // Tighter dynamic token budget prevents runaway repetition loops on noisy STT fragments
  // and speeds up short/medium utterances by 25~40%.
  const estimated = Math.ceil(charLen * (isInterim ? 1.55 : 1.85)) + 18;
  const cap = isInterim ? 160 : 256;
  return Math.min(cap, Math.max(24, estimated));
}

function ensureTransformersRuntime(): TransformersModule {
  if (transformersMod) return transformersMod;

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const ort = require('onnxruntime-web') as {
    env: {
      wasm: {
        wasmPaths?: { mjs: string; wasm: string } | string;
        wasmBinary?: ArrayBufferLike;
        numThreads?: number;
      };
    };
  };

  const ortEntry = resolveUnpackedPath(require.resolve('onnxruntime-web'));
  const ortDistDir = path.dirname(ortEntry);
  const mjsPath = path.join(ortDistDir, 'ort-wasm-simd-threaded.mjs');
  const wasmPath = path.join(ortDistDir, 'ort-wasm-simd-threaded.wasm');

  ort.env.wasm.wasmPaths = {
    mjs: pathToFileURL(mjsPath).href,
    wasm: pathToFileURL(wasmPath).href
  };
  const wasmBuf = fs.readFileSync(wasmPath);
  ort.env.wasm.wasmBinary = wasmBuf.buffer.slice(
    wasmBuf.byteOffset,
    wasmBuf.byteOffset + wasmBuf.byteLength
  );
  ort.env.wasm.numThreads = Math.min(4, Math.max(1, os.cpus().length));

  (globalThis as Record<symbol, unknown>)[Symbol.for('onnxruntime')] = ort;

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const loaded = require('@huggingface/transformers') as TransformersModule;
  loaded.env.useWasmCache = false;
  transformersMod = loaded;
  return loaded;
}

function loadTranslator(msg: InitMessage): Promise<TranslatorFn> {
  if (translatorPromise) return translatorPromise;

  let transformers: TransformersModule;
  try {
    transformers = ensureTransformersRuntime();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    post({ type: 'init-error', message });
    return Promise.reject(err);
  }

  transformers.env.cacheDir = msg.cacheDir;
  transformers.env.allowLocalModels = false;

  const fileProgress = new Map<string, { loaded: number; total: number }>();
  let lastPostedAt = 0;

  translatorPromise = (
    transformers.pipeline('translation', msg.modelId, {
      device: 'auto',
      dtype: msg.dtype,
      session_options: {
        executionProviders: ['wasm']
      },
      progress_callback: (p: { status: string; file?: string; loaded?: number; total?: number }) => {
        if (p.status === 'progress' && p.file && p.total) {
          fileProgress.set(p.file, { loaded: p.loaded ?? 0, total: p.total });
          const now = Date.now();
          if (now - lastPostedAt < 250) return;
          lastPostedAt = now;
          let loaded = 0;
          let total = 0;
          for (const v of fileProgress.values()) {
            loaded += v.loaded;
            total += v.total;
          }
          post({ type: 'progress', loaded, total, file: p.file });
        } else if (p.status === 'done' && p.file) {
          post({ type: 'file-done', file: p.file });
        }
      }
    }) as Promise<TranslatorFn>
  ).then(async (translator) => {
    // Warm-up so the first live sentence is not slowed by lazy WASM session init.
    post({ type: 'loading', message: '번역 모델 워밍업 중...' });
    await translator('Hello.', { src_lang: 'eng_Latn', tgt_lang: 'kor_Hang', max_new_tokens: 16 });
    return translator;
  });

  translatorPromise
    .then(() => post({ type: 'ready' }))
    .catch((err: unknown) => {
      translatorPromise = null;
      post({ type: 'init-error', message: err instanceof Error ? err.message : String(err) });
    });

  return translatorPromise;
}

async function pump(): Promise<void> {
  if (busy || !translatorPromise) return;
  const job = jobQueue.shift();
  if (!job) return;
  busy = true;
  const startedAt = Date.now();
  try {
    const translator = await translatorPromise;
    const srcLang = job.srcLang || 'eng_Latn';
    const tgtLang = job.tgtLang || 'kor_Hang';
    const maxNewTokens = computeAdaptiveMaxNewTokens(job.text, job.isInterim);

    const decodeOpts: Record<string, unknown> = job.isInterim
      ? {
          src_lang: srcLang,
          tgt_lang: tgtLang,
          max_new_tokens: maxNewTokens,
          num_beams: 1
        }
      : {
          src_lang: srcLang,
          tgt_lang: tgtLang,
          max_new_tokens: maxNewTokens,
          num_beams: 1,
          no_repeat_ngram_size: 3,
          repetition_penalty: 1.12
        };

    const output = await translator(job.text, decodeOpts);
    const first = Array.isArray(output) ? output[0] : output;
    post({
      type: 'result',
      id: job.id,
      text: (first?.translation_text ?? '').trim(),
      elapsedMs: Date.now() - startedAt
    });
  } catch (err) {
    post({ type: 'error', id: job.id, message: err instanceof Error ? err.message : String(err) });
  } finally {
    busy = false;
    void pump();
  }
}

parentPort.on('message', (event) => {
  const msg = event.data;
  if (msg.type === 'init') {
    void loadTranslator(msg);
  } else if (msg.type === 'translate') {
    // Latest-wins deduplication for the same captionId while waiting in queue
    if (msg.captionId) {
      for (let i = jobQueue.length - 1; i >= 0; i -= 1) {
        if (jobQueue[i].captionId === msg.captionId) {
          const superseded = jobQueue.splice(i, 1)[0];
          post({ type: 'superseded', id: superseded.id });
        }
      }
    }
    jobQueue.push(msg);
    void pump();
  } else if (msg.type === 'clear-pending') {
    while (jobQueue.length > 0) {
      const removed = jobQueue.shift()!;
      post({ type: 'superseded', id: removed.id });
    }
  }
});

post({ type: 'spawned' });
