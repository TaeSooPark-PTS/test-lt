import type { CaptionCardItem } from '../types/caption';
import type { TranscriptExportFormat } from '../types/electron';

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function pad3(n: number): string {
  return String(n).padStart(3, '0');
}

export function formatClockTime(timestampMs: number): string {
  const d = new Date(timestampMs);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

export function formatSrtDuration(offsetMs: number): string {
  const safe = Math.max(0, Math.round(offsetMs));
  const hours = Math.floor(safe / 3600000);
  const minutes = Math.floor((safe % 3600000) / 60000);
  const seconds = Math.floor((safe % 60000) / 1000);
  const millis = safe % 1000;
  return `${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)},${pad3(millis)}`;
}

export function buildSuggestedExportFilename(
  format: TranscriptExportFormat,
  now = new Date()
): string {
  const yyyy = now.getFullYear();
  const mm = pad2(now.getMonth() + 1);
  const dd = pad2(now.getDate());
  const hh = pad2(now.getHours());
  const min = pad2(now.getMinutes());
  return `tiro-bilingual-captions-${yyyy}${mm}${dd}-${hh}${min}.${format}`;
}

export function formatTranscript(
  items: readonly CaptionCardItem[],
  format: TranscriptExportFormat
): string {
  if (format === 'json') {
    return JSON.stringify(
      items.map((item) => ({
        sequence: item.sequence,
        id: item.id,
        timestamp: new Date(item.createdAt).toISOString(),
        status: item.captionStatus,
        english: item.englishText,
        korean: item.koreanText ?? ''
      })),
      null,
      2
    );
  }

  if (format === 'srt') {
    if (items.length === 0) return '';
    const baseTime = items[0].createdAt;
    return items
      .map((item, idx) => {
        const startOffset = Math.max(0, item.createdAt - baseTime);
        const nextItem = items[idx + 1];
        const rawEnd = nextItem
          ? Math.max(startOffset + 1200, nextItem.createdAt - baseTime - 80)
          : startOffset + 4000;
        const lines = [
          String(idx + 1),
          `${formatSrtDuration(startOffset)} --> ${formatSrtDuration(rawEnd)}`,
          item.englishText
        ];
        if (item.koreanText) {
          lines.push(item.koreanText);
        }
        return lines.join('\r\n');
      })
      .join('\r\n\r\n');
  }

  if (format === 'md') {
    const header = [
      '# Tiro Live Bilingual Transcript',
      '',
      `- Total Utterances: ${items.length}`,
      items.length > 0 ? `- Recorded At: ${new Date(items[0].createdAt).toLocaleString('ko-KR')}` : '',
      '',
      '| # | Time | English (Source) | 한국어 (Translation) |',
      '| --- | --- | --- | --- |'
    ].filter(Boolean);

    const rows = items.map((item) => {
      const en = item.englishText.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
      const ko = (item.koreanText ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
      return `| ${item.sequence} | ${formatClockTime(item.createdAt)} | ${en} | ${ko} |`;
    });

    return [...header, ...rows, ''].join('\r\n');
  }

  // Default 'txt' (CRLF for Windows Notepad compatibility)
  return items
    .map((item) => {
      const time = formatClockTime(item.createdAt);
      const ko = item.koreanText ? `\r\n    [KO] ${item.koreanText}` : '';
      return `[${time}] #${item.sequence}\r\n    [EN] ${item.englishText}${ko}`;
    })
    .join('\r\n\r\n');
}
