import { execFile } from 'child_process';
import { screen } from 'electron';

export interface ScreenRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PptArrangeResult {
  ok: boolean;
  /** Short machine-readable reason when ok=false. */
  reason?:
    | 'unsupported-platform'
    | 'powerpoint-not-running'
    | 'no-presentation'
    | 'window-not-found'
    | 'script-error';
  message: string;
  startedSlideshow?: boolean;
  windowTitle?: string;
  windowClass?: string;
}

/**
 * PowerShell + inline C# (user32) script for Windows 10/11 + Office 2016/2019/2021/365.
 *  1. Find a visible PowerPoint slideshow window (class "screenClass" or title containing localized Slide Show tokens).
 *  2. If none and $StartIfMissing, snapshot existing POWERPNT HWNDs, attach to PowerPoint COM, and launch the active
 *     presentation as a *windowed* slideshow (ppShowTypeWindow = 2, "Browsed by an individual (window)").
 *     Any newly spawned visible POWERPNT top-level window is matched deterministically across all Office UI languages.
 *  3. Strip or restore WS_CAPTION | WS_THICKFRAME (eliminating Windows 10/11 invisible 7px DWM resize borders when borderless),
 *     then SetWindowPos to exact Per-Monitor DPI v2 physical pixels on the target projector display.
 */
const PS_SCRIPT_BODY = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class PptWin {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int w, int hh, uint flags);
  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h, int idx);
  [DllImport("user32.dll")] public static extern int SetWindowLong(IntPtr h, int idx, int v);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr v);

  public static string ClassOf(IntPtr h) { var sb = new StringBuilder(256); GetClassName(h, sb, 256); return sb.ToString(); }
  public static string TitleOf(IntPtr h) { var sb = new StringBuilder(512); GetWindowText(h, sb, 512); return sb.ToString(); }

  public static IntPtr[] ListVisibleWindows(uint[] pids) {
    var list = new List<IntPtr>();
    var set = new HashSet<uint>(pids);
    EnumWindows(delegate(IntPtr h, IntPtr l) {
      if (!IsWindowVisible(h)) return true;
      uint pid; GetWindowThreadProcessId(h, out pid);
      if (set.Contains(pid)) list.Add(h);
      return true;
    }, IntPtr.Zero);
    return list.ToArray();
  }

  public static IntPtr FindSlideshow(uint[] pids, IntPtr[] beforeHwnds) {
    IntPtr best = IntPtr.Zero; int bestScore = 0;
    var set = new HashSet<uint>(pids);
    var before = new HashSet<IntPtr>(beforeHwnds ?? new IntPtr[0]);
    EnumWindows(delegate(IntPtr h, IntPtr l) {
      if (!IsWindowVisible(h)) return true;
      uint pid; GetWindowThreadProcessId(h, out pid);
      if (!set.Contains(pid)) return true;
      string cls = ClassOf(h); string title = TitleOf(h);
      int score = 0;
      if (beforeHwnds != null && beforeHwnds.Length > 0 && !before.Contains(h) && (cls == "PPTFrameClass" || cls == "screenClass")) {
        score = 4;
      } else if (cls == "screenClass") {
        score = 3;
      } else if (title.IndexOf("Slide Show", StringComparison.OrdinalIgnoreCase) >= 0 || title.Contains("슬라이드 쇼") || title.Contains("슬라이드쇼")) {
        score = 3;
      }
      if (score > bestScore) { bestScore = score; best = h; }
      return true;
    }, IntPtr.Zero);
    return best;
  }

  public static void Place(IntPtr h, int x, int y, int w, int hh, bool borderless) {
    ShowWindow(h, 9); // SW_RESTORE
    int style = GetWindowLong(h, -16);
    if (borderless) {
      style &= ~(0x00C00000 | 0x00040000); // Strip WS_CAPTION | WS_THICKFRAME
    } else {
      style |= (0x00C00000 | 0x00040000);
    }
    SetWindowLong(h, -16, style);
    SetWindowPos(h, IntPtr.Zero, x, y, w, hh, 0x0020 | 0x0040); // SWP_FRAMECHANGED | SWP_SHOWWINDOW
    SetForegroundWindow(h);
  }
}
"@

try { [void][PptWin]::SetProcessDpiAwarenessContext([IntPtr](-4)) } catch {}

function Out-Result($obj) { $obj | ConvertTo-Json -Compress | Write-Output }

$procs = @(Get-Process -Name POWERPNT -ErrorAction SilentlyContinue)
if ($procs.Count -eq 0) { Out-Result @{ ok = $false; reason = 'powerpoint-not-running' }; exit 0 }
$pids = [uint32[]]@($procs | ForEach-Object { [uint32]$_.Id })

$started = $false
$hwnd = [PptWin]::FindSlideshow($pids, $null)
if ($hwnd -eq [IntPtr]::Zero -and $StartIfMissing) {
  $before = [PptWin]::ListVisibleWindows($pids)
  $app = $null
  try {
    $app = [System.Runtime.InteropServices.Marshal]::GetActiveObject('PowerPoint.Application')
  } catch {
    try {
      $app = New-Object -ComObject PowerPoint.Application
    } catch {
      Out-Result @{ ok = $false; reason = 'powerpoint-not-running' }; exit 0
    }
  }
  if ($null -eq $app -or $app.Presentations.Count -lt 1) { Out-Result @{ ok = $false; reason = 'no-presentation' }; exit 0 }
  $pres = $app.ActivePresentation
  $pres.SlideShowSettings.ShowType = 2   # ppShowTypeWindow (웹 형식으로 보기 - 창)
  [void]$pres.SlideShowSettings.Run()
  $started = $true
  for ($i = 0; $i -lt 35 -and $hwnd -eq [IntPtr]::Zero; $i++) {
    Start-Sleep -Milliseconds 150
    $hwnd = [PptWin]::FindSlideshow($pids, $before)
  }
}
if ($hwnd -eq [IntPtr]::Zero) { Out-Result @{ ok = $false; reason = 'window-not-found'; started = $started }; exit 0 }

[PptWin]::Place($hwnd, $X, $Y, $W, $H, $Borderless)
Out-Result @{ ok = $true; started = $started; title = [PptWin]::TitleOf($hwnd); cls = [PptWin]::ClassOf($hwnd) }
`;

export function buildPowerPointArrangeScript(
  rect: ScreenRect,
  borderless: boolean,
  startIfMissing: boolean
): string {
  const header = [
    `$X = ${Math.round(rect.x)}`,
    `$Y = ${Math.round(rect.y)}`,
    `$W = ${Math.max(100, Math.round(rect.width))}`,
    `$H = ${Math.max(100, Math.round(rect.height))}`,
    `$Borderless = $${borderless ? 'true' : 'false'}`,
    `$StartIfMissing = $${startIfMissing ? 'true' : 'false'}`
  ].join('\n');
  return `${header}\n${PS_SCRIPT_BODY}`;
}

export const PPT_REASON_MESSAGES: Record<NonNullable<PptArrangeResult['reason']>, string> = {
  'unsupported-platform': 'PowerPoint 창 자동 정렬은 Windows 10/11에서 동작합니다. (현재 OS에서는 우측 자막 사이드바 배치만 적용됨)',
  'powerpoint-not-running': 'PowerPoint가 실행 중이 아닙니다. 발표할 PPTX 파일을 먼저 열어주세요.',
  'no-presentation': 'PowerPoint에 열린 프레젠테이션이 없습니다.',
  'window-not-found':
    '슬라이드쇼 창을 찾지 못했습니다. [슬라이드 쇼] → [슬라이드 쇼 설정] → "웹 형식으로 보기(창)"로 시작했는지 확인하세요.',
  'script-error': 'PowerPoint 배치 스크립트 실행 중 오류가 발생했습니다.'
};

export function parsePowerPointScriptOutput(
  stdout: string,
  stderr = '',
  errorMessage = ''
): PptArrangeResult {
  const line = String(stdout || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.startsWith('{') && l.endsWith('}'))
    .pop();

  if (!line) {
    const detail = String(stderr || errorMessage || '').trim().slice(0, 200);
    return {
      ok: false,
      reason: 'script-error',
      message: detail ? `${PPT_REASON_MESSAGES['script-error']} (${detail})` : PPT_REASON_MESSAGES['script-error']
    };
  }

  try {
    const parsed = JSON.parse(line) as {
      ok: boolean;
      reason?: PptArrangeResult['reason'];
      started?: boolean;
      title?: string;
      cls?: string;
    };
    if (parsed.ok) {
      return {
        ok: true,
        message: parsed.started
          ? 'PowerPoint 슬라이드쇼를 창 모드로 자동 실행하고 프로젝터 왼쪽 영역에 배치했습니다.'
          : 'PowerPoint 슬라이드쇼 창을 프로젝터 왼쪽 영역에 정확히 배치했습니다.',
        startedSlideshow: Boolean(parsed.started),
        windowTitle: parsed.title,
        windowClass: parsed.cls
      };
    }
    const reason = parsed.reason && parsed.reason in PPT_REASON_MESSAGES ? parsed.reason : 'script-error';
    return {
      ok: false,
      reason,
      message: PPT_REASON_MESSAGES[reason]
    };
  } catch {
    return {
      ok: false,
      reason: 'script-error',
      message: PPT_REASON_MESSAGES['script-error']
    };
  }
}

/**
 * Moves the PowerPoint slideshow window into `rectDip` (Electron DIP coordinates on the projector).
 */
export function arrangePowerPoint(
  rectDip: ScreenRect,
  options: { borderless: boolean; startIfMissing: boolean }
): Promise<PptArrangeResult> {
  if (process.platform !== 'win32') {
    return Promise.resolve({
      ok: false,
      reason: 'unsupported-platform',
      message: PPT_REASON_MESSAGES['unsupported-platform']
    });
  }

  // Win32 SetWindowPos expects physical pixels; Electron gives DIPs (differs when Windows scaling != 100%).
  const physical = screen.dipToScreenRect(null, rectDip);
  const script = buildPowerPointArrangeScript(physical, options.borderless, options.startIfMissing);
  const encoded = Buffer.from(script, 'utf16le').toString('base64');

  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      { windowsHide: true, timeout: 22000 },
      (error, stdout, stderr) => {
        if (!stdout && error) {
          console.error('[ppt] script failed', error, stderr);
        }
        resolve(parsePowerPointScriptOutput(String(stdout || ''), String(stderr || ''), error?.message ?? ''));
      }
    );
  });
}
