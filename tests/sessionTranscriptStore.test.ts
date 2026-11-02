import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import {
  SessionTranscriptStore,
  type PersistedCaptionItem
} from '../electron/sessionTranscriptStore';

function makeSampleItem(seq: number, en: string, ko: string): PersistedCaptionItem {
  const now = 1_760_000_000_000 + seq * 1000;
  return {
    id: `utt-${seq}`,
    sequence: seq,
    englishText: en,
    koreanText: ko,
    detectedLang: 'en',
    captionStatus: 'final',
    translationState: 'translated',
    createdAt: now,
    updatedAt: now
  };
}

describe('SessionTranscriptStore automatic backup & crash recovery', () => {
  it('atomically persists, lists, reloads, and deletes transcript sessions on disk', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tiro-sessions-test-'));
    try {
      const store1 = new SessionTranscriptStore({ baseDir: tmpDir, maxSessions: 5 });

      const summary = store1.saveSnapshot({
        sessionId: 'session-keynote-1',
        source: 'tiro',
        sourceLanguage: 'auto',
        targetLanguage: 'ko',
        items: [
          makeSampleItem(1, 'Good morning everyone.', '여러분 좋은 아침입니다.'),
          makeSampleItem(2, 'Let us review the architecture.', '아키텍처를 살펴보겠습니다.')
        ]
      });

      expect(summary).not.toBeNull();
      expect(summary?.captionCount).toBe(2);
      expect(summary?.title).toContain('여러분 좋은 아침입니다.');

      // Simulate app restart by instantiating a fresh store pointing to the same directory
      const store2 = new SessionTranscriptStore({ baseDir: tmpDir, maxSessions: 5 });
      const listed = store2.listSessions();
      expect(listed).toHaveLength(1);
      expect(listed[0].sessionId).toBe('session-keynote-1');

      const restored = store2.loadSession('session-keynote-1');
      expect(restored).not.toBeNull();
      expect(restored?.items).toHaveLength(2);
      expect(restored?.items[1].koreanText).toBe('아키텍처를 살펴보겠습니다.');

      expect(store2.deleteSession('session-keynote-1')).toBe(true);
      expect(store2.listSessions()).toHaveLength(0);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('prunes oldest sessions automatically when maxSessions is exceeded', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tiro-sessions-prune-'));
    try {
      const store = new SessionTranscriptStore({ baseDir: tmpDir, maxSessions: 3 });

      for (let i = 1; i <= 5; i += 1) {
        store.saveSnapshot({
          sessionId: `sess-${i}`,
          source: 'tiro',
          items: [makeSampleItem(i, `Sentence ${i}`, `문장 ${i}`)]
        });
      }

      const listed = store.listSessions();
      expect(listed).toHaveLength(3);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
