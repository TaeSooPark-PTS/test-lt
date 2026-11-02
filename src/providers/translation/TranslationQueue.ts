import type { TranslationProvider } from './TranslationProvider';

interface QueueTask {
  captionId: string;
  text: string;
  sourceLanguage: string;
  targetLanguage: string;
  onStart: (captionId: string) => void;
  onSuccess: (captionId: string, translated: string) => void;
  onError: (captionId: string, errorMessage: string) => void;
}

export class TranslationQueue {
  private queue: QueueTask[] = [];
  private activeCount = 0;
  private readonly maxConcurrency: number;
  private provider: TranslationProvider;
  private latestTokenByCaption = new Map<string, number>();
  private tokenSeed = 0;

  constructor(provider: TranslationProvider, maxConcurrency = 3) {
    this.provider = provider;
    this.maxConcurrency = maxConcurrency;
  }

  public setProvider(provider: TranslationProvider): void {
    this.provider = provider;
  }

  public enqueue(task: Omit<QueueTask, 'sourceLanguage' | 'targetLanguage'> & {
    sourceLanguage?: string;
    targetLanguage?: string;
  }): void {
    // Deduplicate pending tasks for the same captionId
    this.queue = this.queue.filter((item) => item.captionId !== task.captionId);
    this.queue.push({
      captionId: task.captionId,
      text: task.text,
      sourceLanguage: task.sourceLanguage ?? 'en',
      targetLanguage: task.targetLanguage ?? 'ko',
      onStart: task.onStart,
      onSuccess: task.onSuccess,
      onError: task.onError
    });
    this.pump();
  }

  public clear(): void {
    this.queue = [];
    this.latestTokenByCaption.clear();
  }

  private pump(): void {
    while (this.activeCount < this.maxConcurrency && this.queue.length > 0) {
      const next = this.queue.shift()!;
      this.runTask(next);
    }
  }

  private runTask(task: QueueTask): void {
    this.activeCount += 1;
    this.tokenSeed += 1;
    const token = this.tokenSeed;
    this.latestTokenByCaption.set(task.captionId, token);

    task.onStart(task.captionId);

    this.provider
      .translate(task.text, task.sourceLanguage, task.targetLanguage)
      .then((translated) => {
        if (this.latestTokenByCaption.get(task.captionId) === token) {
          task.onSuccess(task.captionId, translated);
        }
      })
      .catch((err: unknown) => {
        if (this.latestTokenByCaption.get(task.captionId) === token) {
          const message = err instanceof Error ? err.message : '알 수 없는 번역 오류';
          task.onError(task.captionId, message);
        }
      })
      .finally(() => {
        this.activeCount -= 1;
        this.pump();
      });
  }
}
