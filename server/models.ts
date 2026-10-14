import { PROVIDERS } from '../shared/providers.ts';
import type { ModelTarget } from './llm.ts';

/** AI SDK 각 프로바이더의 기본 엔드포인트와 동일하게 맞춘다 */
const DEFAULT_BASE: Record<ModelTarget['provider'], string> = {
    openai: 'https://api.openai.com/v1',
    anthropic: 'https://api.anthropic.com/v1',
    google: 'https://generativelanguage.googleapis.com/v1beta',
    xai: 'https://api.x.ai/v1',
    mistral: 'https://api.mistral.ai/v1',
    groq: 'https://api.groq.com/openai/v1',
    deepseek: 'https://api.deepseek.com',
    openrouter: PROVIDERS.openrouter.defaultBaseURL,
    ollama: PROVIDERS.ollama.defaultBaseURL,
    'openai-compatible': PROVIDERS['openai-compatible'].defaultBaseURL,
};

/** 채팅에 쓸 수 없는 모델(임베딩, 음성, 이미지 등)은 목록에서 뺀다 */
const NON_CHAT =
    /(embed|tts|whisper|dall-e|gpt-image|imagen|moderation|transcribe|rerank|realtime|audio|veo|aqa)/i;

/** OpenAI 이미지 API(images/generations·edits)로 쓸 수 있는 모델 */
const IMAGE_MODEL = /^(gpt-image|chatgpt-image|dall-e-2)/i;

interface ModelsBody {
    data?: { id?: string }[];
    models?: { name?: string; supportedGenerationMethods?: string[] }[];
    error?: { message?: string } | string;
    message?: string;
}

/**
 * 프로바이더의 "모델 목록" API를 호출해 채팅 가능한 모델 ID를 돌려준다.
 * OpenAI 호환 형식({ data: [{ id }] })이 대부분이고 Anthropic/Gemini만 헤더·형식이 다르다.
 */
export async function listModels(
    target: ModelTarget,
    kind: 'chat' | 'image' = 'chat'
): Promise<string[]> {
    const info = PROVIDERS[target.provider];
    if (info.keyRequired && !target.apiKey) {
        throw new Error(`${info.label} API 키가 필요합니다.`);
    }
    const base = (target.baseURL || DEFAULT_BASE[target.provider]).replace(
        /\/+$/,
        ''
    );
    const headers: Record<string, string> = { Accept: 'application/json' };
    let url = `${base}/models`;

    if (target.provider === 'anthropic') {
        headers['x-api-key'] = target.apiKey!;
        headers['anthropic-version'] = '2023-06-01';
        url += '?limit=1000';
    } else if (target.provider === 'google') {
        headers['x-goog-api-key'] = target.apiKey!;
        url += '?pageSize=1000';
    } else if (target.apiKey) {
        headers.Authorization = `Bearer ${target.apiKey}`;
    }

    const res = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(15_000),
    });
    let body: ModelsBody = {};
    try {
        body = (await res.json()) as ModelsBody;
    } catch {
        /* JSON이 아닌 응답 */
    }
    if (!res.ok) {
        const detail =
            typeof body.error === 'string'
                ? body.error
                : body.error?.message || body.message || res.statusText;
        throw new Error(`${res.status} ${detail}`.trim());
    }

    const ids =
        target.provider === 'google'
            ? (body.models ?? [])
                  .filter(
                      (m) =>
                          !m.supportedGenerationMethods ||
                          m.supportedGenerationMethods.includes(
                              'generateContent'
                          )
                  )
                  .map((m) => m.name?.replace(/^models\//, ''))
            : (body.data ?? []).map((m) => m.id);

    return [
        ...new Set(
            ids.filter(
                (id): id is string =>
                    !!id &&
                    (kind === 'image'
                        ? IMAGE_MODEL.test(id)
                        : !NON_CHAT.test(id))
            )
        ),
    ].sort((a, b) => a.localeCompare(b));
}
