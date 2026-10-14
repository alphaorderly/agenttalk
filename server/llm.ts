import type { LanguageModel, ToolSet } from 'ai';
import { anthropic, createAnthropic } from '@ai-sdk/anthropic';
import { createDeepSeek } from '@ai-sdk/deepseek';
import { createGoogleGenerativeAI, google } from '@ai-sdk/google';
import { createGroq } from '@ai-sdk/groq';
import { createMistral } from '@ai-sdk/mistral';
import { createOpenAI, openai } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { createXai, xai } from '@ai-sdk/xai';
import { PROVIDERS, type ProviderId } from '../shared/providers.ts';

export interface ModelTarget {
    provider: ProviderId;
    baseURL: string;
    apiKey: string | undefined;
}

/** 프로필 정보로 AI SDK 언어 모델 인스턴스를 만든다 */
export function createModel(
    target: ModelTarget,
    modelId: string
): LanguageModel {
    const info = PROVIDERS[target.provider];
    if (info.keyRequired && !target.apiKey) {
        throw new Error(`${info.label} 프로필에 API 키가 없습니다.`);
    }
    const apiKey = target.apiKey;
    const baseURL = target.baseURL || undefined;

    switch (target.provider) {
        case 'openai':
            return createOpenAI({ apiKey, baseURL })(modelId);
        case 'anthropic':
            return createAnthropic({ apiKey, baseURL })(modelId);
        case 'google':
            return createGoogleGenerativeAI({ apiKey, baseURL })(modelId);
        case 'xai':
            return createXai({ apiKey, baseURL })(modelId);
        case 'mistral':
            return createMistral({ apiKey, baseURL })(modelId);
        case 'groq':
            return createGroq({ apiKey, baseURL })(modelId);
        case 'deepseek':
            return createDeepSeek({ apiKey, baseURL })(modelId);
        case 'openrouter':
        case 'ollama':
        case 'openai-compatible':
            return createOpenAICompatible({
                name: target.provider,
                baseURL: target.baseURL || info.defaultBaseURL,
                apiKey,
            })(modelId);
    }
}

/** 검색 결과를 지역에 맞추기 위한 힌트 */
export interface SearchHint {
    city: string;
    timezone: string;
}

/** 한 번의 발언에서 프로바이더가 실행할 수 있는 최대 검색 횟수 (지원하는 경우) */
const MAX_SEARCH_USES = 2;

/**
 * 프로바이더 내장 웹 검색 도구. 검색은 프로바이더 쪽에서 실행되고 결과는 source 파트로 온다.
 * OpenRouter는 도구 대신 모델 ID에 `:online`을 붙이므로 여기서는 undefined.
 */
export function webSearchTools(
    provider: ProviderId,
    hint: SearchHint
): ToolSet | undefined {
    const userLocation = {
        type: 'approximate' as const,
        ...(hint.city && { city: hint.city }),
        ...(hint.timezone && { timezone: hint.timezone }),
    };
    switch (provider) {
        case 'openai':
            return {
                web_search: openai.tools.webSearch({
                    searchContextSize: 'low',
                    userLocation,
                }),
            };
        case 'anthropic':
            return {
                web_search: anthropic.tools.webSearch_20250305({
                    maxUses: MAX_SEARCH_USES,
                    userLocation,
                }),
            };
        case 'google':
            return { google_search: google.tools.googleSearch({}) };
        case 'xai':
            return { web_search: xai.tools.webSearch({}) };
        default:
            return undefined;
    }
}

const SEARCH_TOOL = /web[_ ]?search|google[_ ]?search|search tool|\btools?\b/i;
const UNSUPPORTED =
    /not supported|unsupported|does ?n[o']t support|not available|not enabled|not allowed|invalid/i;

/**
 * 모델이 검색 도구를 받지 않아 요청이 거절됐는지 (예: "Tool 'web_search_preview' is not supported with gpt-4.1-nano").
 * 같은 프로바이더라도 모델마다 지원이 달라 미리 알 수 없으므로, 거절되면 도구 없이 다시 부른다.
 */
export function isSearchToolRejection(err: unknown): boolean {
    const message = errorMessage(err);
    return SEARCH_TOOL.test(message) && UNSUPPORTED.test(message);
}

/** OpenRouter 웹 검색: 모델 ID 뒤에 `:online`을 붙인다 */
export function onlineModelId(modelId: string) {
    return modelId.endsWith(':online') ? modelId : `${modelId}:online`;
}

/**
 * 모델이 effort(reasoning) 설정을 지원하지 않거나 다른 값으로 바꿔 적용했으면
 * 사용자에게 보여줄 짧은 설명을 돌려준다.
 */
export function reasoningNotice(
    warnings: readonly unknown[] | undefined
): string | null {
    for (const w of warnings ?? []) {
        const { type, feature, details } = w as {
            type?: string;
            feature?: string;
            details?: string;
        };
        if (feature !== 'reasoning') continue;
        if (type === 'unsupported') return 'effort 미지원 (무시됨)';
        const mapped = details?.match(/mapped to (?:effort )?"?([\w-]+)"?/i);
        return mapped ? `effort → ${mapped[1]}` : 'effort 일부만 적용';
    }
    return null;
}

/** 프로바이더 오류에서 사용자에게 보여줄 메시지만 추린다 (요청 헤더/키는 포함하지 않음) */
export function errorMessage(err: unknown): string {
    if (err && typeof err === 'object') {
        // 재시도 래퍼(RetryError)는 마지막 실제 오류를 보여준다
        const last = (err as { lastError?: unknown }).lastError;
        if (last) return errorMessage(last);
        const e = err as {
            statusCode?: number;
            message?: string;
            responseBody?: string;
        };
        let detail = e.message || '';
        if (e.responseBody) {
            try {
                const body = JSON.parse(e.responseBody);
                detail = body?.error?.message || body?.message || detail;
            } catch {
                /* 원문 메시지 사용 */
            }
        }
        return e.statusCode
            ? `${e.statusCode} ${detail}`.trim()
            : detail || '알 수 없는 오류';
    }
    return String(err);
}
