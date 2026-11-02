import { ipcRenderer } from 'electron';
import type { TiroElementFingerprint } from './tiroDomMatcher';

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
  progressiveCount: number;
  sampleText: string;
  lastUpdatedAt: number;
}

const COALESCE_MS = 35;
const FINALIZE_QUIET_MS = 1100;
const FINALIZE_QUIET_PUNCTUATED_MS = 520;

const VOLATILE_CLASS_PATTERNS: readonly RegExp[] = [
  /^css-[a-z0-9]{4,}$/i,
  /^sc-[a-zA-Z0-9_-]{4,}$/,
  /^_[a-zA-Z0-9]+_[a-z0-9]{4,}(?:_\d+)?$/,
  /^[a-zA-Z0-9_-]+__[a-zA-Z0-9_-]+___[A-Za-z0-9+/=_]{4,}$/,
  /^jsx-\d+$/,
  /^svelte-[a-z0-9]{4,}$/i,
  /^[a-f0-9]{7,}$/i,
  /[\[\]:/]/
];

const CLOCK_OR_COUNTER_RE =
  /^(?:\d{1,2}:\d{2}(?::\d{2})?|\d+\s*\/\s*\d+|\d+%|[\d\s:./-]+)$/;

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

function isClockOrCounterText(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed) return true;
  if (CLOCK_OR_COUNTER_RE.test(trimmed)) return true;
  const stripped = trimmed.replace(/\b(?:REC|LIVE|녹음|진행)\b/gi, '').trim();
  if (stripped && CLOCK_OR_COUNTER_RE.test(stripped)) return true;
  return false;
}

function filterStableClasses(classes: readonly string[]): string[] {
  const result: string[] = [];
  for (const raw of classes) {
    const cls = raw.trim();
    if (!cls || cls.length < 3 || cls.length > 36) continue;
    if (VOLATILE_CLASS_PATTERNS.some((re) => re.test(cls))) continue;
    if (/[-_][a-z0-9]{5,}$/i.test(cls) && /\d/.test(cls.slice(-5))) continue;
    result.push(cls);
  }
  return result.slice(0, 2);
}

/**
 * Traverses document, open ShadowRoots, and accessible same-origin iframes so component
 * encapsulation updates in Tiro never hide the transcript DOM from discovery or observation.
 */
function collectSearchRoots(): Array<Document | ShadowRoot> {
  const roots: Array<Document | ShadowRoot> = [document];
  const queue: Array<Document | ShadowRoot> = [document];

  while (queue.length > 0 && roots.length < 24) {
    const current = queue.shift()!;
    const elements = Array.from(current.querySelectorAll('*'));
    for (const el of elements) {
      const shadow = (el as HTMLElement).shadowRoot;
      if (shadow && !roots.includes(shadow)) {
        roots.push(shadow);
        queue.push(shadow);
      }
      if (el.tagName === 'IFRAME') {
        try {
          const subDoc = (el as HTMLIFrameElement).contentDocument;
          if (subDoc && subDoc.body && !roots.includes(subDoc)) {
            roots.push(subDoc);
            queue.push(subDoc);
          }
        } catch {
          // Cross-origin iframe — safely ignored
        }
      }
    }
  }
  return roots;
}

function queryDeep(selector: string): Element | null {
  if (!selector) return null;
  try {
    const direct = document.querySelector(selector);
    if (direct) return direct;
  } catch {
    return null;
  }

  for (const root of collectSearchRoots()) {
    if (root === document) continue;
    try {
      const found = root.querySelector(selector);
      if (found) return found;
    } catch {
      // ignore invalid selector in sub-root
    }
  }
  return null;
}

function isElementConnectedDeep(el: Element | null): boolean {
  return Boolean(el && el.isConnected);
}

function summarizeElement(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const idPart = el.id ? `#${el.id}` : '';
  const testId = el.getAttribute('data-testid');
  const role = el.getAttribute('role');
  const stableClasses = filterStableClasses(Array.from(el.classList));
  const fallbackClasses =
    stableClasses.length > 0
      ? stableClasses
      : Array.from(el.classList)
          .filter((c) => c && c.length < 32)
          .slice(0, 2);
  const classStr = fallbackClasses.map((c) => `.${c}`).join('');
  const attrs = [
    testId ? `[data-testid="${testId}"]` : '',
    role ? `[role="${role}"]` : ''
  ].join('');
  return `${tag}${idPart}${classStr}${attrs}`;
}

function cssEscapeIdent(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value);
  }
  return value.replace(/([^a-zA-Z0-9_-])/g, '\\$1');
}

function computeStableSelector(target: Element): string | null {
  const rootNode = target.getRootNode() as Document | ShadowRoot;
  const queryRoot = 'querySelectorAll' in rootNode ? rootNode : document;

  if (target.id && !/\d{5,}/.test(target.id)) {
    const idSel = `#${cssEscapeIdent(target.id)}`;
    if (queryRoot.querySelectorAll(idSel).length === 1) return idSel;
  }

  const testId = target.getAttribute('data-testid');
  if (testId) {
    const sel = `${target.tagName.toLowerCase()}[data-testid="${cssEscapeIdent(testId)}"]`;
    if (queryRoot.querySelectorAll(sel).length === 1) return sel;
  }

  const ariaLive = target.getAttribute('aria-live');
  if (ariaLive) {
    const sel = `${target.tagName.toLowerCase()}[aria-live="${cssEscapeIdent(ariaLive)}"]`;
    if (queryRoot.querySelectorAll(sel).length === 1) return sel;
  }

  const role = target.getAttribute('role');
  if (role === 'log' || role === 'feed') {
    const sel = `${target.tagName.toLowerCase()}[role="${cssEscapeIdent(role)}"]`;
    if (queryRoot.querySelectorAll(sel).length === 1) return sel;
  }

  const stableClasses = filterStableClasses(Array.from(target.classList));
  if (stableClasses.length > 0) {
    const sel = `${target.tagName.toLowerCase()}.${stableClasses.map(cssEscapeIdent).join('.')}`;
    if (queryRoot.querySelectorAll(sel).length === 1) return sel;
  }

  return null;
}

function computeSelector(target: Element): string {
  if (target === document.body) return 'body';
  const stable = computeStableSelector(target);
  if (stable) return stable;

  if (target.id) {
    const escapedId = `#${cssEscapeIdent(target.id)}`;
    if (document.querySelectorAll(escapedId).length === 1) {
      return escapedId;
    }
  }

  const parts: string[] = [];
  let current: Element | null = target;

  while (current && current !== document.body && current !== document.documentElement) {
    const currentStable = computeStableSelector(current);
    if (currentStable) {
      parts.unshift(currentStable);
      const joined = parts.join(' > ');
      if (document.querySelectorAll(joined).length === 1) {
        return joined;
      }
      current = current.parentElement;
      continue;
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

function computeAncestryTags(el: Element): string[] {
  const tags: string[] = [];
  let cur: Element | null = el.parentElement;
  while (cur && cur !== document.documentElement && tags.length < 6) {
    tags.unshift(cur.tagName.toLowerCase());
    cur = cur.parentElement;
  }
  return tags;
}

function checkIsScrollable(el: Element): boolean {
  try {
    const style = window.getComputedStyle(el);
    return (
      style.overflowY === 'auto' ||
      style.overflowY === 'scroll' ||
      el.scrollHeight > el.clientHeight + 24
    );
  } catch {
    return false;
  }
}

function buildFingerprint(el: Element): TiroElementFingerprint {
  const rect = el.getBoundingClientRect();
  const vw = Math.max(1, window.innerWidth);
  const vh = Math.max(1, window.innerHeight);

  return {
    primarySelector: computeSelector(el),
    stableSelector: computeStableSelector(el),
    tagName: el.tagName.toLowerCase(),
    ancestryTags: computeAncestryTags(el),
    ariaLive: el.getAttribute('aria-live'),
    role: el.getAttribute('role'),
    xRatio: Number((rect.left / vw).toFixed(3)),
    yRatio: Number((rect.top / vh).toFixed(3)),
    wRatio: Number((rect.width / vw).toFixed(3)),
    hRatio: Number((rect.height / vh).toFixed(3)),
    isScrollable: checkIsScrollable(el)
  };
}

function scoreFingerprintSimilarity(
  saved: TiroElementFingerprint,
  candidate: TiroElementFingerprint
): number {
  let score = 0;
  if (saved.tagName.toLowerCase() === candidate.tagName.toLowerCase()) score += 0.2;
  if (saved.ariaLive && saved.ariaLive === candidate.ariaLive) score += 0.2;
  if (saved.role && saved.role === candidate.role) score += 0.15;
  if (saved.isScrollable === candidate.isScrollable) score += 0.1;

  const savedTail = saved.ancestryTags.slice(-4);
  const candTail = candidate.ancestryTags.slice(-4);
  if (savedTail.length > 0 && candTail.length > 0) {
    const set = new Set(savedTail);
    const matches = candTail.filter((t) => set.has(t)).length;
    score += 0.2 * (matches / Math.max(savedTail.length, candTail.length));
  }

  const dx = Math.abs(saved.xRatio - candidate.xRatio);
  const dy = Math.abs(saved.yRatio - candidate.yRatio);
  const dw = Math.abs(saved.wRatio - candidate.wRatio);
  const dh = Math.abs(saved.hRatio - candidate.hRatio);
  const spatialDist = (dx + dy + dw + dh) / 4;
  score += 0.35 * Math.max(0, 1 - spatialDist * 2.2);

  return Math.min(1, score);
}

function scoreElementAsTranscript(el: Element): number {
  if (el.closest('[data-tiro-poc-overlay="true"]')) return -100;
  if (el.closest('nav, header, footer, button, [role="navigation"], [role="menubar"], [role="dialog"]')) {
    return -100;
  }
  const tag = el.tagName.toUpperCase();
  if (['NAV', 'HEADER', 'FOOTER', 'BUTTON', 'INPUT', 'TEXTAREA', 'SELECT', 'ASIDE', 'SCRIPT', 'STYLE', 'SVG'].includes(tag)) {
    return -100;
  }

  const rect = el.getBoundingClientRect();
  if (rect.width < 120 || rect.height < 24) return -100;

  const text = normalizeCaptionText((el as HTMLElement).innerText || el.textContent);
  const isClock = text.length > 0 && isClockOrCounterText(text);
  if (isClock && text.length < 32) return -80;

  let score = 0;

  const radar = radarMap.get(el);
  if (radar) {
    score += Math.min(45, radar.mutationCount * 9 + radar.progressiveCount * 8);
  }

  const ariaLive = el.getAttribute('aria-live');
  if (ariaLive === 'polite' || ariaLive === 'assertive') score += 32;

  const role = el.getAttribute('role');
  if (role === 'log' || role === 'feed') score += 28;
  else if (role === 'region' || role === 'status') score += 10;

  const hintSource = `${el.id} ${el.getAttribute('data-testid') ?? ''} ${el.className?.toString() ?? ''}`.toLowerCase();
  if (/(transcript|utterance|caption|subtitle|stt|speech|script)/.test(hintSource)) {
    score += 26;
  }

  const vw = Math.max(1, window.innerWidth);
  const vh = Math.max(1, window.innerHeight);
  const areaRatio = (rect.width * rect.height) / (vw * vh);
  if (checkIsScrollable(el)) score += 16;
  if (areaRatio >= 0.08 && areaRatio <= 0.92) score += 14;
  else if (areaRatio > 0.96) score -= 18;

  // Count homogeneous child blocks carrying natural sentence text
  const children = Array.from(el.children).filter(
    (c) => !c.hasAttribute('data-tiro-poc-overlay')
  );
  if (children.length >= 2 && children.length <= 400) {
    const tagCounts = new Map<string, number>();
    let sentenceChildren = 0;
    for (const child of children.slice(-24)) {
      const cText = normalizeCaptionText((child as HTMLElement).innerText || child.textContent);
      if (cText.length >= 8 && !isClockOrCounterText(cText)) {
        tagCounts.set(child.tagName, (tagCounts.get(child.tagName) ?? 0) + 1);
        if (/[\s.?!,。？！]/.test(cText)) {
          sentenceChildren += 1;
        }
      }
    }
    const maxSameTag = Math.max(0, ...tagCounts.values());
    if (maxSameTag >= 2) {
      score += Math.min(24, maxSameTag * 4);
    }
    if (sentenceChildren >= 1) {
      score += Math.min(22, sentenceChildren * 5);
    }
  }

  if (text.length >= 24 && !isClock) {
    score += 10;
  }

  return score;
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

  const roots = collectSearchRoots();
  let totalElements = 0;
  let textBearingCount = 0;
  let openShadowCount = 0;

  for (const root of roots) {
    const allElements = Array.from(root.querySelectorAll('*'));
    totalElements += allElements.length;
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
  }

  const canvases = document.querySelectorAll('canvas').length;
  const iframes = Array.from(document.querySelectorAll('iframe')).map(
    (f) => f.getAttribute('src') || '(inline/about:blank)'
  );
  const ariaLive = Array.from(
    document.querySelectorAll('[aria-live], [role="log"], [role="feed"], [role="status"]')
  )
    .slice(0, 10)
    .map((el) => summarizeElement(el));

  const notes: string[] = [];
  if (loginOrAuth) {
    notes.push('현재 로그인 화면입니다. Tiro 계정으로 로그인한 뒤 실시간 음성 인식 세션을 시작하세요.');
  } else {
    notes.push('tiro.ooo 워크스페이스 DOM(Shadow DOM·동일 출처 iframe 포함) 접근이 가능합니다.');
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
    totalElements,
    textBearingElements: textBearingCount,
    canvasCount: canvases,
    iframeUrls: iframes,
    openShadowRootCount: openShadowCount,
    ariaLiveDescriptors: ariaLive,
    notes
  };
}

// ============================================================================
// 2. Mutation Radar & Adaptive Structural Discovery
// ============================================================================
let radarObserver: MutationObserver | null = null;
let radarFlushTimer: ReturnType<typeof setInterval> | null = null;
let autoAttachOnRadar = false;
let autoAttachIsSelfHeal = false;
const radarMap = new Map<Element, RadarEntry>();

function resolveMeaningfulContainer(node: Node): Element | null {
  let el: Element | null =
    node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  if (!el) return null;

  if (el.closest('[data-tiro-poc-overlay="true"]')) return null;
  if (el.closest('nav, header, footer, button, [role="navigation"]')) return null;

  while (
    el.parentElement &&
    el.parentElement !== document.body &&
    ['SPAN', 'STRONG', 'EM', 'B', 'I', 'SMALL', 'MARK', 'FONT', 'TIME'].includes(el.tagName)
  ) {
    el = el.parentElement;
  }

  if (el.parentElement && el.parentElement !== document.body && el.parentElement.children.length >= 2) {
    return el.parentElement;
  }

  return el;
}

function flushRadarCandidates(): void {
  const scoredEntries = Array.from(radarMap.values())
    .filter(
      (entry) =>
        isElementConnectedDeep(entry.el) &&
        entry.sampleText.length > 0 &&
        !isClockOrCounterText(entry.sampleText)
    )
    .map((entry) => ({
      entry,
      score: scoreElementAsTranscript(entry.el)
    }))
    .filter((item) => item.score > -50)
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.entry.progressiveCount - a.entry.progressiveCount ||
        b.entry.mutationCount - a.entry.mutationCount ||
        b.entry.lastUpdatedAt - a.entry.lastUpdatedAt
    );

  if (autoAttachOnRadar && scoredEntries.length > 0) {
    const top = scoredEntries[0];
    const e = top.entry;
    if (
      (e.progressiveCount >= 1 && e.sampleText.length >= 8) ||
      e.mutationCount >= 2 ||
      (top.score >= 30 && e.sampleText.length >= 12)
    ) {
      const wasSelfHeal = autoAttachIsSelfHeal;
      autoAttachOnRadar = false;
      autoAttachIsSelfHeal = false;
      const info = buildPickedInfo(e.el, wasSelfHeal);
      savedFingerprint = info.fingerprint ?? null;
      if (wasSelfHeal) {
        telemetry.selfHealedCount += 1;
        telemetry.lastHealMessage = `Tiro DOM 변경 감지 → 자막 영역 자동 복구 완료 (${info.tagSummary})`;
      }
      ipcRenderer.send('tiro-preload:element-picked', info);
      startCaptionObserver(info.selector, {
        waitForElement: true,
        preserveHistory: true,
        fingerprint: info.fingerprint
      });
      stopMutationRadar();
    }
  }

  const candidates = scoredEntries.slice(0, 6).map(({ entry, score }) => ({
    selector: computeSelector(entry.el),
    tagSummary: entry.tagSummary,
    mutationCount: entry.mutationCount,
    childBlockCount: entry.el.children.length,
    sampleText: entry.sampleText.slice(-160),
    lastUpdatedAt: entry.lastUpdatedAt,
    score
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
      if (!text || isClockOrCounterText(text)) continue;

      const existing = radarMap.get(container);
      if (existing) {
        if (existing.sampleText !== text) {
          if (isContinuationText(existing.sampleText, text) || text.length > existing.sampleText.length) {
            existing.progressiveCount += 1;
          }
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
          progressiveCount: 0,
          sampleText: text,
          lastUpdatedAt: now
        });
      }
    }
  });

  for (const root of collectSearchRoots()) {
    const targetNode = root instanceof Document ? root.body : root;
    if (targetNode) {
      radarObserver.observe(targetNode, {
        subtree: true,
        childList: true,
        characterData: true
      });
    }
  }

  radarFlushTimer = setInterval(flushRadarCandidates, 500);
}

function stopMutationRadar(): void {
  autoAttachOnRadar = false;
  autoAttachIsSelfHeal = false;
  if (radarObserver) {
    radarObserver.disconnect();
    radarObserver = null;
  }
  if (radarFlushTimer) {
    clearInterval(radarFlushTimer);
    radarFlushTimer = null;
  }
}

/**
 * Evaluates all DOM containers across document + ShadowRoots + same-origin iframes using
 * multi-signal structural & behavioral scoring (not brittle class-name assumptions alone).
 */
function findBestStructuralTranscriptCandidate(): { el: Element; score: number } | null {
  let bestEl: Element | null = null;
  let bestScore = 22; // minimum confidence threshold

  for (const root of collectSearchRoots()) {
    const candidates = Array.from(
      root.querySelectorAll('div, section, main, article, ul, ol, [aria-live], [role="log"], [role="feed"]')
    );
    for (const el of candidates) {
      const score = scoreElementAsTranscript(el);
      if (score > bestScore) {
        bestScore = score;
        bestEl = el;
      }
    }
  }

  return bestEl ? { el: bestEl, score: bestScore } : null;
}

function autoDetectCaptionTarget(): void {
  if (!isAllowedInspectionHost() || !document.body) {
    telemetry.errorMessage = 'Tiro 워크스페이스 화면에서 자동 탐색을 실행해 주세요.';
    sendTelemetry();
    return;
  }

  // 1. Prefer active speech-stream mutation radar candidate if already observed
  const radarBest = Array.from(radarMap.values())
    .filter(
      (entry) =>
        isElementConnectedDeep(entry.el) &&
        entry.sampleText.length > 0 &&
        !isClockOrCounterText(entry.sampleText)
    )
    .sort(
      (a, b) =>
        scoreElementAsTranscript(b.el) - scoreElementAsTranscript(a.el) ||
        b.mutationCount - a.mutationCount
    )[0];

  if (radarBest) {
    const info = buildPickedInfo(radarBest.el, false);
    savedFingerprint = info.fingerprint ?? null;
    ipcRenderer.send('tiro-preload:element-picked', info);
    startCaptionObserver(info.selector, {
      waitForElement: true,
      preserveHistory: true,
      fingerprint: info.fingerprint
    });
    return;
  }

  // 2. Multi-signal structural + semantic scoring across the entire DOM tree
  const structuralBest = findBestStructuralTranscriptCandidate();
  if (structuralBest) {
    const info = buildPickedInfo(structuralBest.el, false);
    savedFingerprint = info.fingerprint ?? null;
    ipcRenderer.send('tiro-preload:element-picked', info);
    startCaptionObserver(info.selector, {
      waitForElement: true,
      preserveHistory: true,
      fingerprint: info.fingerprint
    });
    return;
  }

  // 3. Fallback: arm Speech-Stream Mutation Radar in auto-attach mode
  startMutationRadar();
  autoAttachOnRadar = true;
  autoAttachIsSelfHeal = false;
  telemetry.waitingForElement = true;
  telemetry.errorMessage = undefined;
  sendTelemetry();
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

function buildPickedInfo(el: Element, autoHealed = false) {
  const selector = computeSelector(el);
  const parent =
    el.parentElement && el.parentElement !== document.body ? el.parentElement : null;
  const fingerprint = buildFingerprint(el);
  return {
    selector,
    parentSelector: parent ? computeSelector(parent) : null,
    tagSummary: summarizeElement(el),
    childElementCount: el.children.length,
    sampleText: normalizeCaptionText((el as HTMLElement).innerText || el.textContent).slice(0, 240),
    fingerprint,
    autoHealed
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

  const info = buildPickedInfo(target, false);
  savedFingerprint = info.fingerprint ?? null;
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
  const info = buildPickedInfo(lastPickedElement, false);
  savedFingerprint = info.fingerprint ?? null;
  ipcRenderer.send('tiro-preload:element-picked', info);
}

// ============================================================================
// 4. MutationObserver Caption Extractor & Self-Healing Failover Engine
// ============================================================================
let captionObserver: MutationObserver | null = null;
let coalesceTimer: ReturnType<typeof setTimeout> | null = null;
let activeSelector: string | null = null;
let savedFingerprint: TiroElementFingerprint | null = null;
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
  waitingForElement: false,
  selfHealedCount: 0,
  lastHealMessage: undefined as string | undefined,
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

function hasTerminalSentencePunctuation(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (/\.\.\.$/.test(trimmed)) return false;
  return /[.?!。？！]["”’')]?$/.test(trimmed);
}

function scheduleQuietFinalize(utt: TrackedUtterance): void {
  if (utt.finalizeTimer) {
    clearTimeout(utt.finalizeTimer);
  }
  // Adaptive punctuation-aware quiet window cuts ~600ms off final utterance latency!
  const quietMs = hasTerminalSentencePunctuation(utt.lastText)
    ? FINALIZE_QUIET_PUNCTUATED_MS
    : FINALIZE_QUIET_MS;

  utt.finalizeTimer = setTimeout(() => {
    if (!utt.finalized && utt.lastText) {
      const now = Date.now();
      emitCaptionPayload(utt, utt.lastText, true, now);
    }
  }, quietMs);
}

function resolveUtteranceBlocks(targetEl: Element): {
  mode: 'container-blocks' | 'single-node';
  blocks: Element[];
} {
  let container = targetEl;
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

/**
 * Attempts to self-heal a broken selector on a live Tiro workspace by matching
 * saved structural/spatial fingerprint or high-confidence transcript container metrics.
 */
function attemptFingerprintOrStructuralHeal(): Element | null {
  if (isLoginOrAuthLocation() || !document.body) return null;

  // 1. Try stableSelector from savedFingerprint first
  if (savedFingerprint?.stableSelector) {
    const stableEl = queryDeep(savedFingerprint.stableSelector);
    if (stableEl) return stableEl;
  }

  // 2. Match savedFingerprint spatial + structural similarity combined with transcript score
  if (savedFingerprint) {
    let bestMatch: Element | null = null;
    let bestCombined = 0;

    for (const root of collectSearchRoots()) {
      const candidates = Array.from(root.querySelectorAll('div, section, main, article, ul, ol'));
      for (const el of candidates) {
        const transcriptScore = scoreElementAsTranscript(el);
        if (transcriptScore < 14) continue;
        const similarity = scoreFingerprintSimilarity(savedFingerprint, buildFingerprint(el));
        if (similarity >= 0.68) {
          const combined = similarity * 100 + transcriptScore;
          if (combined > bestCombined) {
            bestCombined = combined;
            bestMatch = el;
          }
        }
      }
    }
    if (bestMatch) return bestMatch;
  }

  // 3. High-confidence structural transcript container (e.g. semantic live region or active multi-block transcript)
  const structural = findBestStructuralTranscriptCandidate();
  if (structural && structural.score >= 38) {
    return structural.el;
  }

  return null;
}

function scanObservedTarget(mutationAt: number, isInitialAttach = false): void {
  if (!activeSelector) return;
  const targetEl = queryDeep(activeSelector);
  if (!targetEl) {
    telemetry.errorMessage = `선택한 요소(${activeSelector})가 변경되어 자동 복구를 탐색 중입니다.`;
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
        if (activeUtterance && !activeUtterance.finalized && activeUtterance.lastText) {
          emitCaptionPayload(activeUtterance, activeUtterance.lastText, true, mutationAt);
          emittedAny = true;
        }

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

let waitForElementTimer: ReturnType<typeof setInterval> | null = null;
let watchdogTimer: ReturnType<typeof setInterval> | null = null;
let observedTargetEl: Element | null = null;

function clearWaitTimers(): void {
  if (waitForElementTimer) {
    clearInterval(waitForElementTimer);
    waitForElementTimer = null;
  }
}

function startCaptionObserver(
  selector: string,
  options: {
    waitForElement?: boolean;
    preserveHistory?: boolean;
    fingerprint?: TiroElementFingerprint | null;
  } = {}
): void {
  const preservedFinalized = options.preserveHistory ? [...recentFinalizedTexts] : [];
  if (options.fingerprint !== undefined) {
    savedFingerprint = options.fingerprint ?? null;
  }

  stopCaptionObserver();
  clearWaitTimers();
  if (!isAllowedInspectionHost()) {
    telemetry.errorMessage = '허용된 Tiro 도메인이 아니므로 감시를 시작할 수 없습니다.';
    sendTelemetry();
    return;
  }

  const targetEl = queryDeep(selector);
  if (!targetEl) {
    telemetry.observing = false;
    telemetry.targetSelector = selector;
    if (options.waitForElement) {
      telemetry.errorMessage = undefined;
      telemetry.mode = 'idle';
      telemetry.waitingForElement = true;
      sendTelemetry();

      // Arm background Speech-Stream Radar failover while waiting on non-login pages so if Tiro's
      // CSS selector changed, speaking immediately triggers automatic self-healing!
      if (!isLoginOrAuthLocation() && !radarObserver) {
        startMutationRadar();
        autoAttachOnRadar = true;
        autoAttachIsSelfHeal = true;
      }

      const startedAt = Date.now();
      let missTicks = 0;
      waitForElementTimer = setInterval(() => {
        if (queryDeep(selector)) {
          clearWaitTimers();
          if (autoAttachIsSelfHeal) stopMutationRadar();
          recentFinalizedTexts = preservedFinalized;
          startCaptionObserver(selector, { preserveHistory: true, fingerprint: savedFingerprint });
          return;
        }

        missTicks += 1;
        // After 3 seconds on an active workspace page, attempt structural/fingerprint self-healing
        if (missTicks >= 3 && !isLoginOrAuthLocation()) {
          const healedEl = attemptFingerprintOrStructuralHeal();
          if (healedEl) {
            clearWaitTimers();
            if (autoAttachIsSelfHeal) stopMutationRadar();
            recentFinalizedTexts = preservedFinalized;
            const info = buildPickedInfo(healedEl, true);
            savedFingerprint = info.fingerprint ?? null;
            telemetry.selfHealedCount += 1;
            telemetry.lastHealMessage = `Tiro 셀렉터 변경 감지 → 구조 핑거프린트로 자동 복구 (${info.tagSummary})`;
            ipcRenderer.send('tiro-preload:element-picked', info);
            startCaptionObserver(info.selector, {
              preserveHistory: true,
              fingerprint: info.fingerprint
            });
            return;
          }
          if (!radarObserver) {
            startMutationRadar();
            autoAttachOnRadar = true;
            autoAttachIsSelfHeal = true;
          }
        }

        if (Date.now() - startedAt > 10 * 60 * 1000) {
          clearWaitTimers();
          telemetry.waitingForElement = false;
          telemetry.errorMessage = `자막 영역(${selector})을 10분 동안 찾지 못했습니다. Tiro 설정에서 다시 선택하세요.`;
          sendTelemetry();
        }
      }, 1000);
      return;
    }
    telemetry.errorMessage = `요소를 찾을 수 없습니다: ${selector}`;
    sendTelemetry();
    return;
  }

  activeSelector = selector;
  lastPickedElement = targetEl;
  observedTargetEl = targetEl;
  if (!savedFingerprint) {
    savedFingerprint = buildFingerprint(targetEl);
  }
  trackedByNode = new WeakMap<Element, TrackedUtterance>();
  activeUtterance = null;
  recentFinalizedTexts = preservedFinalized;

  telemetry.observing = true;
  telemetry.waitingForElement = false;
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

  const observeRoot: Node =
    targetEl.parentElement ?? (targetEl.getRootNode() as Node) ?? targetEl;
  captionObserver.observe(observeRoot, {
    subtree: true,
    childList: true,
    characterData: true
  });

  // Watchdog: if Tiro re-mounts or updates DOM structure mid-session, re-attach or self-heal!
  watchdogTimer = setInterval(() => {
    if (!activeSelector) return;
    const current = queryDeep(activeSelector);
    if (!observedTargetEl || !isElementConnectedDeep(observedTargetEl) || (current && current !== observedTargetEl)) {
      startCaptionObserver(activeSelector, {
        waitForElement: true,
        preserveHistory: true,
        fingerprint: savedFingerprint
      });
    }
  }, 2000);

  sendTelemetry();
}

function stopCaptionObserver(): void {
  clearWaitTimers();
  if (watchdogTimer) {
    clearInterval(watchdogTimer);
    watchdogTimer = null;
  }
  observedTargetEl = null;
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
  (
    _event,
    payload: {
      action: string;
      selector?: string;
      fingerprint?: TiroElementFingerprint | null;
      latencySampleMs?: number;
      waitForElement?: boolean;
      preserveHistory?: boolean;
    }
  ) => {
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
      case 'auto-detect': {
        autoDetectCaptionTarget();
        break;
      }
      case 'start-observer': {
        if (payload.selector) {
          startCaptionObserver(payload.selector, {
            waitForElement: Boolean(payload.waitForElement),
            preserveHistory: Boolean(payload.preserveHistory),
            fingerprint: payload.fingerprint
          });
        }
        break;
      }
      case 'stop-observer': {
        telemetry.waitingForElement = false;
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
