import { ipcRenderer } from 'electron';

interface TrackedUtterance {
  id: string;
  lastText: string;
  finalized: boolean;
  lastMutatedAt: number;
  finalizeTimer: ReturnType<typeof setTimeout> | null;
}

interface RadarEntry {
  el: Element;
  selector: string;
  tagSummary: string;
  mutationCount: number;
  sampleText: string;
  lastUpdatedAt: number;
}

const COALESCE_MS = 35;
const FINALIZE_QUIET_MS = 1100;

function isAllowedInspectionHost(): boolean {
  const { protocol, hostname } = window.location;
  if (protocol === 'file:') return true;
  if (hostname === 'localhost' || hostname === '127.0.0.1') return true;
  if (hostname === 'tiro.ooo' || hostname.endsWith('.tiro.ooo')) return true;
  if (hostname === 'tiro.ax' || hostname.endsWith('.tiro.ax')) return true;
  return false;
}

function isLoginOrAuthLocation(): boolean {
  const { hostname, pathname } = window.location;
  if (
    hostname.includes('google.com') ||
    hostname.includes('microsoftonline.com') ||
    hostname.includes('live.com') ||
    hostname.includes('apple.com') ||
    hostname.includes('auth0.com')
  ) {
    return true;
  }
  return /^\/(ko\/|en\/|ja\/)?(login|signin|auth)(\/|$)/i.test(pathname);
}

function normalizeCaptionText(raw: string | null | undefined): string {
  if (!raw) return '';
  return raw.replace(/\s+/g, ' ').trim();
}

function summarizeElement(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const idPart = el.id ? `#${el.id}` : '';
  const testId = el.getAttribute('data-testid');
  const role = el.getAttribute('role');
  const classes = Array.from(el.classList)
    .filter((c) => c && c.length < 32)
    .slice(0, 2)
    .map((c) => `.${c}`)
    .join('');
  const attrs = [
    testId ? `[data-testid="${testId}"]` : '',
    role ? `[role="${role}"]` : ''
  ].join('');
  return `${tag}${idPart}${classes}${attrs}`;
}

function cssEscapeIdent(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value);
  }
  return value.replace(/([^a-zA-Z0-9_-])/g, '\\$1');
}

function computeSelector(target: Element): string {
  if (target === document.body) return 'body';
  if (target.id) {
    const escapedId = `#${cssEscapeIdent(target.id)}`;
    if (document.querySelectorAll(escapedId).length === 1) {
      return escapedId;
    }
  }

  const parts: string[] = [];
  let current: Element | null = target;

  while (current && current !== document.body && current !== document.documentElement) {
    const testId = current.getAttribute('data-testid');
    if (testId) {
      const candidate = `${current.tagName.toLowerCase()}[data-testid="${cssEscapeIdent(testId)}"]`;
      parts.unshift(candidate);
      const joined = parts.join(' > ');
      if (document.querySelectorAll(joined).length === 1) {
        return joined;
      }
      current = current.parentElement;
      continue;
    }

    if (current.id) {
      parts.unshift(`#${cssEscapeIdent(current.id)}`);
      return parts.join(' > ');
    }

    const tag = current.tagName.toLowerCase();
    const parentEl: Element | null = current.parentElement;
    if (!parentEl) {
      parts.unshift(tag);
      break;
    }

    const currentTagName = current.tagName;
    const sameTagSiblings = Array.from(parentEl.children).filter(
      (sib: Element) => sib.tagName === currentTagName
    );
    if (sameTagSiblings.length > 1) {
      const idx = sameTagSiblings.indexOf(current) + 1;
      parts.unshift(`${tag}:nth-of-type(${idx})`);
    } else {
      parts.unshift(tag);
    }

    const candidateSelector = `body > ${parts.join(' > ')}`;
    if (parentEl === document.body && document.querySelectorAll(candidateSelector).length === 1) {
      return candidateSelector;
    }

    current = parentEl;
  }

  return parts.length > 0 ? parts.join(' > ') : 'body';
}

function isContinuationText(prevText: string, nextText: string): boolean {
  if (!prevText || !nextText) return false;
  if (nextText.startsWith(prevText)) return true;
  if (prevText.startsWith(nextText) && nextText.length >= Math.floor(prevText.length * 0.6)) {
    return true;
  }
  const minLen = Math.min(prevText.length, nextText.length);
  if (minLen < 8) return false;
  const sharedPrefixTarget = Math.floor(minLen * 0.65);
  return nextText.slice(0, sharedPrefixTarget) === prevText.slice(0, sharedPrefixTarget);
}

// ============================================================================
// 1. DOM Diagnostics
// ============================================================================
function collectDomDiagnostics() {
  const allowed = isAllowedInspectionHost();
  const loginOrAuth = isLoginOrAuthLocation();

  if (!allowed) {
    return {
      timestamp: Date.now(),
      url: window.location.href,
      title: document.title || '',
      isAllowedHost: false,
      isLoginOrAuthPage: true,
      domAccessible: false,
      totalElements: 0,
      textBearingElements: 0,
      canvasCount: 0,
      iframeUrls: [],
      openShadowRootCount: 0,
      ariaLiveDescriptors: [],
      notes: [
        '현재 외부 인증 도메인(OAuth/SSO) 화면에 있으므로 보안 정책에 따라 DOM 수집기를 비활성화했습니다.',
        '로그인 완료 후 tiro.ooo 화면으로 돌아오면 DOM 진단이 활성화됩니다.'
      ]
    };
  }

  const allElements = Array.from(document.querySelectorAll('*'));
  let textBearingCount = 0;
  let openShadowCount = 0;

  for (const el of allElements) {
    if ((el as HTMLElement).shadowRoot) {
      openShadowCount += 1;
    }
    const directText = Array.from(el.childNodes)
      .filter((n) => n.nodeType === Node.TEXT_NODE)
      .map((n) => (n.textContent || '').trim())
      .join('');
    if (directText.length > 0) {
      textBearingCount += 1;
    }
  }

  const canvases = document.querySelectorAll('canvas').length;
  const iframes = Array.from(document.querySelectorAll('iframe')).map(
    (f) => f.getAttribute('src') || '(inline/about:blank)'
  );
  const ariaLive = Array.from(
    document.querySelectorAll('[aria-live], [role="log"], [role="status"]')
  )
    .slice(0, 10)
    .map((el) => summarizeElement(el));

  const notes: string[] = [];
  if (loginOrAuth) {
    notes.push('현재 로그인 화면입니다. Tiro 계정으로 로그인한 뒤 실시간 음성 인식 세션을 시작하세요.');
  } else {
    notes.push('tiro.ooo 워크스페이스 DOM 접근이 가능합니다.');
  }
  if (canvases > 0) {
    notes.push(`페이지 내 <canvas> 요소가 ${canvases}개 존재합니다. 자막이 DOM 텍스트인지 Radar로 확인하세요.`);
  }
  if (iframes.length > 0) {
    notes.push(`페이지 내 <iframe> 요소가 ${iframes.length}개 존재합니다.`);
  }

  return {
    timestamp: Date.now(),
    url: window.location.href,
    title: document.title || '',
    isAllowedHost: true,
    isLoginOrAuthPage: loginOrAuth,
    domAccessible: Boolean(document.body),
    totalElements: allElements.length,
    textBearingElements: textBearingCount,
    canvasCount: canvases,
    iframeUrls: iframes,
    openShadowRootCount: openShadowCount,
    ariaLiveDescriptors: ariaLive,
    notes
  };
}

// ============================================================================
// 2. Mutation Radar (Zero-Assumption Live Caption Element Discovery)
// ============================================================================
let radarObserver: MutationObserver | null = null;
let radarFlushTimer: ReturnType<typeof setInterval> | null = null;
const radarMap = new Map<Element, RadarEntry>();

function resolveMeaningfulContainer(node: Node): Element | null {
  let el: Element | null =
    node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  if (!el) return null;

  // Ignore our own inspector overlay if present
  if (el.closest('[data-tiro-poc-overlay="true"]')) return null;

  // Climb from inline formatting tags (span, b, i, font) to block/container parent
  while (
    el.parentElement &&
    el.parentElement !== document.body &&
    ['SPAN', 'STRONG', 'EM', 'B', 'I', 'SMALL', 'MARK'].includes(el.tagName)
  ) {
    el = el.parentElement;
  }

  // If this block is one item inside a repeating transcript list, prefer its list container
  if (el.parentElement && el.parentElement !== document.body && el.parentElement.children.length >= 2) {
    return el.parentElement;
  }

  return el;
}

function flushRadarCandidates(): void {
  const candidates = Array.from(radarMap.values())
    .filter((entry) => document.contains(entry.el) && entry.sampleText.length > 0)
    .sort((a, b) => b.mutationCount - a.mutationCount || b.lastUpdatedAt - a.lastUpdatedAt)
    .slice(0, 6)
    .map((entry) => ({
      selector: computeSelector(entry.el),
      tagSummary: entry.tagSummary,
      mutationCount: entry.mutationCount,
      childBlockCount: entry.el.children.length,
      sampleText: entry.sampleText.slice(-160),
      lastUpdatedAt: entry.lastUpdatedAt
    }));

  ipcRenderer.send('tiro-preload:radar-candidates', candidates);
}

function startMutationRadar(): void {
  stopMutationRadar();
  if (!isAllowedInspectionHost() || !document.body) return;

  radarMap.clear();
  radarObserver = new MutationObserver((mutations) => {
    const now = Date.now();
    for (const m of mutations) {
      const container = resolveMeaningfulContainer(m.target);
      if (!container) continue;
      const text = normalizeCaptionText((container as HTMLElement).innerText || container.textContent);
      if (!text) continue;

      const existing = radarMap.get(container);
      if (existing) {
        if (existing.sampleText !== text) {
          existing.mutationCount += 1;
          existing.sampleText = text;
          existing.lastUpdatedAt = now;
        }
      } else {
        radarMap.set(container, {
          el: container,
          selector: computeSelector(container),
          tagSummary: summarizeElement(container),
          mutationCount: 1,
          sampleText: text,
          lastUpdatedAt: now
        });
      }
    }
  });

  radarObserver.observe(document.body, {
    subtree: true,
    childList: true,
    characterData: true
  });

  radarFlushTimer = setInterval(flushRadarCandidates, 600);
}

function stopMutationRadar(): void {
  if (radarObserver) {
    radarObserver.disconnect();
    radarObserver = null;
  }
  if (radarFlushTimer) {
    clearInterval(radarFlushTimer);
    radarFlushTimer = null;
  }
}

// ============================================================================
// 3. Visual Interactive DOM Element Picker
// ============================================================================
let pickerActive = false;
let pickerOverlay: HTMLDivElement | null = null;
let pickerLabel: HTMLDivElement | null = null;
let lastPickedElement: Element | null = null;

function ensurePickerOverlay(): void {
  if (pickerOverlay && document.contains(pickerOverlay)) return;

  pickerOverlay = document.createElement('div');
  pickerOverlay.setAttribute('data-tiro-poc-overlay', 'true');
  Object.assign(pickerOverlay.style, {
    position: 'fixed',
    pointerEvents: 'none',
    zIndex: '2147483646',
    border: '2px solid #38bdf8',
    backgroundColor: 'rgba(56, 189, 248, 0.14)',
    borderRadius: '4px',
    transition: 'all 40ms ease',
    display: 'none'
  });

  pickerLabel = document.createElement('div');
  pickerLabel.setAttribute('data-tiro-poc-overlay', 'true');
  Object.assign(pickerLabel.style, {
    position: 'fixed',
    pointerEvents: 'none',
    zIndex: '2147483647',
    backgroundColor: '#0f172a',
    color: '#e2e8f0',
    border: '1px solid #38bdf8',
    borderRadius: '4px',
    padding: '3px 7px',
    fontSize: '11px',
    fontFamily: 'monospace',
    maxWidth: '420px',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    display: 'none'
  });

  document.body.appendChild(pickerOverlay);
  document.body.appendChild(pickerLabel);
}

function removePickerOverlay(): void {
  pickerOverlay?.remove();
  pickerLabel?.remove();
  pickerOverlay = null;
  pickerLabel = null;
}

function handlePickerMouseMove(e: MouseEvent): void {
  if (!pickerActive) return;
  const target = document.elementFromPoint(e.clientX, e.clientY);
  if (!target || target.closest('[data-tiro-poc-overlay="true"]')) return;

  ensurePickerOverlay();
  const rect = target.getBoundingClientRect();
  if (pickerOverlay && pickerLabel) {
    pickerOverlay.style.display = 'block';
    pickerOverlay.style.left = `${rect.left}px`;
    pickerOverlay.style.top = `${rect.top}px`;
    pickerOverlay.style.width = `${rect.width}px`;
    pickerOverlay.style.height = `${rect.height}px`;

    const sample = normalizeCaptionText((target as HTMLElement).innerText || target.textContent).slice(
      0,
      48
    );
    pickerLabel.style.display = 'block';
    pickerLabel.style.left = `${Math.max(6, Math.min(window.innerWidth - 320, rect.left))}px`;
    pickerLabel.style.top = `${Math.max(6, rect.top - 26)}px`;
    pickerLabel.textContent = `${summarizeElement(target)}${sample ? ` · "${sample}"` : ''}`;
  }
}

function buildPickedInfo(el: Element) {
  const selector = computeSelector(el);
  const parent =
    el.parentElement && el.parentElement !== document.body ? el.parentElement : null;
  return {
    selector,
    parentSelector: parent ? computeSelector(parent) : null,
    tagSummary: summarizeElement(el),
    childElementCount: el.children.length,
    sampleText: normalizeCaptionText((el as HTMLElement).innerText || el.textContent).slice(0, 240)
  };
}

function handlePickerClick(e: MouseEvent): void {
  if (!pickerActive) return;
  e.preventDefault();
  e.stopPropagation();

  const target = document.elementFromPoint(e.clientX, e.clientY);
  stopElementPicker();

  if (!target || target.closest('[data-tiro-poc-overlay="true"]')) return;
  lastPickedElement = target;

  const info = buildPickedInfo(target);
  ipcRenderer.send('tiro-preload:element-picked', info);
}

function handlePickerKeyDown(e: KeyboardEvent): void {
  if (pickerActive && e.key === 'Escape') {
    e.preventDefault();
    stopElementPicker();
    ipcRenderer.send('tiro-preload:picker-cancelled');
  }
}

function startElementPicker(): void {
  if (!isAllowedInspectionHost() || !document.body) return;
  pickerActive = true;
  ensurePickerOverlay();
  window.addEventListener('mousemove', handlePickerMouseMove, true);
  window.addEventListener('click', handlePickerClick, true);
  window.addEventListener('keydown', handlePickerKeyDown, true);
}

function stopElementPicker(): void {
  pickerActive = false;
  window.removeEventListener('mousemove', handlePickerMouseMove, true);
  window.removeEventListener('click', handlePickerClick, true);
  window.removeEventListener('keydown', handlePickerKeyDown, true);
  removePickerOverlay();
}

function selectParentOfPicked(): void {
  if (!lastPickedElement || !lastPickedElement.parentElement) return;
  if (lastPickedElement.parentElement === document.documentElement) return;
  lastPickedElement = lastPickedElement.parentElement;
  const info = buildPickedInfo(lastPickedElement);
  ipcRenderer.send('tiro-preload:element-picked', info);
}

// ============================================================================
// 4. MutationObserver Caption Extractor Engine
// ============================================================================
let captionObserver: MutationObserver | null = null;
let coalesceTimer: ReturnType<typeof setTimeout> | null = null;
let activeSelector: string | null = null;
let pendingMutationTimestamp: number | null = null;
let utteranceIdSeed = 0;

let trackedByNode = new WeakMap<Element, TrackedUtterance>();
let activeUtterance: TrackedUtterance | null = null;
let recentFinalizedTexts: string[] = [];

const telemetry = {
  observing: false,
  targetSelector: null as string | null,
  mode: 'idle' as 'idle' | 'container-blocks' | 'single-node',
  emittedCount: 0,
  interimCount: 0,
  finalCount: 0,
  dedupedCount: 0,
  lastLatencyMs: null as number | null,
  avgLatencyMs: null as number | null,
  lastSampleText: '',
  errorMessage: undefined as string | undefined
};

function sendTelemetry(): void {
  ipcRenderer.send('tiro-preload:telemetry', { ...telemetry });
}

function createUtteranceId(): string {
  utteranceIdSeed += 1;
  return `tiro-utt-${Date.now()}-${utteranceIdSeed}`;
}

function rememberFinalizedText(text: string): void {
  recentFinalizedTexts.push(text);
  if (recentFinalizedTexts.length > 40) {
    recentFinalizedTexts.shift();
  }
}

function emitCaptionPayload(
  utt: TrackedUtterance,
  text: string,
  isFinal: boolean,
  mutationAt: number
): void {
  const clean = normalizeCaptionText(text);
  if (!clean) return;

  if (!isFinal && utt.lastText === clean) {
    telemetry.dedupedCount += 1;
    sendTelemetry();
    return;
  }

  if (isFinal && utt.finalized && utt.lastText === clean) {
    telemetry.dedupedCount += 1;
    sendTelemetry();
    return;
  }

  utt.lastText = clean;
  if (isFinal) {
    utt.finalized = true;
    if (utt.finalizeTimer) {
      clearTimeout(utt.finalizeTimer);
      utt.finalizeTimer = null;
    }
    rememberFinalizedText(clean);
    if (activeUtterance?.id === utt.id) {
      activeUtterance = null;
    }
  } else {
    activeUtterance = utt;
  }

  const preloadEmitAt = Date.now();
  telemetry.emittedCount += 1;
  if (isFinal) {
    telemetry.finalCount += 1;
  } else {
    telemetry.interimCount += 1;
  }
  telemetry.lastSampleText = clean.slice(-140);

  ipcRenderer.send('tiro-preload:caption', {
    id: utt.id,
    text: clean,
    isFinal,
    mutationAt,
    preloadEmitAt
  });
  sendTelemetry();
}

function scheduleQuietFinalize(utt: TrackedUtterance): void {
  if (utt.finalizeTimer) {
    clearTimeout(utt.finalizeTimer);
  }
  utt.finalizeTimer = setTimeout(() => {
    if (!utt.finalized && utt.lastText) {
      const now = Date.now();
      emitCaptionPayload(utt, utt.lastText, true, now);
    }
  }, FINALIZE_QUIET_MS);
}

function resolveUtteranceBlocks(targetEl: Element): {
  mode: 'container-blocks' | 'single-node';
  blocks: Element[];
} {
  let container = targetEl;
  // Unwrap single-child wrapper divs up to 3 levels to reach the repeating utterance list
  for (let depth = 0; depth < 3; depth += 1) {
    if (container.children.length === 1) {
      const onlyChild = container.children[0];
      if (onlyChild.children.length >= 2) {
        container = onlyChild;
        break;
      }
    } else {
      break;
    }
  }

  const childBlocks = Array.from(container.children).filter(
    (child) => !child.hasAttribute('data-tiro-poc-overlay')
  );

  if (childBlocks.length >= 1 && !['P', 'SPAN', 'H1', 'H2', 'H3', 'LI'].includes(container.tagName)) {
    return { mode: 'container-blocks', blocks: childBlocks };
  }

  return { mode: 'single-node', blocks: [targetEl] };
}

function scanObservedTarget(mutationAt: number, isInitialAttach = false): void {
  if (!activeSelector) return;
  const targetEl = document.querySelector(activeSelector);
  if (!targetEl) {
    telemetry.errorMessage = `선택한 요소(${activeSelector})를 현재 DOM에서 찾을 수 없습니다.`;
    sendTelemetry();
    return;
  }
  telemetry.errorMessage = undefined;

  const { mode, blocks } = resolveUtteranceBlocks(targetEl);
  telemetry.mode = mode;

  if (mode === 'single-node') {
    const singleEl = blocks[0];
    const currentText = normalizeCaptionText(
      (singleEl as HTMLElement).innerText || singleEl.textContent
    );
    if (!currentText) return;

    let tracked = trackedByNode.get(singleEl);
    if (isInitialAttach) {
      const initUtt: TrackedUtterance = {
        id: createUtteranceId(),
        lastText: '',
        finalized: false,
        lastMutatedAt: mutationAt,
        finalizeTimer: null
      };
      trackedByNode.set(singleEl, initUtt);
      emitCaptionPayload(initUtt, currentText, false, mutationAt);
      scheduleQuietFinalize(initUtt);
      return;
    }

    if (tracked && tracked.lastText === currentText) {
      telemetry.dedupedCount += 1;
      sendTelemetry();
      return;
    }

    if (!tracked || tracked.finalized || !isContinuationText(tracked.lastText, currentText)) {
      if (tracked && !tracked.finalized && tracked.lastText) {
        emitCaptionPayload(tracked, tracked.lastText, true, mutationAt);
      }
      if (recentFinalizedTexts.includes(currentText)) {
        telemetry.dedupedCount += 1;
        sendTelemetry();
        return;
      }
      tracked = {
        id: createUtteranceId(),
        lastText: '',
        finalized: false,
        lastMutatedAt: mutationAt,
        finalizeTimer: null
      };
      trackedByNode.set(singleEl, tracked);
    }

    tracked.lastMutatedAt = mutationAt;
    emitCaptionPayload(tracked, currentText, false, mutationAt);
    scheduleQuietFinalize(tracked);
    return;
  }

  // Multi-block transcript container mode
  if (isInitialAttach) {
    blocks.forEach((blockEl, idx) => {
      const txt = normalizeCaptionText((blockEl as HTMLElement).innerText || blockEl.textContent);
      const isLast = idx === blocks.length - 1;
      const utt: TrackedUtterance = {
        id: createUtteranceId(),
        lastText: isLast ? '' : txt,
        finalized: !isLast,
        lastMutatedAt: mutationAt,
        finalizeTimer: null
      };
      trackedByNode.set(blockEl, utt);
      if (txt && !isLast) {
        rememberFinalizedText(txt);
      }
      if (isLast && txt) {
        emitCaptionPayload(utt, txt, false, mutationAt);
        scheduleQuietFinalize(utt);
      }
    });
    sendTelemetry();
    return;
  }

  let emittedAny = false;
  for (let i = 0; i < blocks.length; i += 1) {
    const blockEl = blocks[i];
    const isLastBlock = i === blocks.length - 1;
    const text = normalizeCaptionText((blockEl as HTMLElement).innerText || blockEl.textContent);
    if (!text) continue;

    let tracked = trackedByNode.get(blockEl);

    if (!tracked) {
      // Handle React key-remount of active in-progress block
      if (
        isLastBlock &&
        activeUtterance &&
        !activeUtterance.finalized &&
        mutationAt - activeUtterance.lastMutatedAt < 4000 &&
        isContinuationText(activeUtterance.lastText, text)
      ) {
        tracked = activeUtterance;
        trackedByNode.set(blockEl, tracked);
      } else {
        // If a brand-new block appeared at the bottom, finalize the previous active utterance immediately
        if (activeUtterance && !activeUtterance.finalized && activeUtterance.lastText) {
          emitCaptionPayload(activeUtterance, activeUtterance.lastText, true, mutationAt);
          emittedAny = true;
        }

        // Prevent virtual-scroll re-emission of already finalized blocks
        if (recentFinalizedTexts.includes(text)) {
          const archived: TrackedUtterance = {
            id: createUtteranceId(),
            lastText: text,
            finalized: true,
            lastMutatedAt: mutationAt,
            finalizeTimer: null
          };
          trackedByNode.set(blockEl, archived);
          telemetry.dedupedCount += 1;
          sendTelemetry();
          emittedAny = true;
          continue;
        }

        tracked = {
          id: createUtteranceId(),
          lastText: '',
          finalized: false,
          lastMutatedAt: mutationAt,
          finalizeTimer: null
        };
        trackedByNode.set(blockEl, tracked);
      }
    }

    if (tracked.lastText === text) {
      // If a newer sibling appeared below an unfinalized block, finalize this older block now
      if (!isLastBlock && !tracked.finalized) {
        emitCaptionPayload(tracked, text, true, mutationAt);
        emittedAny = true;
      }
      continue;
    }

    tracked.lastMutatedAt = mutationAt;
    if (!isLastBlock) {
      emitCaptionPayload(tracked, text, true, mutationAt);
      emittedAny = true;
    } else {
      emitCaptionPayload(tracked, text, false, mutationAt);
      scheduleQuietFinalize(tracked);
      emittedAny = true;
    }
  }

  if (!emittedAny && blocks.length > 0) {
    telemetry.dedupedCount += 1;
    sendTelemetry();
  }
}

function startCaptionObserver(selector: string): void {
  stopCaptionObserver();
  if (!isAllowedInspectionHost()) {
    telemetry.errorMessage = '허용된 Tiro 도메인이 아니므로 감시를 시작할 수 없습니다.';
    sendTelemetry();
    return;
  }

  const targetEl = document.querySelector(selector);
  if (!targetEl) {
    telemetry.observing = false;
    telemetry.targetSelector = selector;
    telemetry.errorMessage = `요소를 찾을 수 없습니다: ${selector}`;
    sendTelemetry();
    return;
  }

  activeSelector = selector;
  lastPickedElement = targetEl;
  trackedByNode = new WeakMap<Element, TrackedUtterance>();
  activeUtterance = null;
  recentFinalizedTexts = [];

  telemetry.observing = true;
  telemetry.targetSelector = selector;
  telemetry.errorMessage = undefined;

  scanObservedTarget(Date.now(), true);

  captionObserver = new MutationObserver(() => {
    if (pendingMutationTimestamp === null) {
      pendingMutationTimestamp = Date.now();
    }
    if (coalesceTimer !== null) return;

    coalesceTimer = setTimeout(() => {
      const firstMutationAt = pendingMutationTimestamp ?? Date.now();
      pendingMutationTimestamp = null;
      coalesceTimer = null;
      scanObservedTarget(firstMutationAt, false);
    }, COALESCE_MS);
  });

  // Observe from parentElement (if available) so even if React replaces targetEl's inner wrapper, mutations fire
  const observeRoot = targetEl.parentElement ?? targetEl;
  captionObserver.observe(observeRoot, {
    subtree: true,
    childList: true,
    characterData: true
  });

  sendTelemetry();
}

function stopCaptionObserver(): void {
  if (captionObserver) {
    captionObserver.disconnect();
    captionObserver = null;
  }
  if (coalesceTimer) {
    clearTimeout(coalesceTimer);
    coalesceTimer = null;
  }
  if (activeUtterance?.finalizeTimer) {
    clearTimeout(activeUtterance.finalizeTimer);
  }
  activeSelector = null;
  pendingMutationTimestamp = null;
  activeUtterance = null;
  telemetry.observing = false;
  telemetry.mode = 'idle';
  sendTelemetry();
}

// ============================================================================
// IPC Command Router (Main <-> Isolated Tiro Preload Only)
// ============================================================================
ipcRenderer.on(
  'tiro-preload:command',
  (_event, payload: { action: string; selector?: string; latencySampleMs?: number }) => {
    switch (payload.action) {
      case 'diagnostics': {
        const diag = collectDomDiagnostics();
        ipcRenderer.send('tiro-preload:diagnostics', diag);
        break;
      }
      case 'start-radar': {
        startMutationRadar();
        break;
      }
      case 'stop-radar': {
        stopMutationRadar();
        break;
      }
      case 'start-picker': {
        startElementPicker();
        break;
      }
      case 'stop-picker': {
        stopElementPicker();
        break;
      }
      case 'select-parent': {
        selectParentOfPicked();
        break;
      }
      case 'start-observer': {
        if (payload.selector) {
          startCaptionObserver(payload.selector);
        }
        break;
      }
      case 'stop-observer': {
        stopCaptionObserver();
        break;
      }
      case 'record-latency': {
        if (typeof payload.latencySampleMs === 'number') {
          telemetry.lastLatencyMs = payload.latencySampleMs;
          telemetry.avgLatencyMs =
            telemetry.avgLatencyMs === null
              ? payload.latencySampleMs
              : Math.round(telemetry.avgLatencyMs * 0.7 + payload.latencySampleMs * 0.3);
          sendTelemetry();
        }
        break;
      }
      default:
        break;
    }
  }
);

window.addEventListener('DOMContentLoaded', () => {
  sendTelemetry();
});
