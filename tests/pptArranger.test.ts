import { describe, expect, it } from 'vitest';
import {
  buildPowerPointArrangeScript,
  parsePowerPointScriptOutput,
  PPT_REASON_MESSAGES
} from '../electron/pptArranger';

describe('Windows PowerPoint Arranger (pptArranger)', () => {
  it('builds valid UTF-16LE encodable PowerShell script with DPI awareness and COM fallback', () => {
    const script = buildPowerPointArrangeScript(
      { x: 1920, y: 0, width: 1382, height: 1040 },
      true,
      true
    );

    expect(script).toContain('$X = 1920');
    expect(script).toContain('$Y = 0');
    expect(script).toContain('$W = 1382');
    expect(script).toContain('$H = 1040');
    expect(script).toContain('$Borderless = $true');
    expect(script).toContain('$StartIfMissing = $true');
    expect(script).toContain('SetProcessDpiAwarenessContext');
    expect(script).toContain('ShowType = 2');
    expect(script).toContain('슬라이드 쇼');
    expect(script).toContain('Slide Show');

    // Verify UTF-16LE Base64 roundtrip used by powershell.exe -EncodedCommand on Windows
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    const decoded = Buffer.from(encoded, 'base64').toString('utf16le');
    expect(decoded).toBe(script);
  });

  it('parses Windows CRLF stdout with leading warning lines when slideshow succeeds', () => {
    const stdout = [
      'WARNING: Some Office telemetry banner',
      '{"ok":true,"started":true,"title":"PowerPoint 슬라이드 쇼 - [Deck.pptx]","cls":"PPTFrameClass"}',
      ''
    ].join('\r\n');

    const result = parsePowerPointScriptOutput(stdout);
    expect(result.ok).toBe(true);
    expect(result.startedSlideshow).toBe(true);
    expect(result.windowClass).toBe('PPTFrameClass');
    expect(result.windowTitle).toContain('Deck.pptx');
  });

  it('maps each machine-readable failure reason to localized Korean guidance', () => {
    const reasons = [
      'powerpoint-not-running',
      'no-presentation',
      'window-not-found'
    ] as const;

    for (const reason of reasons) {
      const res = parsePowerPointScriptOutput(JSON.stringify({ ok: false, reason }));
      expect(res.ok).toBe(false);
      expect(res.reason).toBe(reason);
      expect(res.message).toBe(PPT_REASON_MESSAGES[reason]);
    }
  });

  it('handles empty stdout or script crash gracefully', () => {
    const res = parsePowerPointScriptOutput('', 'Access is denied', 'Command failed');
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('script-error');
    expect(res.message).toContain('Access is denied');
  });
});
