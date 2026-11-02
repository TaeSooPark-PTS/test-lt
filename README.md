# Tiro Live Bilingual Caption Workspace (`test-lt`)

**Windows 10 / 11** 발표 및 컨퍼런스 환경을 위해 설계된 **실시간 영어 → 한국어 이중언어 자막 & 프레젠테이션 워크스페이스**입니다.  
**Electron 35 + React 19 + TypeScript + 로컬 오프라인 AI(Meta NLLB-200 ONNX)** 기반으로 동작하며, 외부 번역 API 키나 호출 비용 없이 프로젝터 화면에서 PowerPoint 슬라이드쇼와 실시간 번역 자막을 동시에 표출합니다.

---

## 핵심 아키텍처 및 기능

### 1. Tiro 실시간 음성인식 세션 내장 및 자동 재연결 (`persist:tiro`)
- 격리된 Electron `WebContentsView`(`persist:tiro` 세션 파티션)에 `tiro.ooo`를 내장하여 Google / Microsoft SSO 로그인 세션을 영구 유지합니다.
- **Zero-Assumption DOM 추출 엔진 (`tiroPreload.ts`)**:
  - **✨ 원클릭 자막 영역 자동 연결**: 실시간 텍스트 변화(Mutation Radar) 및 `aria-live` 컨테이너를 자동 감지해 즉시 연결합니다.
  - **🎯 마우스 시각적 요소 선택기**: Tiro 화면에서 자막 영역을 최초 1회 클릭하면 CSS Selector와 워크스페이스 URL이 `%APPDATA%` 설정에 자동 저장되어 앱 재실행·세션 전환(SPA 라우팅) 시에도 자동 재연결됩니다.
  - **백그라운드 캡처 보장**: 발표 중 Tiro 뷰가 숨겨져 있어도 실제 레이아웃 크기를 보존하여 가상 스크롤(Virtualized List) 렌더링 중단 없이 자막을 수집합니다.

### 2. API 키·비용 없는 100% 오프라인 AI 실시간 번역 (`LocalTranslationService`)
- 전용 Electron `utilityProcess`에서 **Meta NLLB-200 Distilled 600M (`q8` 양자화)** 모델을 멀티스레드 SIMD WebAssembly(`onnxruntime-web`)로 구동합니다.
- Electron V8 Memory Cage(`SIGTRAP`) 충돌이나 Windows VC++ 런타임 의존성 없이 Windows 10/11 어디서나 안정적으로 동작합니다.
- **실시간 중간(Interim) 선발 번역 & 최신 우선(Latest-Wins) 큐**: 발표자가 긴 영어 문장을 말하는 도중에도 중간 번역을 실시간 갱신하며, 문장 확정(`isFinal`) 시 우선순위 큐를 통해 즉시 최종 번역으로 확정합니다.
- 리허설 및 오프라인 레이아웃 점검을 위한 **Mock 시뮬레이터**도 언제든 전환할 수 있습니다.

### 3. Windows PowerPoint 슬라이드쇼 자동 창 배치 (`pptArranger.ts`)
- **[🚀 프로젝터 발표]** 실행 시 보조 모니터/프로젝터 작업 영역을 설정된 비율(기본 `72% : 28%`, `50%~85%` 조절 가능)로 분할합니다:
  - **좌측 72%**: 실행 중인 Windows PowerPoint 프레젠테이션을 COM(`ppShowTypeWindow = 2`, 웹 형식으로 보기 창 모드)으로 자동 시작하고, Win32 `user32.dll` (`SetProcessDpiAwarenessContext` Per-Monitor DPI v2 + 제목 표시줄/테두리 제거 Borderless)로 빈틈없이 정렬합니다.
  - **우측 28%**: 본 앱이 프레임리스(Frameless) 실시간 이중언어 자막 사이드바로 전환됩니다 (`📌 항상 위` 고정, 좌우 50:50 분할 / 상하 분할 / 한국어 전용 / 상단 Tiro 분할 뷰 지원).
- PowerPoint가 없는 환경에서는 내장 16:9 슬라이드 스테이지에 **슬라이드 이미지(PNG/JPG/WebP)를 드래그 앤 드롭**하여 바로 발표할 수 있습니다.

### 4. 실시간 자막 대본 내보내기 (`💾 저장` / `📋 복사`)
- 발표 종료 후 전체 영·한 자막 기록을 Windows 저장 대화상자를 통해 **SRT 자막(`.srt`)**, **Markdown 표(`.md`)**, **텍스트 대본(`.txt`)**, **JSON(`.json`)** 형식으로 즉시 저장하거나 클립보드에 복사할 수 있습니다.

---

## 시작하기 (Getting Started)

### 요구 사항
- **OS**: Windows 10 / 11 (x64 권장; macOS / Linux 개발 및 테스트 호환)
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

# Vitest 단위 및 통합 테스트
npm test

# Electron 헤드리스 레이아웃 & 번역 파이프라인 스모크 테스트
npm run smoke

# Tiro WebContentsView + MutationObserver + IPC 종단간(E2E) 자동 검증
npm run poc:verify
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
