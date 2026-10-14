import { z } from 'zod';

/**
 * 지원하는 LLM 프로바이더 카탈로그. 서버(모델 생성)와 클라이언트(선택 UI)가 함께 쓴다.
 * 모델 목록은 추천값일 뿐이며, 사용자는 임의의 모델 ID를 입력할 수 있다.
 */
export const PROVIDER_IDS = [
    'openai',
    'anthropic',
    'google',
    'xai',
    'mistral',
    'groq',
    'deepseek',
    'openrouter',
    'ollama',
    'openai-compatible',
] as const;

export type ProviderId = (typeof PROVIDER_IDS)[number];

export interface ProviderInfo {
    id: ProviderId;
    label: string;
    /** 목록에 표시할 짧은 설명 */
    hint: string;
    /** 아바타/배지 배경색 */
    color: string;
    keyRequired: boolean;
    /** 빈 값이면 SDK 기본 엔드포인트 사용 */
    defaultBaseURL: string;
    baseURLRequired: boolean;
    keyPlaceholder: string;
    models: string[];
}

export const PROVIDERS: Record<ProviderId, ProviderInfo> = {
    openai: {
        id: 'openai',
        label: 'OpenAI',
        hint: 'GPT 계열',
        color: '#10a37f',
        keyRequired: true,
        defaultBaseURL: '',
        baseURLRequired: false,
        keyPlaceholder: 'sk-...',
        models: [
            'gpt-5-mini',
            'gpt-5',
            'gpt-4.1-mini',
            'gpt-4.1',
            'gpt-4o-mini',
        ],
    },
    anthropic: {
        id: 'anthropic',
        label: 'Anthropic',
        hint: 'Claude 계열',
        color: '#d97757',
        keyRequired: true,
        defaultBaseURL: '',
        baseURLRequired: false,
        keyPlaceholder: 'sk-ant-...',
        models: ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5'],
    },
    google: {
        id: 'google',
        label: 'Google Gemini',
        hint: 'Gemini 계열',
        color: '#4285f4',
        keyRequired: true,
        defaultBaseURL: '',
        baseURLRequired: false,
        keyPlaceholder: 'AIza...',
        models: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.5-flash-lite'],
    },
    xai: {
        id: 'xai',
        label: 'xAI',
        hint: 'Grok 계열',
        color: '#111111',
        keyRequired: true,
        defaultBaseURL: '',
        baseURLRequired: false,
        keyPlaceholder: 'xai-...',
        models: ['grok-4', 'grok-3-mini'],
    },
    mistral: {
        id: 'mistral',
        label: 'Mistral',
        hint: 'Mistral 계열',
        color: '#fa520f',
        keyRequired: true,
        defaultBaseURL: '',
        baseURLRequired: false,
        keyPlaceholder: 'API key',
        models: [
            'mistral-small-latest',
            'mistral-medium-latest',
            'mistral-large-latest',
        ],
    },
    groq: {
        id: 'groq',
        label: 'Groq',
        hint: '초고속 오픈 모델',
        color: '#f55036',
        keyRequired: true,
        defaultBaseURL: '',
        baseURLRequired: false,
        keyPlaceholder: 'gsk_...',
        models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'],
    },
    deepseek: {
        id: 'deepseek',
        label: 'DeepSeek',
        hint: 'DeepSeek 계열',
        color: '#4d6bfe',
        keyRequired: true,
        defaultBaseURL: '',
        baseURLRequired: false,
        keyPlaceholder: 'sk-...',
        models: ['deepseek-chat', 'deepseek-reasoner'],
    },
    openrouter: {
        id: 'openrouter',
        label: 'OpenRouter',
        hint: '여러 모델 게이트웨이',
        color: '#6467f2',
        keyRequired: true,
        defaultBaseURL: 'https://openrouter.ai/api/v1',
        baseURLRequired: true,
        keyPlaceholder: 'sk-or-...',
        models: [
            'openai/gpt-4o-mini',
            'anthropic/claude-sonnet-5.5',
            'google/gemini-2.5-flash',
        ],
    },
    ollama: {
        id: 'ollama',
        label: 'Ollama',
        hint: '로컬 모델 (키 불필요)',
        color: '#555555',
        keyRequired: false,
        defaultBaseURL: 'http://localhost:11434/v1',
        baseURLRequired: true,
        keyPlaceholder: '(선택)',
        models: ['llama3.2', 'qwen2.5', 'gemma3'],
    },
    'openai-compatible': {
        id: 'openai-compatible',
        label: 'OpenAI 호환',
        hint: 'LM Studio, vLLM 등',
        color: '#8a8a8a',
        keyRequired: false,
        defaultBaseURL: 'http://localhost:1234/v1',
        baseURLRequired: true,
        keyPlaceholder: '(선택)',
        models: [],
    },
};

/* ---------------- Effort (추론 강도) ---------------- */

/**
 * AI SDK의 표준 `reasoning` 옵션 값. 각 프로바이더가 자기 방식으로 변환한다
 * (OpenAI reasoningEffort, Anthropic effort/thinking 예산, Gemini thinking 예산 등).
 * 지원하지 않는 모델에서는 무시되고 경고만 남는다.
 */
export const REASONING_LEVELS = [
    'provider-default',
    'none',
    'minimal',
    'low',
    'medium',
    'high',
    'xhigh',
    'max',
] as const;

export type ReasoningLevel = (typeof REASONING_LEVELS)[number];

export const REASONING_LABELS: Record<ReasoningLevel, string> = {
    'provider-default': '프로바이더 기본',
    none: '끄기',
    minimal: '최소',
    low: '낮음',
    medium: '보통',
    high: '높음',
    xhigh: '매우 높음',
    max: '최대',
};

const reasoningSchema = z.enum(REASONING_LEVELS);

/* ---------------- API 페이로드 스키마 (서버 검증 + 클라이언트 타입) ---------------- */

const trimmed = (max: number) => z.string().trim().max(max);

export const profileInputSchema = z
    .object({
        name: trimmed(60).min(1, '이름을 입력하세요'),
        provider: z.enum(PROVIDER_IDS),
        baseURL: z.union([z.literal(''), z.url('올바른 URL이 아닙니다')]),
        defaultModel: trimmed(200).min(1, '기본 모델을 입력하세요'),
        /** 생략하면 생성 시 'provider-default', 수정 시 기존 값 유지 */
        defaultReasoning: reasoningSchema.optional(),
        /**
         * 생성 시: 새 키. 수정 시: 생략(undefined)하면 기존 키 유지, 빈 문자열이면 키 삭제.
         */
        apiKey: trimmed(500).optional(),
    })
    .superRefine((v, ctx) => {
        if (PROVIDERS[v.provider].baseURLRequired && !v.baseURL) {
            ctx.addIssue({
                code: 'custom',
                path: ['baseURL'],
                message: 'Base URL이 필요합니다',
            });
        }
    });

export type ProfileInput = z.infer<typeof profileInputSchema>;

/** 클라이언트에 노출되는 프로필 (API 키 원문은 절대 포함하지 않는다) */
export interface PublicProfile {
    id: string;
    name: string;
    provider: ProviderId;
    baseURL: string;
    defaultModel: string;
    defaultReasoning: ReasoningLevel;
    hasKey: boolean;
    /** 예: "••••a1b2" */
    keyHint: string;
    /** 웹 검색 도구를 거절해 검색 없이 부르는 모델 ID. 프로필을 수정해 저장하면 비우고 다시 확인한다 */
    noSearchModels?: string[];
    createdAt: number;
    updatedAt: number;
}

export interface ProfilesResponse {
    profiles: PublicProfile[];
    defaultProfileId: string | null;
}

/* ---------------- 웹 검색 ---------------- */

/**
 * 내장 웹 검색을 쓸 수 있는 프로바이더.
 * OpenAI/Anthropic/Gemini/xAI는 프로바이더 검색 도구, OpenRouter는 `:online` 모델.
 */
const WEB_SEARCH_PROVIDERS: ReadonlySet<ProviderId> = new Set([
    'openai',
    'anthropic',
    'google',
    'xai',
    'openrouter',
]);

export const supportsWebSearch = (provider: ProviderId) =>
    WEB_SEARCH_PROVIDERS.has(provider);

/** 이 프로필의 이 모델에 검색 도구를 줄 수 있는지 (거절했던 모델은 다시 요청하지 않는다) */
export const canModelSearch = (
    profile: Pick<PublicProfile, 'provider' | 'noSearchModels'>,
    model: string
) =>
    supportsWebSearch(profile.provider) &&
    !profile.noSearchModels?.includes(model);

/** 검색 결과로 공유된 링크 */
export interface SourceLink {
    url: string;
    title: string;
}

export const chatRequestSchema = z.object({
    /** null 이면 기본 프로필 */
    profileId: z.string().max(64).nullable(),
    /** 빈 문자열이면 프로필의 기본 모델 */
    model: trimmed(200),
    /** null 이면 프로필의 기본 effort */
    reasoning: reasoningSchema.nullable(),
    instructions: z.string().max(20_000),
    messages: z
        .array(
            z.object({
                role: z.enum(['user', 'assistant']),
                content: z.string().max(40_000),
            })
        )
        .max(200),
    /** 있으면 이번 발언에 프로바이더 내장 웹 검색 도구를 준다. 쓸지는 에이전트가 정한다 (검색 지역 힌트) */
    search: z
        .object({ city: trimmed(60), timezone: trimmed(60) })
        .nullable()
        .optional(),
});

export type ChatRequest = z.infer<typeof chatRequestSchema>;

/** 프로바이더 접속 정보. 키를 새로 입력하지 않았으면 profileId의 저장된 키를 쓴다. */
export const connectionSchema = z.object({
    /** 저장된 키를 재사용할 프로필 (폼에 새 키를 입력하지 않은 경우) */
    profileId: z.string().max(64).optional(),
    provider: z.enum(PROVIDER_IDS),
    baseURL: z.union([z.literal(''), z.url()]),
    apiKey: trimmed(500).optional(),
    /** 'image'면 이미지 생성 모델만 돌려준다 (기본: 채팅 모델) */
    kind: z.enum(['chat', 'image']).optional(),
});

export type ConnectionRequest = z.infer<typeof connectionSchema>;

export const testRequestSchema = connectionSchema.extend({
    model: trimmed(200).min(1),
    reasoning: reasoningSchema.optional(),
});

export type TestRequest = z.infer<typeof testRequestSchema>;

/** 에이전트 말수: 진행 모델이 얼마나 자주 고를지 참고한다 */
export const TALK_LEVELS = ['quiet', 'normal', 'chatty'] as const;

export type TalkLevel = (typeof TALK_LEVELS)[number];

export const TALK_LABELS: Record<TalkLevel, string> = {
    quiet: '조용',
    normal: '보통',
    chatty: '수다',
};

/** 소개(페르소나) 최대 길이 */
export const PERSONA_MAX = 4000;
/** 말투·행동 최대 길이 */
export const STYLE_MAX = 2000;
/** 관계·요즘 최대 길이 */
export const RELATIONS_MAX = 1000;

/** 에이전트 소개(페르소나) AI 리라이팅 요청 */
export const rewritePersonaSchema = z.object({
    /** null 이면 기본 프로필 */
    profileId: z.string().max(64).nullable(),
    /** 빈 문자열이면 프로필의 기본 모델 */
    model: trimmed(200),
    /** null 이면 프로필의 기본 effort */
    reasoning: reasoningSchema.nullable(),
    agentName: trimmed(30).min(1),
    brief: trimmed(PERSONA_MAX).min(1, '소개를 먼저 적어 주세요'),
    /**
     * 지금의 말투·행동. 비어 있으면 소개와 함께 말투·행동도 채워 돌려준다(style).
     * 있으면 소개만 다시 쓰고, 이 말투와 어긋나지 않게 참고만 한다.
     */
    style: trimmed(STYLE_MAX).default(''),
    roomName: trimmed(60),
    topic: trimmed(2000),
    /** 캐릭터가 겹치지 않도록 참고할 다른 멤버들 */
    others: z
        .array(
            z.object({
                name: trimmed(30),
                persona: trimmed(PERSONA_MAX),
                style: trimmed(STYLE_MAX).default(''),
            })
        )
        .max(30),
});

export type RewritePersonaRequest = z.infer<typeof rewritePersonaSchema>;

/** 에이전트 말투·행동 AI 리라이팅 요청. 메모가 비어 있으면 소개만 보고 새로 쓴다 */
export const rewriteStyleSchema = z
    .object({
        profileId: z.string().max(64).nullable(),
        model: trimmed(200),
        reasoning: reasoningSchema.nullable(),
        agentName: trimmed(30).min(1),
        brief: trimmed(STYLE_MAX),
        persona: trimmed(PERSONA_MAX),
        roomName: trimmed(60),
        topic: trimmed(2000),
        /** 말투가 겹치지 않도록 참고할 다른 멤버들 */
        others: z
            .array(
                z.object({
                    name: trimmed(30),
                    style: trimmed(STYLE_MAX),
                })
            )
            .max(30),
    })
    .refine((r) => r.brief || r.persona, {
        message: '소개나 말투를 먼저 적어 주세요',
        path: ['brief'],
    });

export type RewriteStyleRequest = z.infer<typeof rewriteStyleSchema>;

/** 대화 주제/상황 AI 리라이팅 요청 */
export const rewriteTopicSchema = z.object({
    profileId: z.string().max(64).nullable(),
    model: trimmed(200),
    reasoning: reasoningSchema.nullable(),
    roomName: trimmed(60),
    brief: trimmed(2000).min(1, '주제를 먼저 적어 주세요'),
    /** 멤버들이 의견을 낼 거리가 생기도록 참고 */
    members: z
        .array(z.object({ name: trimmed(30), persona: trimmed(4000) }))
        .max(30),
});

export type RewriteTopicRequest = z.infer<typeof rewriteTopicSchema>;

/** 방에 넣을 수 있는 최대 에이전트 수 (진행 모델 멤버 목록 한도와 같음) */
export const MAX_AGENTS = 30;

/** 주제와 현재 멤버를 보고 새 에이전트를 자동 생성하는 요청 (서버가 기획 → 상세화로 한 번에 처리) */
export const generateAgentsSchema = z
    .object({
        profileId: z.string().max(64).nullable(),
        model: trimmed(200),
        reasoning: reasoningSchema.nullable(),
        roomName: trimmed(60),
        topic: trimmed(2000).min(1, '대화 주제를 먼저 적어 주세요'),
        /** 사용자가 정한 생성 규칙 (인원 구성, 역할 배정, 말투 등) */
        castingRules: trimmed(2000).default(''),
        /** 현재 방 모드의 생성 지침. 사용자 생성 규칙과 충돌하면 먼저 따른다 */
        modeContext: trimmed(2000).optional(),
        /** 다른 멤버에게 소개 첫 문장을 미리 공개하는지. 이전 요청은 공개로 취급한다 */
        shareIntroductions: z.boolean().optional(),
        count: z.number().int().min(1).max(MAX_AGENTS),
        /** secret은 사용자 규칙의 역할 배정을 기존 멤버까지 합쳐 맞추기 위해 캐스팅에만 넘긴다 */
        existing: z
            .array(
                z.object({
                    name: trimmed(30),
                    persona: trimmed(PERSONA_MAX),
                    style: trimmed(STYLE_MAX).default(''),
                    talk: z.enum(TALK_LEVELS).default('normal'),
                    secret: trimmed(2000).default(''),
                    relations: trimmed(RELATIONS_MAX).default(''),
                })
            )
            .max(MAX_AGENTS),
    })
    .refine((req) => req.existing.length + req.count <= MAX_AGENTS, {
        path: ['count'],
        message: `에이전트는 최대 ${MAX_AGENTS}명까지 둘 수 있습니다.`,
    });

export type GenerateAgentsRequest = z.infer<typeof generateAgentsSchema>;

export interface GeneratedAgent {
    name: string;
    emoji: string;
    /** 캐릭터 소개. 방 설정에 따라 다른 멤버에게 첫 문장을 미리 공개한다 */
    persona: string;
    /** 말투·행동. 모델이 쓰지 않았으면 빈 문자열(기본 말투) */
    style: string;
    talk: TalkLevel;
    /** 이 멤버만 알아야 할 비공개 정보(비밀). 없으면 빈 문자열 */
    secret: string;
    /** 다른 멤버와의 관계와 요즘 근황. 없으면 빈 문자열 */
    relations: string;
}

/**
 * /api/generate-agents 의 NDJSON 이벤트.
 * plan(명단 확정) → 멤버마다 agent 또는 failed → done 순서. 어느 단계든 치명적이면 error로 끝난다.
 * agent·failed의 index는 plan.members 안의 위치이며 완료 순서대로 온다.
 */
export type CastingEvent =
    | { type: 'plan'; members: { name: string; emoji: string }[] }
    | { type: 'agent'; index: number; agent: GeneratedAgent }
    | { type: 'failed'; index: number; error: string }
    | { type: 'done'; via: string }
    | { type: 'error'; message: string };

/** AI 리라이팅(에이전트 소개·말투, 대화 주제) 공통 응답 */
export type RewriteResponse =
    | {
          ok: true;
          text: string;
          /** 소개 다듬기에서 말투·행동도 함께 채웠으면 그 내용 */
          style?: string;
          via: string;
      }
    | { ok: false; error: string };

/** 방 진행(관리) 모델에게 "다음에 누가 말할지" 묻는 요청 */
export const moderateRequestSchema = z.object({
    /** null 이면 기본 프로필 */
    profileId: z.string().max(64).nullable(),
    /** 빈 문자열이면 프로필의 기본 모델 */
    model: trimmed(200),
    /** null 이면 프로필의 기본 effort */
    reasoning: reasoningSchema.nullable(),
    roomName: trimmed(60),
    topic: trimmed(2000),
    userName: trimmed(30),
    /** 1번부터 번호가 매겨진다 */
    members: z
        .array(
            z.object({
                /** 표시 이름이 같아도 응답자를 구분하는 ID */
                id: z.string().max(64).optional(),
                name: trimmed(30),
                persona: trimmed(PERSONA_MAX),
                /** 없으면 보통 */
                talk: z.enum(TALK_LEVELS).optional(),
            })
        )
        .min(1)
        .max(30),
    /** 사용자의 현재 날짜/시각 (예: "2026년 10월 12일 월요일 오후 6:40") */
    now: trimmed(60).optional(),
    /** 사용자 지역 (예: "부산"). 빈 문자열이면 모름 */
    location: trimmed(60).optional(),
    transcript: z
        .array(
            z.object({
                speaker: trimmed(40),
                text: z.string().max(8000),
                /** 귓속말이면 받는 사람 이름들 (당사자만 볼 수 있음) */
                to: z.array(trimmed(40)).max(30).optional(),
            })
        )
        .max(60),
    /** 최근 대화가 잘려도 놓치지 않도록 전체 기록에서 찾은 마지막 인간 요청 */
    latestUserRequest: z
        .object({
            id: z.string().max(64),
            text: z.string().max(8000),
            /** 귓속말의 실제 수신자 이름. 본문의 @언급과 구분한다 */
            to: z.array(trimmed(40)).max(30).optional(),
        })
        .nullable()
        .optional(),
    /** 그 요청 이후 실제로 발언한 멤버. 요청에 답했는지는 진행 모델이 판단한다 */
    respondedMembers: z
        .array(z.object({ id: z.string().max(64), name: trimmed(40) }))
        .max(30)
        .optional(),
    /** 사람 입력 이후(또는 수동 재개 이후) 실제 발언 생성 호출 수 */
    agentStreak: z.number().int().min(0),
    /** 사용자가 ▶를 눌러 직접 이어가기를 요청한 첫 판단이면 true */
    nudge: z.boolean(),
});

export type ModerateRequest = z.infer<typeof moderateRequestSchema>;

/** 진행 모델이 고른 후보. note는 지시가 아니라 그 사람에게 알려 줄 상황 정보다 */
export interface ModeratorCandidate {
    /** 1부터 시작하는 멤버 번호 */
    speaker: number;
    /** 예: "철수가 너에게 직접 물었음" (없으면 '') */
    note: string;
}

export type ModerateResponse =
    | {
          ok: true;
          /**
           * 다음에 말할 후보(최대 2명, 우선순위 순). 첫 후보가 패스하면 다음 후보가 받는다.
           * 비어 있으면 아무도 말하지 않고 대화를 멈춘다.
           */
          candidates: ModeratorCandidate[];
          waitMs: number;
          reason: string;
          via: string;
      }
    | { ok: false; error: string };

export type ModelsResponse =
    | { ok: true; models: string[] }
    | { ok: false; error: string };

/** 메시지/토스트에 보여줄 "프로바이더 · 모델 · effort" 라벨 */
export function describeModel(
    provider: ProviderId,
    model: string,
    reasoning: ReasoningLevel
) {
    const parts = [PROVIDERS[provider].label, model];
    if (reasoning !== 'provider-default') {
        parts.push(`effort ${REASONING_LABELS[reasoning]}`);
    }
    return parts.join(' · ');
}

/** /api/chat 응답은 NDJSON 이벤트 스트림 */
export type ChatStreamEvent =
    | {
          type: 'meta';
          provider: ProviderId;
          model: string;
          reasoning: ReasoningLevel;
          profileName: string;
      }
    | { type: 'delta'; text: string }
    /** 모델이 내장 웹 검색을 시작함 */
    | { type: 'search'; query: string }
    /** 검색 결과 출처 */
    | ({ type: 'source' } & SourceLink)
    /** 모델이 설정 일부(예: effort)를 지원하지 않아 무시된 경우 */
    | { type: 'warning'; message: string }
    /** 이 모델이 웹 검색 도구를 거절해 검색 없이 다시 불렀고, 프로필에 기록했다 */
    | { type: 'searchUnsupported' }
    | { type: 'error'; message: string }
    | { type: 'done' };
