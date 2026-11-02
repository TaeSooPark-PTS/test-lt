import type { ProviderTranslateOptions, TranslationProvider } from './TranslationProvider';

export type QueueTaskPriority = 'high' | 'normal';

interface QueueTask {
  captionId: string;
  text: string;
  sourceLanguage: string;
  targetLanguage: string;
  priority: QueueTaskPriority;
  options?: ProviderTranslateOptions;
  onStart: (captionId: string) => void;
  onSuccess: (captionId: string, translated: string) => void;
  onError: (captionId: string, errorMessage: string) => void;
}

export class TranslationQueue {
  private queue: QueueTask[] = [];
  private activeCount = 0;
  private maxConcurrency: number;
  private provider: TranslationProvider;
  private latestTokenByCaption = new Map<string, number>();
  private tokenSeed = 0;

  constructor(provider: TranslationProvider, maxConcurrency = 3) {
    this.provider = provider;
    this.maxConcurrency = Math.max(1, maxConcurrency);
  }

  public setProvider(provider: TranslationProvider, maxConcurrency?: number): void {
    this.provider = provider;
    if (typeof maxConcurrency === 'number' && maxConcurrency >= 1) {
      this.maxConcurrency = Math.floor(maxConcurrency);
    }
    this.pump();
  }

  public setMaxConcurrency(maxConcurrency: number): void {
    this.maxConcurrency = Math.max(1, Math.floor(maxConcurrency));
    this.pump();
  }

  public enqueue(
    task: Omit<QueueTask, 'sourceLanguage' | 'targetLanguage' | 'priority'> & {
      sourceLanguage?: string;
      targetLanguage?: string;
      priority?: QueueTaskPriority;
    }
  ): void {
    const priority: QueueTaskPriority = task.priority ?? 'normal';
    // Deduplicate pending tasks for the same captionId (latest text wins!)
    this.queue = this.queue.filter((item) => item.captionId !== task.captionId);

    const nextTask: QueueTask = {
      captionId: task.captionId,
      text: task.text,
      sourceLanguage: task.sourceLanguage ?? 'en',
      targetLanguage: task.targetLanguage ?? 'ko',
      priority,
      options: task.options,
      onStart: task.onStart,
      onSuccess: task.onSuccess,
      onError: task.onError
    };

    if (priority === 'high') {
      // Insert after existing high-priority tasks, ahead of normal (interim) tasks
      const firstNormalIdx = this.queue.findIndex((item) => item.priority === 'normal');
      if (firstNormalIdx === -1) {
        this.queue.push(nextTask);
      } else {
        this.queue.splice(firstNormalIdx, 0, nextTask);
      }
    } else {
      this.queue.push(nextTask);
    }

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
      .translate(
        task.text,
        task.sourceLanguage,
        task.targetLanguage,
        task.captionId,
        task.options
      )
      .then((translated) => {
        if (this.latestTokenByCaption.get(task.captionId) === token) {
          task.onSuccess(task.captionId, translated);
        }
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : '알 수 없는 번역 오류';
        if (message === 'SUPERSEDED') {
          return;
        }
        if (this.latestTokenByCaption.get(task.captionId) === token) {
          task.onError(task.captionId, message);
        }
      })
      .finally(() => {
        this.activeCount -= 1;
        this.pump();
      });
  }
}
