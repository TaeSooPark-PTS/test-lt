import { describe, expect, it } from 'vitest';
import type { TranslationProvider } from '../src/providers/translation/TranslationProvider';
import { TranslationQueue } from '../src/providers/translation/TranslationQueue';

describe('TranslationQueue (Real-Time Latest-Wins & Priority Scheduling)', () => {
  it('deduplicates queued interim tasks for the same captionId when concurrency is 1', async () => {
    const executedTexts: string[] = [];
    const provider: TranslationProvider = {
      getStatus: () => ({
        providerName: 'TestProvider',
        isMock: true,
        state: 'ready',
        sourceLanguage: 'en',
        targetLanguage: 'ko'
      }),
      translate: async (text) => {
        executedTexts.push(text);
        await new Promise((r) => setTimeout(r, 25));
        return `KO:${text}`;
      }
    };

    const queue = new TranslationQueue(provider, 1);
    const results: Record<string, string> = {};

    // First task occupies single ONNX worker slot
    queue.enqueue({
      captionId: 'c1',
      text: 'First sentence.',
      priority: 'high',
      onStart: () => {},
      onSuccess: (id, ko) => {
        results[id] = ko;
      },
      onError: () => {}
    });

    // Three rapid updates for c2 arrive while c1 is running -> only latest c2 must execute!
    for (const draft of ['AI is', 'AI is changing', 'AI is changing everything.']) {
      queue.enqueue({
        captionId: 'c2',
        text: draft,
        priority: 'normal',
        onStart: () => {},
        onSuccess: (id, ko) => {
          results[id] = ko;
        },
        onError: () => {}
      });
    }

    await new Promise((r) => setTimeout(r, 120));

    expect(executedTexts).toEqual(['First sentence.', 'AI is changing everything.']);
    expect(results.c1).toBe('KO:First sentence.');
    expect(results.c2).toBe('KO:AI is changing everything.');
  });

  it('schedules high-priority final sentences ahead of queued normal-priority interim drafts', async () => {
    const executedOrder: string[] = [];
    const provider: TranslationProvider = {
      getStatus: () => ({
        providerName: 'TestProvider',
        isMock: true,
        state: 'ready',
        sourceLanguage: 'en',
        targetLanguage: 'ko'
      }),
      translate: async (text) => {
        executedOrder.push(text);
        await new Promise((r) => setTimeout(r, 20));
        return text;
      }
    };

    const queue = new TranslationQueue(provider, 1);

    queue.enqueue({
      captionId: 'active',
      text: 'active-job',
      priority: 'high',
      onStart: () => {},
      onSuccess: () => {},
      onError: () => {}
    });
    queue.enqueue({
      captionId: 'interim-1',
      text: 'interim-draft',
      priority: 'normal',
      onStart: () => {},
      onSuccess: () => {},
      onError: () => {}
    });
    queue.enqueue({
      captionId: 'final-2',
      text: 'finalized-utterance',
      priority: 'high',
      onStart: () => {},
      onSuccess: () => {},
      onError: () => {}
    });

    await new Promise((r) => setTimeout(r, 110));
    expect(executedOrder).toEqual(['active-job', 'finalized-utterance', 'interim-draft']);
  });

  it('ignores SUPERSEDED worker rejections without triggering error state', async () => {
    let errorCalled = false;
    const provider: TranslationProvider = {
      getStatus: () => ({
        providerName: 'TestProvider',
        isMock: true,
        state: 'ready',
        sourceLanguage: 'en',
        targetLanguage: 'ko'
      }),
      translate: async () => {
        throw new Error('SUPERSEDED');
      }
    };

    const queue = new TranslationQueue(provider, 1);
    queue.enqueue({
      captionId: 'c1',
      text: 'Draft',
      onStart: () => {},
      onSuccess: () => {},
      onError: () => {
        errorCalled = true;
      }
    });

    await new Promise((r) => setTimeout(r, 30));
    expect(errorCalled).toBe(false);
  });
});
