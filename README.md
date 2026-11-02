# Tiro Live Bilingual Caption Workspace (`test-lt`)

**Windows 10 / 11** 발표 및 컨퍼런스 환경을 위해 설계된 **실시간 다국어 음성 자막 & 듀얼 프레젠테이션 워크스페이스**입니다.  
**Electron 35 + React 19 + TypeScript + 로컬 AI(Meta NLLB-200 ONNX)** 기반으로 동작하며, PowerPoint 설치 PC는 물론 **PowerPoint가 없는 발표장 PC**에서도 프로젝터 화면에 슬라이드와 실시간 번역 자막을 함께 송출합니다.

---

## 온라인 / 오프라인 동작 범위 안내 (`❓ 준비 안내`)

발표 전 혼선을 막기 위해 앱 내 **발표 전 준비 안내 모달(`ReadinessGuideModal`)** 과 상태 표시줄에서 네트워크 필요 범위를 명확히 구분해 안내합니다.

| 구성 요소 | 네트워크 필요 여부 | 상세 설명 |
| --- | --- | --- |
| **① 실시간 음성 인식 (STT)** | **온라인 연결 필요** | 내장된 **Tiro 웹 서비스(`tiro.ooo`)** 세션을 통해 음성을 텍스트로 변환하므로 발표 중 인터넷 연결 및 Tiro 로그인이 유지되어야 합니다. |
| **② 다국어 로컬 AI 번역 (`Meta NLLB-200 600M q8`)** | **최초 1회 다운로드 후 로컬 오프라인 동작** | 최초 1회 모델 다운로드 시 **인터넷 연결 및 약 680MB 다운로드(디스크 여유 약 900MB)** 가 필요합니다. 다운로드 완료 후에는 `%APPDATA%` 모델 캐시에 영구 보관되어 외부 API 키·호출 비용·인터넷 없이 로컬에서 오프라인으로 번역합니다. |
| **③ Mock 시뮬레이터** | **완전 오프라인** | 네트워크 및 모델 다운로드 없이도 레이아웃·프로젝터 비율·리허설을 즉시 점검할 수 있습니다. |

---

## 핵심 아키텍처 및 기능

### 1. 듀얼 프로젝터 발표 경로 (PowerPoint 연동 & PowerPoint 없는 내장 슬라이드 발표)
- **경로 A — Windows PowerPoint 자동 정렬 사이드바 모드 (`🚀 PPT 발표`)**:
  - 보조 모니터/프로젝터 작업 영역을 설정 비율(기본 `72% : 28%`, `50%~85%` 조절)로 분할합니다.
  - **좌측**: 실행 중인 Windows PowerPoint 프레젠테이션을 COM(`ppShowTypeWindow = 2`)으로 자동 시작하고, Win32 `user32.dll` (`SetProcessDpiAwarenessContext` Per-Monitor DPI v2 + 테두리 제거 Borderless)로 정밀 배치합니다.
  - **우측**: 본 앱이 프레임리스 자막 사이드바로 전환됩니다 (`📌 항상 위` 고정 지원).
- **경로 B — PowerPoint가 없는 내장 슬라이드 통합 발표 모드 (`🖼 내장 슬라이드 발표`)**:
  - PowerPoint가 설치되지 않은 PC에서도 내보낸 **슬라이드 이미지(PNG / JPG / WebP / SVG)** 여러 장을 불러오거나 드래그 앤 드롭한 뒤 **[🖼 내장 슬라이드 발표]** 를 누르면, 대상 프로젝터 **전체 화면에 내장 16:9 슬라이드 스테이지(좌측)와 실시간 번역 자막(우측)을 동시에 배치**하여 즉시 발표할 수 있습니다.
  - 슬라이드 이미지를 불러둔 상태에서 PowerPoint가 실행 중이 아니면 `[🚀 PPT 발표]` 클릭 시에도 자동으로 내장 슬라이드 통합 발표 모드로 전환됩니다.
  - 키보드 단축키: `←` / `→` / `Space` / `PageUp` / `PageDown` (슬라이드 이동), `Home` / `End` (처음/끝 슬라이드), `F11` (전체화면).

### 2. 다중 앵커 DOM 지문 & 자가 복구 Tiro 자막 수집 (`tiroPreload.ts`, `tiroDomMatcher.ts`)
- 격리된 Electron `WebContentsView`(`persist:tiro` 파티션, `sandbox: true`)에 `tiro.ooo` 로그인 세션을 유지합니다.
- **취약한 단일 CSS 클래스 휴리스틱 탈피**:
  - Emotion(`css-*`), styled-components(`sc-*`), CSS Modules(`_ cls_hash`), Tailwind 임의값 등 배포마다 바뀌는 해시 클래스를 자동 필터링합니다.
  - **다중 앵커 지문(`TiroElementFingerprint`)**: 태그 계층 구조, 스크롤 컨테이너 여부, 접근성 속성(`aria-live`, `role`), 뷰포트 상대 좌표 비율(`xRatio`, `yRatio`, `wRatio`, `hRatio`)을 함께 저장합니다.
  - **깊은 탐색 & 실시간 자가 복구(Self-Healing)**: Open `ShadowRoot`와 동일 출처 `<iframe>` 내부까지 탐색하며, Tiro 프런트엔드 업데이트로 기존 Selector가 깨지더라도 지문 유사도 매칭과 실시간 발화 텍스트 변화량(Speech-Stream Radar, 회의 타이머/시계 자동 제외)으로 새 자막 컨테이너를 자동 복구하고 설정에 갱신합니다.

### 3. 더 빠르고 정확한 실시간 다국어 음성 번역 파이프라인
- **8개 발화 언어 자동 감지 (`AUTO`) 및 코드 스위칭 보호 (`languageDetector.ts`)**:
  - 발화마다 0.05ms 미만으로 **영어(`EN`), 일본어(`JA`), 중국어(`ZH`), 스페인어(`ES`), 프랑스어(`FR`), 독일어(`DE`), 베트남어(`VI`), 한국어(`KO`)** 를 자동 감지하여 **한국어 / 영어 / 일본어 / 중국어**로 번역합니다.
  - 발표자가 이미 번역 대상 언어(예: 한국어)로 말할 때는 NLLB 추론을 거치지 않고 **0ms 즉시 패스스루**하여 잘못된 `src_lang`으로 인한 환각(Hallucination)을 원천 차단합니다.
- **문장 단위 증분 프리픽스 LRU 캐시 (`SentenceTranslationCache`)**:
  - Tiro 등 실시간 STT에서 한 문단 블록 안에 여러 문장이 이어질 때, 이미 마침표(`.?!。？！`)로 끝난 앞 문장들은 0ms 로컬 LRU 캐시에서 즉시 가져오고 **새로 말하고 있는 마지막 절만 ONNX로 추론**하여 긴 발화의 번역 지연을 획기적으로 줄입니다.
- **구어체 디스플루언시 정제 & 도메인 전문 용어집 (`speechTextProcessor.ts`)**:
  - `[inaudible]`, `(laughter)`, 고립된 추임새(`uh`, `um`, `erm`), 연속 단어 더듬기(`we we`)를 추론 전 자동 정제하고, 설정의 **전문 용어집(`원문 = 번역어`)** 으로 고유명사·약어를 일관되게 고정합니다.
- **적응형 디코딩 & 문장부호 인지 빠른 확정**:
  - 입력 길이에 비례한 동적 `max_new_tokens`, 확정 문장 반복 억제(`no_repeat_ngram_size: 3`, `repetition_penalty: 1.12`), 문장부호 종료 시 빠른 확정 타이머(`520ms` vs 일반 `1100ms`)로 체감 반응 속도와 완결성을 동시에 확보했습니다.

### 4. 세션별 자동 저장·복구 및 장시간 컨퍼런스 가상화 렌더링
- **원자적 자동 저장 및 1클릭 복구 (`SessionTranscriptStore`)**:
  - 자막이 수집·번역될 때마다 로컬 디스크(`%APPDATA%/.../sessions/*.json`)에 임시 파일 작성 후 원자적 교체(Atomic Write-Then-Rename) 방식으로 자동 백업됩니다.
  - 예기치 않은 종료나 화면 초기화 이후에도 상단 **`📂 복구`** 메뉴 또는 시작 시 표시되는 **복구 배너**에서 이전 세션을 1클릭으로 복원하며, 종료 직전 미완료 상태였던 문장은 복구 즉시 자동으로 번역을 재개합니다.
- **가변 높이 자막 목록 가상화 (`VirtualizedCaptionList`, `computeVirtualRange`)**:
  - 1~3시간 이상의 장시간 컨퍼런스에서 수천 개의 문장이 누적되어도 `ResizeObserver` 높이 캐시와 이진 탐색 가상 윈도우를 통해 화면 주변 **약 25~35개의 자막 카드만 DOM에 유지**하면서 전체 대본 스크롤백, 자동 저장, **SRT / Markdown / TXT / JSON 내보내기**를 손실 없이 지원합니다.

---

## 시작하기 (Getting Started)

### 요구 사항
- **OS**: Windows 10 / 11 (x64 권장; macOS / Linux 개발 및 CI 호환)
- **Node.js**: v20 이상 (v22 권장)

### 설치 및 실행

```bash
# 의존성 설치
npm ci

# 개발 모드 실행 (Vite HMR + Electron)
npm run dev
```

### 검증 및 테스트

```bash
# TypeScript 타입 검증 (Renderer + Electron Main/Preload/Worker)
npm run typecheck

# Vitest 단위 및 통합 테스트 (10개 스위트 / 35개 테스트)
npm test

# Electron 헤드리스 레이아웃 & 번역 파이프라인 스모크 테스트
npm run smoke

# Tiro WebContentsView + MutationObserver + IPC 종단간(E2E) 자동 검증
npm run poc:verify:ci
```

### Windows 설치 파일(`.exe`) 빌드

```bash
# Windows 언패키지 디렉터리 빌드 (release/win-unpacked)
npm run pack:win

# Windows x64 NSIS 설치 프로그램 빌드 (release/*Setup*.exe)
npm run dist:win
```

---

## License

MIT
