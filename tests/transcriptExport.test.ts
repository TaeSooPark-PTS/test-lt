import { describe, expect, it } from 'vitest';
import type { CaptionCardItem } from '../src/types/caption';
import {
  buildSuggestedExportFilename,
  formatSrtDuration,
  formatTranscript
} from '../src/utils/transcriptExport';

const SAMPLE_ITEMS: CaptionCardItem[] = [
  {
    id: 'utt-1',
    sequence: 1,
    englishText: 'Welcome to our live session.',
    koreanText: '실시간 세션에 오신 것을 환영합니다.',
    captionStatus: 'final',
    translationState: 'translated',
    createdAt: 1700000000000,
    updatedAt: 1700000000500
  },
  {
    id: 'utt-2',
    sequence: 2,
    englishText: 'Pipes | should | be | escaped in Markdown.',
    koreanText: '마크다운 파이프 | 문자 이스케이프 확인.',
    captionStatus: 'final',
    translationState: 'translated',
    createdAt: 1700000003500,
    updatedAt: 1700000004000
  }
];

describe('transcriptExport (Windows CRLF & Subtitle Formats)', () => {
  it('formats SubRip (.srt) timestamps and bilingual subtitle blocks with CRLF line endings', () => {
    expect(formatSrtDuration(0)).toBe('00:00:00,000');
    expect(formatSrtDuration(3723456)).toBe('01:02:03,456');

    const srt = formatTranscript(SAMPLE_ITEMS, 'srt');
    expect(srt).toContain('00:00:00,000 --> 00:00:03,420\r\nWelcome to our live session.\r\n실시간 세션에 오신 것을 환영합니다.');
    expect(srt).toContain('2\r\n00:00:03,500 --> 00:00:07,500');
  });

  it('escapes Markdown table pipes and uses CRLF line endings', () => {
    const md = formatTranscript(SAMPLE_ITEMS, 'md');
    expect(md).toContain('# Tiro Live Bilingual Transcript');
    expect(md).toContain('Pipes \\| should \\| be \\| escaped in Markdown.');
    expect(md).toContain('\r\n');
  });

  it('formats TXT and JSON exports cleanly', () => {
    const txt = formatTranscript(SAMPLE_ITEMS, 'txt');
    expect(txt).toContain('[EN] Welcome to our live session.');
    expect(txt).toContain('[KO] 실시간 세션에 오신 것을 환영합니다.');

    const json = JSON.parse(formatTranscript(SAMPLE_ITEMS, 'json')) as Array<{
      sequence: number;
      english: string;
      korean: string;
    }>;
    expect(json).toHaveLength(2);
    expect(json[0].korean).toBe('실시간 세션에 오신 것을 환영합니다.');
  });

  it('builds timestamped suggested filenames', () => {
    const name = buildSuggestedExportFilename('srt', new Date(2026, 10, 2, 14, 5));
    expect(name).toBe('tiro-bilingual-captions-20261102-1405.srt');
  });
});
