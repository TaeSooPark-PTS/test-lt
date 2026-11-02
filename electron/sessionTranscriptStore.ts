import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

export interface PersistedCaptionItem {
  id: string;
  sequence: number;
  englishText: string;
  koreanText: string | null;
  detectedLang?: string;
  captionStatus: 'interim' | 'final';
  translationState: 'pending' | 'translating' | 'translated' | 'error';
  errorMessage?: string;
  extractionLatencyMs?: number;
  createdAt: number;
  updatedAt: number;
}

export interface TranscriptSessionSummary {
  sessionId: string;
  title: string;
  source: 'tiro' | 'mock';
  sourceLanguage: string;
  targetLanguage: string;
  captionCount: number;
  startedAt: number;
  updatedAt: number;
}

export interface TranscriptSessionRecord extends TranscriptSessionSummary {
  items: PersistedCaptionItem[];
}

export interface SaveSessionSnapshotInput {
  sessionId: string;
  source: 'tiro' | 'mock';
  sourceLanguage?: string;
  targetLanguage?: string;
  startedAt?: number;
  items: PersistedCaptionItem[];
}

export interface SessionTranscriptStoreOptions {
  baseDir?: string;
  inMemory?: boolean;
  maxSessions?: number;
}

function sanitizeSessionId(raw: string): string {
  const clean = raw.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
  return clean || `session-${Date.now()}`;
}

function deriveSessionTitle(items: readonly PersistedCaptionItem[]): string {
  const firstMeaningful = items.find((item) => item.englishText.trim().length > 0);
  if (!firstMeaningful) return '빈 자막 세션';
  const preview = (firstMeaningful.koreanText?.trim() || firstMeaningful.englishText.trim())
    .replace(/\s+/g, ' ')
    .slice(0, 56);
  return preview.length >= 56 ? `${preview}…` : preview;
}

/**
 * Crash-safe persistent session journal for bilingual presentation transcripts.
 * Uses atomic write-then-rename (with Windows NTFS fallback) and automatic pruning.
 */
export class SessionTranscriptStore {
  private readonly baseDir: string | null;
  private readonly inMemory: boolean;
  private readonly maxSessions: number;
  private readonly memorySessions = new Map<string, TranscriptSessionRecord>();

  constructor(options: SessionTranscriptStoreOptions = {}) {
    this.inMemory = Boolean(options.inMemory);
    this.maxSessions = Math.max(3, options.maxSessions ?? 20);
    this.baseDir = this.inMemory
      ? null
      : (options.baseDir ?? path.join(app.getPath('userData'), 'sessions'));

    if (!this.inMemory && this.baseDir) {
      try {
        fs.mkdirSync(this.baseDir, { recursive: true });
      } catch (err) {
        console.error('[session-store] failed to create sessions directory', err);
      }
    }
  }

  public getSessionsDir(): string | null {
    return this.baseDir;
  }

  private resolveSessionPath(sessionId: string): string | null {
    if (!this.baseDir) return null;
    return path.join(this.baseDir, `${sanitizeSessionId(sessionId)}.json`);
  }

  public saveSnapshot(input: SaveSessionSnapshotInput): TranscriptSessionSummary | null {
    const safeId = sanitizeSessionId(input.sessionId);
    const items = Array.isArray(input.items) ? input.items : [];
    if (items.length === 0) {
      return null;
    }

    const now = Date.now();
    const existing = this.loadSession(safeId);
    const startedAt = existing?.startedAt ?? input.startedAt ?? items[0]?.createdAt ?? now;

    const record: TranscriptSessionRecord = {
      sessionId: safeId,
      title: deriveSessionTitle(items),
      source: input.source === 'tiro' ? 'tiro' : 'mock',
      sourceLanguage: input.sourceLanguage || 'auto',
      targetLanguage: input.targetLanguage || 'ko',
      captionCount: items.length,
      startedAt,
      updatedAt: now,
      items
    };

    if (this.inMemory || !this.baseDir) {
      this.memorySessions.set(safeId, record);
      this.pruneOldSessions();
      return this.toSummary(record);
    }

    const targetPath = this.resolveSessionPath(safeId);
    if (!targetPath) return null;

    const serialized = JSON.stringify(record, null, 2);
    const tmpPath = `${targetPath}.${process.pid}.tmp`;
    try {
      fs.mkdirSync(this.baseDir, { recursive: true });
      fs.writeFileSync(tmpPath, serialized, 'utf8');
      try {
        fs.renameSync(tmpPath, targetPath);
      } catch {
        // Windows NTFS fallback if an antivirus scanner briefly holds a handle on targetPath
        fs.writeFileSync(targetPath, serialized, 'utf8');
        try {
          fs.unlinkSync(tmpPath);
        } catch {
          // ignore
        }
      }
      this.pruneOldSessions();
      return this.toSummary(record);
    } catch (err) {
      console.error('[session-store] failed to save snapshot', err);
      try {
        if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
      } catch {
        // ignore
      }
      return null;
    }
  }

  public listSessions(): TranscriptSessionSummary[] {
    if (this.inMemory || !this.baseDir) {
      return Array.from(this.memorySessions.values())
        .map((r) => this.toSummary(r))
        .sort((a, b) => b.updatedAt - a.updatedAt);
    }

    try {
      if (!fs.existsSync(this.baseDir)) return [];
      const files = fs
        .readdirSync(this.baseDir)
        .filter((f) => f.endsWith('.json') && !f.endsWith('.tmp'));

      const summaries: TranscriptSessionSummary[] = [];
      for (const file of files) {
        try {
          const raw = fs.readFileSync(path.join(this.baseDir, file), 'utf8');
          const parsed = JSON.parse(raw) as Partial<TranscriptSessionRecord>;
          if (
            parsed &&
            typeof parsed.sessionId === 'string' &&
            Array.isArray(parsed.items) &&
            parsed.items.length > 0
          ) {
            summaries.push({
              sessionId: parsed.sessionId,
              title: typeof parsed.title === 'string' ? parsed.title : deriveSessionTitle(parsed.items),
              source: parsed.source === 'tiro' ? 'tiro' : 'mock',
              sourceLanguage: parsed.sourceLanguage || 'auto',
              targetLanguage: parsed.targetLanguage || 'ko',
              captionCount: parsed.items.length,
              startedAt: Number(parsed.startedAt) || parsed.items[0].createdAt || 0,
              updatedAt: Number(parsed.updatedAt) || 0
            });
          }
        } catch {
          // skip malformed file
        }
      }

      return summaries.sort((a, b) => b.updatedAt - a.updatedAt);
    } catch {
      return [];
    }
  }

  public loadSession(sessionId: string): TranscriptSessionRecord | null {
    const safeId = sanitizeSessionId(sessionId);
    if (this.inMemory || !this.baseDir) {
      return this.memorySessions.get(safeId) ?? null;
    }

    const targetPath = this.resolveSessionPath(safeId);
    if (!targetPath || !fs.existsSync(targetPath)) return null;

    try {
      const raw = fs.readFileSync(targetPath, 'utf8');
      const parsed = JSON.parse(raw) as TranscriptSessionRecord;
      if (!parsed || !Array.isArray(parsed.items)) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  public deleteSession(sessionId: string): boolean {
    const safeId = sanitizeSessionId(sessionId);
    if (this.inMemory || !this.baseDir) {
      return this.memorySessions.delete(safeId);
    }
    const targetPath = this.resolveSessionPath(safeId);
    if (!targetPath || !fs.existsSync(targetPath)) return false;
    try {
      fs.unlinkSync(targetPath);
      return true;
    } catch {
      return false;
    }
  }

  private pruneOldSessions(): void {
    const all = this.listSessions();
    if (all.length <= this.maxSessions) return;
    const toRemove = all.slice(this.maxSessions);
    for (const old of toRemove) {
      this.deleteSession(old.sessionId);
    }
  }

  private toSummary(record: TranscriptSessionRecord): TranscriptSessionSummary {
    return {
      sessionId: record.sessionId,
      title: record.title,
      source: record.source,
      sourceLanguage: record.sourceLanguage,
      targetLanguage: record.targetLanguage,
      captionCount: record.captionCount,
      startedAt: record.startedAt,
      updatedAt: record.updatedAt
    };
  }
}
