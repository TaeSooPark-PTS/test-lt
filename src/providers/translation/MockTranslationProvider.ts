import type { TranslationProviderStatus } from '../../types/translation';
import {
  detectSpeechLanguage,
  type ConcreteLanguageCode
} from '../../utils/languageDetector';
import {
  applyGlossaryToTranslation,
  cleanSpokenSttText,
  parseGlossary
} from '../../utils/speechTextProcessor';
import type { ProviderTranslateOptions, TranslationProvider } from './TranslationProvider';

const MOCK_KO_DICTIONARY: Readonly<Record<string, string>> = {
  'Good afternoon everyone, and thank you for joining today’s architecture review.':
    '여러분 안녕하십니까, 오늘 아키텍처 리뷰 회의에 참석해 주셔서 감사합니다.',
  'AI is changing the way we work across engineering, operations, and product teams.':
    'AI는 엔지니어링, 운영, 제품 팀 전반에서 우리가 일하는 방식을 바꾸고 있습니다.',
  'It helps us make better decisions by surfacing real-time insights during live meetings.':
    '실시간 회의 중 즉각적인 인사이트를 제공하여 더 나은 의사결정을 내릴 수 있도록 돕습니다.',
  'Before deployment, we need to verify access control policies and ensure that sensitive credentials never reach the client.':
    '배포 전에 접근 제어 정책을 검증하고 민감한 인증 정보가 클라이언트에 절대 노출되지 않도록 보장해야 합니다.',
  'On the projector screen, slides occupy seventy-five percent of the width while bilingual captions stay synchronized on the right.':
    '프로젝터 화면에서 슬라이드는 너비의 75%를 차지하며, 우측에는 이중 언어 자막이 동기화되어 유지됩니다.',
  'Even when a speaker delivers a long, multi-clause explanation with technical terminology, both English and Korean cells wrap naturally inside the same row card.':
    '발표자가 전문 용어가 포함된 긴 복문 설명을 전달하더라도, 영어와 한국어 셀 모두 동일한 행 카드 안에서 자연스럽게 줄바꿈됩니다.',
  'Next, let us examine how asynchronous translation queues prevent slow network responses from blocking incoming speech captions.':
    '다음으로 비동기 번역 큐가 느린 네트워크 응답으로 인해 후속 음성 자막 표시가 지연되는 현상을 어떻게 방지하는지 살펴보겠습니다.',
  'If an attendee looks back at earlier sentences, automatic scrolling pauses cleanly until they return to the latest live caption.':
    '참석자가 이전 문장을 다시 올려다보면, 최신 실시간 자막으로 돌아올 때까지 자동 스크롤이 깔끔하게 일시 중단됩니다.'
};

export class MockTranslationProvider implements TranslationProvider {
  private simulateFailureNext = false;

  public setSimulateFailureNext(shouldFail: boolean): void {
    this.simulateFailureNext = shouldFail;
  }

  public async translate(
    text: string,
    sourceLanguage = 'en',
    targetLanguage = 'ko',
    _captionId?: string,
    options?: ProviderTranslateOptions
  ): Promise<string> {
    const clean = cleanSpokenSttText(text);
    if (!clean) return '';

    const concreteSrc: ConcreteLanguageCode =
      sourceLanguage === 'auto'
        ? detectSpeechLanguage(clean, 'en')
        : (sourceLanguage as ConcreteLanguageCode);
    const concreteTgt = (targetLanguage || 'ko') as ConcreteLanguageCode;

    if (concreteSrc === concreteTgt) {
      return clean;
    }

    // Variable delay (350ms ~ 950ms) to verify source-first display and out-of-order completion safety
    const simulatedDelayMs = options?.isInterim
      ? 220 + ((clean.length * 7) % 280)
      : 380 + ((clean.length * 13) % 580);
    await new Promise((resolve) => globalThis.setTimeout(resolve, simulatedDelayMs));

    if (this.simulateFailureNext) {
      this.simulateFailureNext = false;
      throw new Error('Mock 번역 지연/일시 오류 시뮬레이션 (재시도 버튼으로 복구 가능)');
    }

    const glossary = parseGlossary(options?.glossaryRaw);
    let translated: string;

    if (concreteSrc === 'en' && concreteTgt === 'ko') {
      const exact = MOCK_KO_DICTIONARY[clean];
      translated = exact ?? `[Mock 번역] ${clean}`;
    } else {
      translated = `[${concreteSrc.toUpperCase()}→${concreteTgt.toUpperCase()} Mock] ${clean}`;
    }

    return applyGlossaryToTranslation(clean, translated, glossary);
  }

  public getStatus(): TranslationProviderStatus {
    return {
      providerName: 'MockTranslationProvider',
      isMock: true,
      state: 'ready',
      sourceLanguage: 'auto',
      targetLanguage: 'ko',
      message: '테스트/리허설용 Mock 번역 엔진 활성'
    };
  }
}
