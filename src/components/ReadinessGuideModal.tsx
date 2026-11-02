import React from 'react';
import type { TranslatorStatus } from '../types/electron';
import type { TranslationEngineId } from '../types/settings';

interface ReadinessGuideModalProps {
  open: boolean;
  translatorStatus: TranslatorStatus | null;
  translationEngine: TranslationEngineId;
  hasSavedTiroSelector: boolean;
  hasCustomSlideDeck: boolean;
  onStartModelDownload: () => void;
  onUseMockEngine: () => void;
  onOpenTiroSetup: () => void;
  onClose: () => void;
}

function formatBytesToMB(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return '0MB';
  return `${Math.round(bytes / (1024 * 1024))}MB`;
}

export const ReadinessGuideModal: React.FC<ReadinessGuideModalProps> = ({
  open,
  translatorStatus,
  translationEngine,
  hasSavedTiroSelector,
  hasCustomSlideDeck,
  onStartModelDownload,
  onUseMockEngine,
  onOpenTiroSetup,
  onClose
}) => {
  if (!open) return null;

  const isCached = Boolean(translatorStatus?.cachedOnDisk || translatorStatus?.state === 'ready');
  const isDownloading = translatorStatus?.state === 'downloading';
  const isLoading = translatorStatus?.state === 'loading';
  const isReady = translatorStatus?.state === 'ready';
  const estimatedMB = translatorStatus?.estimatedDownloadMB ?? 680;
  const pct =
    translatorStatus?.progress != null ? Math.round(translatorStatus.progress * 100) : null;

  return (
    <div
      className="readiness-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="readiness-modal-title"
    >
      <div className="readiness-modal-card">
        <header className="readiness-modal-header">
          <div>
            <span className="readiness-kicker">PRE-FLIGHT CHECKLIST · 발표 전 준비 안내</span>
            <h2 id="readiness-modal-title" className="readiness-modal-title">
              네트워크 필요 범위 및 다국어 발표 준비 상태
            </h2>
          </div>
          <button
            type="button"
            className="win-caption-btn"
            onClick={onClose}
            aria-label="준비 안내 닫기"
          >
            ✕
          </button>
        </header>

        <div className="readiness-scope-grid">
          {/* 1. Speech Recognition Scope (Online Tiro Required) */}
          <section className="readiness-section">
            <div className="readiness-section-head">
              <span className="readiness-badge readiness-badge-online">온라인 연결 필요</span>
              <h3>① 실시간 음성 인식 (Tiro 웹 서비스)</h3>
            </div>
            <p className="readiness-desc">
              발표자 음성 인식(STT)은 내장된 <strong>Tiro 웹 세션</strong>을 통해 수행됩니다.
              발표 중에도 <strong>인터넷 연결과 Tiro 로그인</strong>이 유지되어야 실시간 원문 자막이
              수집됩니다.
            </p>
            <div className="readiness-status-row">
              <span>
                현재 연결 설정:{' '}
                <strong className={hasSavedTiroSelector ? 'text-ok' : ''}>
                  {hasSavedTiroSelector
                    ? '✓ 자막 영역 자동 재연결 저장됨 (다중 앵커 자가 복구 활성)'
                    : '미설정 — 발표 전 Tiro 로그인 및 자막 영역 자동 연결 필요'}
                </strong>
              </span>
              <button type="button" className="mini-btn" onClick={onOpenTiroSetup}>
                🎤 Tiro 로그인/설정 열기
              </button>
            </div>
          </section>

          {/* 2. Local AI Translation Scope (Offline After Initial Download) */}
          <section className="readiness-section">
            <div className="readiness-section-head">
              <span
                className={`readiness-badge ${
                  isCached ? 'readiness-badge-ready' : 'readiness-badge-download'
                }`}
              >
                {isCached ? '디스크 캐시 완료 · 로컬 구동' : `최초 1회 약 ${estimatedMB}MB 다운로드`}
              </span>
              <h3>② 다국어 로컬 AI 번역 (Meta NLLB-200 600M ONNX)</h3>
            </div>
            <p className="readiness-desc">
              <strong>최초 1회 모델 다운로드에는 인터넷 연결(약 {estimatedMB}MB, 디스크 여유 약 900MB)</strong>
              이 필요합니다. 다운로드가 완료된 이후에는 로컬 디스크에 영구 보관되어{' '}
              <strong>외부 번역 API 키나 호출 비용 없이 로컬에서 오프라인으로 번역</strong>하며,
              영어·일본어·중국어·스페인어·프랑스어·독일어·베트남어·한국어 자동 감지를 지원합니다.
            </p>

            {(isDownloading || isLoading) && (
              <div className="download-progress-container">
                <div className="download-progress-label">
                  <span>
                    {isDownloading
                      ? `모델 다운로드 중 ${
                          translatorStatus?.totalBytes
                            ? `(${formatBytesToMB(translatorStatus.downloadedBytes)} / ${formatBytesToMB(
                                translatorStatus.totalBytes
                              )})`
                            : ''
                        }`
                      : '로컬 디스크에서 AI 모델 로드 및 워밍업 중...'}
                  </span>
                  <span>{pct != null ? `${pct}%` : '진행 중'}</span>
                </div>
                <div className="download-progress-track">
                  <div
                    className="download-progress-bar"
                    style={{ width: `${pct ?? 35}%` }}
                  />
                </div>
              </div>
            )}

            <div className="readiness-status-row">
              <span>
                모델 상태:{' '}
                <strong className={isReady || isCached ? 'text-ok' : ''}>
                  {isReady
                    ? '✓ 로컬 AI 엔진 워밍업 완료 (즉시 실시간 번역 가능)'
                    : isCached
                      ? '✓ 디스크에 모델 설치됨 (로컬 오프라인 번역 가능)'
                      : isDownloading
                        ? '⬇ 최초 1회 모델 다운로드 진행 중...'
                        : '미설치 — 발표장 입장 전 Wi-Fi 환경에서 미리 다운로드를 권장합니다'}
                </strong>
              </span>

              <div className="control-btn-group">
                {!isReady && !isDownloading && !isLoading && (
                  <button
                    type="button"
                    className="toolbar-btn toolbar-btn-primary"
                    onClick={onStartModelDownload}
                  >
                    {isCached ? '⚡ 로컬 AI 엔진 시작' : `⬇ 지금 모델 다운로드 (약 ${estimatedMB}MB)`}
                  </button>
                )}
                {translationEngine !== 'mock' && !isCached && (
                  <button type="button" className="mini-btn" onClick={onUseMockEngine}>
                    🧪 먼저 Mock 번역으로 체험
                  </button>
                )}
              </div>
            </div>
          </section>

          {/* 3. Presentation Path With or Without PowerPoint */}
          <section className="readiness-section">
            <div className="readiness-section-head">
              <span className="readiness-badge readiness-badge-stage">듀얼 발표 경로</span>
              <h3>③ PowerPoint 연동 발표 &amp; PowerPoint 없는 내장 슬라이드 발표</h3>
            </div>
            <p className="readiness-desc">
              • <strong>PowerPoint 설치 PC</strong>: <strong>[🚀 PPT 발표]</strong> 클릭 시 프로젝터
              좌측에 PowerPoint 창 모드 슬라이드쇼를 테두리 없이 배치하고 우측에 자막 사이드바를
              띄웁니다.
              <br />• <strong>PowerPoint가 없는 PC</strong>: 슬라이드 이미지(PNG/JPG)를 불러온 뒤{' '}
              <strong>[🖼 내장 슬라이드 발표]</strong>를 누르면 프로젝터 전체 화면에{' '}
              <strong>내장 슬라이드 스테이지 + 실시간 이중언어 자막</strong>을 함께 송출합니다.
              {hasCustomSlideDeck ? ' (현재 슬라이드 이미지 로드됨 ✓)' : ''}
            </p>
          </section>
        </div>

        <footer className="readiness-modal-footer">
          <span className="readiness-footer-hint">
            💾 모든 발표 자막은 세션별로 로컬 디스크에 자동 저장되어 예기치 않은 종료 후에도 복구할 수 있습니다.
          </span>
          <button type="button" className="toolbar-btn toolbar-btn-primary" onClick={onClose}>
            확인하고 워크스페이스 열기
          </button>
        </footer>
      </div>
    </div>
  );
};
