import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { generateText, Output, streamText } from 'ai';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { HTTPException } from 'hono/http-exception';
import path from 'node:path';
import { z } from 'zod';
import {
    chatRequestSchema,
    connectionSchema,
    profileInputSchema,
    rewritePersonaSchema,
    rewriteStyleSchema,
    rewriteTopicSchema,
    PERSONA_MAX,
    STYLE_MAX,
    generateAgentsSchema,
    moderateRequestSchema,
    testRequestSchema,
    type ChatStreamEvent,
    type ConnectionRequest,
    type ModelsResponse,
    type RewriteResponse,
    type RewriteTopicRequest,
    type CastingEvent,
    type ModerateResponse,
    describeModel,
    canModelSearch,
} from '../shared/providers.ts';
import {
    createModel,
    errorMessage,
    onlineModelId,
    reasoningNotice,
    isSearchToolRejection,
    webSearchTools,
} from './llm.ts';
import {
    moderatorInstructions,
    moderatorPrompt,
    parseDecision,
} from './moderator.ts';
import { listModels } from './models.ts';
import { parsePersonaAndStyle } from './agents.ts';
import { castAgents, type CastingCall } from './casting/generate.ts';
import { ndjsonResponse } from './ndjson.ts';
import { ProfileNotFoundError, ProfileStore } from './store.ts';
import {
    roomStatusRequestSchema,
    type RoomStatusResponse,
} from '../shared/room-status.ts';
import {
    ROOM_STATUS_INSTRUCTIONS,
    roomStatusPrompt,
    parseRoomStatus,
    isApprovedRoomStatusDestination,
} from './room-status.ts';
import type { ModeActionResponse } from '../shared/modes/action.ts';
import { modeActionOf } from './modes/index.ts';
import { createImage, ImageStore } from './images.ts';
import { ChatDatabase, PresetNotFoundError } from './db.ts';
import {
    ownerStatusSchema,
    presetInputSchema,
    presetRenameSchema,
    roomSyncSchema,
    type RoomsResponse,
} from '../shared/rooms.ts';
import {
    IMAGE_ID,
    imageRequestSchema,
    type ImageResponse,
} from '../shared/images.ts';

const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? '127.0.0.1';
const DATA_DIR = path.resolve(process.env.AGENTTALK_DATA_DIR ?? 'data');
const IS_PROD = process.env.NODE_ENV === 'production';

// effort 미지원 같은 경고는 응답에 담아 UI로 보내므로 콘솔 로그는 끈다
(globalThis as { AI_SDK_LOG_WARNINGS?: boolean }).AI_SDK_LOG_WARNINGS = false;

const store = await ProfileStore.open(DATA_DIR);
const images = await ImageStore.open(DATA_DIR);
const db = await ChatDatabase.open(DATA_DIR);
const app = new Hono();

/**
 * DNS 리바인딩 방어: 로컬 호스트 이름으로 들어온 요청만 허용한다.
 * (CORS 헤더를 내보내지 않으므로 다른 사이트의 JS는 응답을 읽을 수 없다)
 */
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;
app.use('*', async (c, next) => {
    if (!LOCAL_HOST.test(c.req.header('host') ?? '')) {
        return c.text('Forbidden host', 403);
    }
    await next();
});

// 방 저장(대화 기록 이전 포함)만 큰 본문을 허용한다
const smallBody = bodyLimit({ maxSize: 1024 * 1024 });
const roomBody = bodyLimit({ maxSize: 32 * 1024 * 1024 });
app.use('/api/*', (c, next) =>
    (c.req.path.startsWith('/api/rooms/') ? roomBody : smallBody)(c, next)
);

/** JSON 바디를 zod 스키마로 검증 */
async function parseBody<T>(req: Request, schema: z.ZodType<T>): Promise<T> {
    let json: unknown;
    try {
        json = await req.json();
    } catch {
        throw new HTTPException(400, { message: 'JSON 본문이 필요합니다.' });
    }
    const result = schema.safeParse(json);
    if (!result.success) {
        throw new HTTPException(400, {
            message: result.error.issues
                .map((i) => `${i.path.join('.')}: ${i.message}`)
                .join(', '),
        });
    }
    return result.data;
}

app.onError((err, c) => {
    if (err instanceof HTTPException)
        return c.json({ error: err.message }, err.status);
    if (err instanceof ProfileNotFoundError)
        return c.json({ error: '프로필을 찾을 수 없습니다.' }, 404);
    if (err instanceof PresetNotFoundError)
        return c.json({ error: '프리셋을 찾을 수 없습니다.' }, 404);
    console.error('[agenttalk]', err);
    return c.json({ error: '서버 오류가 발생했습니다.' }, 500);
});

/* ---------------- 프로필 ---------------- */

app.get('/api/profiles', (c) => c.json(store.list()));

app.post('/api/profiles', async (c) => {
    const input = await parseBody(c.req.raw, profileInputSchema);
    return c.json(await store.create(input), 201);
});

app.put('/api/profiles/:id', async (c) => {
    const input = await parseBody(c.req.raw, profileInputSchema);
    return c.json(await store.update(c.req.param('id'), input));
});

app.delete('/api/profiles/:id', async (c) => {
    await store.remove(c.req.param('id'));
    return c.body(null, 204);
});

app.put('/api/default-profile', async (c) => {
    const { id } = await parseBody(c.req.raw, z.object({ id: z.string() }));
    await store.setDefault(id);
    return c.body(null, 204);
});

/**
 * 요청에 쓸 API 키: 새로 입력한 키 → 같은 프로바이더의 저장된 키 순.
 * 폼에서 프로바이더를 바꾼 경우 기존 키를 다른 엔드포인트로 보내지 않는다.
 */
function connectionKey(req: ConnectionRequest): string | undefined {
    if (req.apiKey) return req.apiKey;
    if (!req.profileId) return undefined;
    const stored = store.resolve(req.profileId);
    return stored.provider === req.provider ? stored.apiKey : undefined;
}

/** 저장 전/후 연결 테스트 */
app.post('/api/test', async (c) => {
    const req = await parseBody(c.req.raw, testRequestSchema);
    const apiKey = connectionKey(req);
    try {
        const model = createModel(
            { provider: req.provider, baseURL: req.baseURL, apiKey },
            req.model
        );
        const { text } = await generateText({
            model,
            reasoning: req.reasoning,
            prompt: 'Reply with the single word: pong',
            maxRetries: 0,
            abortSignal: AbortSignal.timeout(30_000),
        });
        return c.json({ ok: true, reply: text.trim().slice(0, 40) });
    } catch (err) {
        return c.json({ ok: false, error: errorMessage(err) });
    }
});

/** 프로바이더에서 사용 가능한 모델 목록 조회 */
app.post('/api/models', async (c) => {
    const req = await parseBody(c.req.raw, connectionSchema);
    try {
        const models = await listModels(
            {
                provider: req.provider,
                baseURL: req.baseURL,
                apiKey: connectionKey(req),
            },
            req.kind
        );
        return c.json<ModelsResponse>({ ok: true, models });
    } catch (err) {
        return c.json<ModelsResponse>({ ok: false, error: errorMessage(err) });
    }
});

/* ---------------- AI 도우미: 에이전트 설명 리라이팅 ---------------- */

/** 소개에 담을 것. 말투는 별도 칸(말투·행동)이 맡는다 */
const PERSONA_GUIDE = `소개(다른 멤버도 볼 수 있는 공개 설명)에 담을 것:
- 성격과 가치관, 대화 주제/상황 속 처지와 배경(설정에 맞으면 역할/직업/전문 분야)
- 이 상황에 대한 입장과 감정
- 이 사람다움을 보여 주는 구체적인 경험이나 취향 (상황 설정과 어울리는 것만)
- "~한 사람." 같은 설명문 3~5문장, 한국어 평문. 첫 문장은 다른 멤버에게 한 줄 소개로 보이므로 이 사람의 핵심을 담는다.
- 말투, 말버릇, 말투 예시, 다른 멤버와의 관계는 소개에 쓰지 않는다.
- 진행 절차, 차례 지키기, 게임 규칙 준수 같은 행동 규칙은 쓰지 않는다. 그건 대화 상황과 모드가 맡는다.`;

/** 말투·행동에 담을 것. 예전 공통 말투 규칙의 노하우를 캐릭터별로 녹인다 */
const STYLE_GUIDE = `말투·행동(이 캐릭터를 연기할 AI만 보는 지침)에 담을 것:
- 말투: 반말·존댓말, 줄임말·웃음 표시·이모티콘을 쓰는지 (이 사람과 대화 주제/상황에 어울릴 때만)
- 말 길이와 습관: 한두 마디로 끝내는지, 길게 설명하는지, 말풍선을 여러 개로 끊어 보내는지. 상황이 달라지면 어떻게 바뀌는지(예: 압박을 받으면 말이 짧아짐)
- 반응 성향: 어떤 말에 반응하는지, 따지는지 감싸는지, 질문을 많이 하는지, 조용히 지켜보는지
- 감정 표현: 무엇에 흔들리고 무엇에 발끈하는지, 감정을 드러내는지 숨기는지
- 2~4문장 설명문으로 쓴다. 자주 쓰는 어미나 단어 같은 말버릇은 짧은 표현 몇 개로만 적고, 그대로 보낼 수 있는 완성된 대사나 예시 문장은 쓰지 않는다(예시가 있으면 상황과 상관없이 그 문장을 따라 하게 된다).
- 분위기는 대화 주제/상황을 따른다. 설정에 없는 밝음이나 심각함을 덧붙이지 않는다.
- AI 비서처럼 들리지 않는, 실제 사람의 말버릇이어야 한다.`;

const PERSONA_INSTRUCTIONS = `너는 멀티 에이전트 단체 채팅용 캐릭터 설계자다.
사용자가 짧게 적은 캐릭터 메모를 캐릭터 소개로 다시 써라.

${PERSONA_GUIDE}

규칙:
- 메모의 내용을 바꾸거나 모순되게 만들지 말고, 빈 부분만 자연스럽게 채운다.
- 이 캐릭터의 말투·행동은 따로 정해져 있다. 그와 어긋나지 않게 쓴다.
- 다른 멤버와 성격·입장이 겹치지 않게 차별화한다.
- 제목, 마크다운, 캐릭터 이름 접두어 없이 소개 본문만 출력한다.`;

const PERSONA_AND_STYLE_INSTRUCTIONS = `너는 멀티 에이전트 단체 채팅용 캐릭터 설계자다.
사용자가 짧게 적은 캐릭터 메모로 캐릭터의 소개와 말투·행동을 함께 써라.

${PERSONA_GUIDE}

${STYLE_GUIDE}

규칙:
- 메모의 내용을 바꾸거나 모순되게 만들지 말고, 빈 부분만 자연스럽게 채운다.
- 메모에 말투에 관한 내용(반말, 존댓말, 말버릇 등)이 있으면 소개가 아니라 말투·행동으로 옮긴다.
- 다른 멤버와 성격·말투가 겹치지 않게 차별화한다.

출력은 JSON만 쓴다. 다른 글은 쓰지 않는다.
{"persona":"소개...","style":"말투와 행동..."}`;

const STYLE_INSTRUCTIONS = `너는 멀티 에이전트 단체 채팅용 캐릭터 설계자다.
캐릭터 소개와 사용자가 짧게 적은 말투 메모를 보고, 이 캐릭터의 말투·행동을 써라. 메모가 없으면 소개에 어울리게 새로 정한다.

${STYLE_GUIDE}

규칙:
- 메모의 내용을 바꾸거나 모순되게 만들지 말고, 빈 부분만 자연스럽게 채운다.
- 소개에 적힌 성격과 어울리게 쓴다. 소개 내용을 다시 옮겨 적지 않는다.
- 다른 멤버와 말투·반응 성향이 겹치지 않게 차별화한다.
- 제목, 마크다운, 캐릭터 이름 접두어 없이 본문만 출력한다.`;

const TOPIC_INSTRUCTIONS = `너는 멀티 에이전트 단체 채팅방의 상황 설계자다.
사용자가 짧게 적은 대화 주제 메모를, 채팅방 멤버 모두에게 공유될 "대화 상황 설명"으로 다시 써라.

포함할 것:
- 어떤 상황인지: 언제, 어디서, 왜 이 대화를 하게 됐는지
- 분위기와 긴장도: 메모가 정한 그대로 살린다(편한 잡담, 급한 결정, 들뜬 자리, 위험하거나 무거운 상황 등). 메모에 없는 밝음이나 심각함을 덧붙이지 않는다
- 정하거나 얻어야 할 것이 있으면 그 목표와 조건. 메모에 없으면 억지로 만들지 않는다

규칙:
- 멤버 모두가 똑같이 보는 공개 설정만 쓴다. 특정 멤버만 알아야 하는 정보(게임 속 역할 배정, 숨긴 목적 등)는 쓰지 않는다. 그런 건 각 멤버의 비밀 정보 칸에 따로 적는다.
- 멤버들이 채팅으로 직접 할 수 있는 일만 쓴다. "사회자가 진행한다", "자동으로 배정된다", "시스템이 판정한다"처럼 채팅방 밖의 누군가가 해 준다고 가정하지 않는다. 진행자가 필요하면 멤버 중 한 명에게 그 역할을 맡긴다.
- 메모의 의도를 바꾸지 말고, 빈 부분만 자연스럽게 채운다.
- 멤버들의 성격을 참고해, 각자 의견을 내거나 부딪힐 거리가 생기도록 쓴다.
- 특정 멤버의 대사나 결론을 미리 쓰지 않는다.
- 3~5문장, 한국어 평문으로 쓴다. 제목, 목록 기호, 마크다운, 따옴표 없이 본문만 출력한다.`;

type ModelTargetFields = Pick<
    RewriteTopicRequest,
    'profileId' | 'model' | 'reasoning'
>;

/** AI 도우미 공통 호출: 프로필/모델/effort 해석 → 생성. 결과 텍스트와 "모델 · effort" 라벨을 돌려준다. */
async function runAssistant(
    signal: AbortSignal,
    target: ModelTargetFields,
    instructions: string,
    prompt: string,
    maxRetries = 1
) {
    const profile = store.resolve(target.profileId);
    const modelId = target.model || profile.defaultModel;
    const reasoning = target.reasoning ?? profile.defaultReasoning;
    const { text, warnings } = await generateText({
        model: createModel(profile, modelId),
        reasoning,
        instructions,
        prompt,
        maxRetries,
        abortSignal: AbortSignal.any([signal, AbortSignal.timeout(90_000)]),
    });
    const via = [
        describeModel(profile.provider, modelId, reasoning),
        reasoningNotice(warnings),
    ]
        .filter(Boolean)
        .join(' · ⚠ ');
    return { text, via };
}

/** 리라이팅: 생성 결과에서 감싼 따옴표를 정리하고 길이를 맞춘다 */
async function rewrite(
    signal: AbortSignal,
    target: ModelTargetFields,
    instructions: string,
    prompt: string,
    maxLength: number
): Promise<RewriteResponse> {
    try {
        const { text, via } = await runAssistant(
            signal,
            target,
            instructions,
            prompt
        );
        const cleaned = text
            .trim()
            .replace(/^["'“”]+|["'“”]+$/g, '')
            .trim()
            .slice(0, maxLength);
        if (!cleaned) throw new Error('모델이 빈 응답을 돌려줬습니다.');
        return { ok: true, text: cleaned, via };
    } catch (err) {
        return { ok: false, error: errorMessage(err) };
    }
}

const memberLines = (members: { name: string; persona: string }[]) =>
    members.map((m) => `- ${m.name}: ${m.persona || '(설명 없음)'}`).join('\n');

app.post('/api/rewrite-persona', async (c) => {
    const req = await parseBody(c.req.raw, rewritePersonaSchema);
    // 말투·행동이 비어 있으면 소개와 함께 채운다
    const withStyle = !req.style;
    const others = req.others.map((m) =>
        withStyle && m.style
            ? { ...m, persona: `${m.persona}\n  (말투: ${m.style})` }
            : m
    );
    const prompt = [
        `캐릭터 이름: ${req.agentName}`,
        req.roomName && `채팅방: ${req.roomName}`,
        req.topic && `대화 주제/상황: ${req.topic}`,
        others.length > 0 && `다른 멤버:\n${memberLines(others)}`,
        req.style &&
            `\n이 캐릭터의 말투·행동(참고만, 다시 쓰지 않는다):\n${req.style}`,
        `\n다시 쓸 메모:\n${req.brief}`,
    ]
        .filter(Boolean)
        .join('\n');
    if (!withStyle)
        return c.json(
            await rewrite(
                c.req.raw.signal,
                req,
                PERSONA_INSTRUCTIONS,
                prompt,
                PERSONA_MAX
            )
        );
    try {
        const { text, via } = await runAssistant(
            c.req.raw.signal,
            req,
            PERSONA_AND_STYLE_INSTRUCTIONS,
            prompt
        );
        const { persona, style } = parsePersonaAndStyle(text);
        return c.json<RewriteResponse>({ ok: true, text: persona, style, via });
    } catch (err) {
        return c.json<RewriteResponse>({ ok: false, error: errorMessage(err) });
    }
});

app.post('/api/rewrite-style', async (c) => {
    const req = await parseBody(c.req.raw, rewriteStyleSchema);
    const others = req.others.filter((m) => m.style);
    const prompt = [
        `캐릭터 이름: ${req.agentName}`,
        req.roomName && `채팅방: ${req.roomName}`,
        req.topic && `대화 주제/상황: ${req.topic}`,
        req.persona && `\n이 캐릭터의 소개:\n${req.persona}`,
        others.length > 0 &&
            `\n다른 멤버의 말투:\n${others.map((m) => `- ${m.name}: ${m.style}`).join('\n')}`,
        `\n다시 쓸 말투 메모:\n${req.brief || '(없음. 소개에 어울리게 새로 정한다)'}`,
    ]
        .filter(Boolean)
        .join('\n');
    return c.json(
        await rewrite(
            c.req.raw.signal,
            req,
            STYLE_INSTRUCTIONS,
            prompt,
            STYLE_MAX
        )
    );
});

app.post('/api/rewrite-topic', async (c) => {
    const req = await parseBody(c.req.raw, rewriteTopicSchema);
    const prompt = [
        req.roomName && `채팅방: ${req.roomName}`,
        req.members.length > 0 && `멤버:\n${memberLines(req.members)}`,
        `\n다시 쓸 주제 메모:\n${req.brief}`,
    ]
        .filter(Boolean)
        .join('\n');
    // 방 설정 폼의 주제 최대 길이(2000자)에 맞춘다
    return c.json(
        await rewrite(c.req.raw.signal, req, TOPIC_INSTRUCTIONS, prompt, 2000)
    );
});

/** 주제와 현재 멤버를 보고 새 에이전트를 기획 → 상세화해 NDJSON으로 흘려보낸다 */
app.post('/api/generate-agents', async (c) => {
    const req = await parseBody(c.req.raw, generateAgentsSchema);
    const signal = c.req.raw.signal;
    return ndjsonResponse<CastingEvent>(async (send) => {
        try {
            const profile = store.resolve(req.profileId);
            const modelId = req.model || profile.defaultModel;
            const reasoning = req.reasoning ?? profile.defaultReasoning;
            const model = createModel(profile, modelId);
            let notice: string | null = null;
            const call: CastingCall = async (
                instructions,
                prompt,
                schema,
                timeoutMs
            ) => {
                const { output, warnings } = await generateText({
                    model,
                    reasoning,
                    instructions,
                    prompt,
                    output: Output.object({ schema }),
                    maxRetries: 1,
                    abortSignal: AbortSignal.any([
                        signal,
                        AbortSignal.timeout(timeoutMs),
                    ]),
                });
                notice ??= reasoningNotice(warnings);
                return output;
            };
            for await (const event of castAgents(req, { call, signal }))
                send(event);
            send({
                type: 'done',
                via: [
                    describeModel(profile.provider, modelId, reasoning),
                    notice,
                ]
                    .filter(Boolean)
                    .join(' · ⚠ '),
            });
        } catch (err) {
            if (!signal.aborted)
                send({ type: 'error', message: errorMessage(err) });
        }
    });
});

/* ---------------- 인간 전용 방 상태: 읽기 전용 요약 ---------------- */

app.post('/api/room-status', async (c) => {
    const req = await parseBody(c.req.raw, roomStatusRequestSchema);
    try {
        const profile = store.resolve(req.profileId);
        if (!isApprovedRoomStatusDestination(profile)) {
            return c.json<RoomStatusResponse>(
                {
                    ok: false,
                    error: '방 상태 요약은 승인된 OpenAI API 프로필을 선택하세요.',
                },
                400
            );
        }
        const { text, via } = await runAssistant(
            c.req.raw.signal,
            { ...req, profileId: profile.id },
            ROOM_STATUS_INSTRUCTIONS,
            roomStatusPrompt(req)
        );
        return c.json<RoomStatusResponse>({
            ok: true,
            status: parseRoomStatus(text),
            via,
        });
    } catch (err) {
        return c.json<RoomStatusResponse>({
            ok: false,
            error: errorMessage(err),
        });
    }
});

/* ---------------- 모드별 AI 작업 (server/modes) ---------------- */

app.post('/api/modes/:mode/:action', async (c) => {
    const action = modeActionOf(c.req.param('mode'), c.req.param('action'));
    if (!action)
        throw new HTTPException(404, {
            message: '모드 작업을 찾을 수 없습니다.',
        });
    const req = await parseBody(c.req.raw, action.schema);
    try {
        const { text, via } = await runAssistant(
            c.req.raw.signal,
            req,
            action.instructions,
            action.prompt(req)
        );
        return c.json<ModeActionResponse<object>>({
            ok: true,
            ...action.parse(text),
            via,
        });
    } catch (err) {
        return c.json<ModeActionResponse<object>>({
            ok: false,
            error: errorMessage(err),
        });
    }
});

/* ---------------- 채팅방 · 메시지 (SQLite) ---------------- */

app.get('/api/rooms', (c) =>
    c.json<RoomsResponse>({
        rooms: db.listRooms(),
        ownerStatuses: db.listOwnerStatuses(),
    })
);

app.put('/api/rooms/:id', async (c) => {
    const change = await parseBody(c.req.raw, roomSyncSchema);
    if (change.room.id !== c.req.param('id'))
        throw new HTTPException(400, { message: '방 ID가 일치하지 않습니다.' });
    db.syncRoom(c.req.param('id'), change);
    return c.body(null, 204);
});

app.delete('/api/rooms/:id', (c) => {
    db.deleteRoom(c.req.param('id'));
    return c.body(null, 204);
});

app.put('/api/rooms/:id/owner-status', async (c) => {
    const status = await parseBody(c.req.raw, ownerStatusSchema);
    if (!db.setOwnerStatus(c.req.param('id'), status))
        throw new HTTPException(404, { message: '방을 찾을 수 없습니다.' });
    return c.body(null, 204);
});

app.delete('/api/rooms/:id/owner-status', (c) => {
    db.deleteOwnerStatus(c.req.param('id'));
    return c.body(null, 204);
});

/* ---------------- 프리셋 ---------------- */

app.get('/api/presets', (c) => c.json(db.listPresets()));

app.post('/api/presets', async (c) => {
    const input = await parseBody(c.req.raw, presetInputSchema);
    return c.json(db.createPreset(input.name, input.room), 201);
});

app.put('/api/presets/:id', async (c) => {
    const { name } = await parseBody(c.req.raw, presetRenameSchema);
    return c.json(db.renamePreset(c.req.param('id'), name));
});

app.delete('/api/presets/:id', (c) => {
    db.deletePreset(c.req.param('id'));
    return c.body(null, 204);
});

/* ---------------- 이미지 생성 (OpenAI) ---------------- */

app.post('/api/images', async (c) => {
    const req = await parseBody(c.req.raw, imageRequestSchema);
    try {
        const profile = store.resolve(req.profileId);
        const reference = req.reference
            ? await images.read(req.reference)
            : null;
        if (req.reference && !reference)
            throw new Error('참고할 얼굴 이미지를 찾을 수 없습니다.');
        const data = await createImage(
            profile,
            req,
            reference && new Uint8Array(reference),
            c.req.raw.signal
        );
        const id = await images.save(data);
        return c.json<ImageResponse>({
            ok: true,
            id,
            via: `${profile.name} · ${req.model} · ${req.quality}`,
        });
    } catch (err) {
        return c.json<ImageResponse>({
            ok: false,
            error:
                err instanceof ProfileNotFoundError
                    ? '이미지 생성에 쓸 프로필을 찾을 수 없습니다.'
                    : errorMessage(err),
        });
    }
});

app.get('/api/images/:id', async (c) => {
    const id = c.req.param('id');
    if (!IMAGE_ID.test(id)) return c.json({ error: 'Not found' }, 404);
    const data = await images.read(id);
    if (!data) return c.json({ error: 'Not found' }, 404);
    return c.body(new Uint8Array(data), 200, {
        'Content-Type': 'image/webp',
        // 같은 ID의 이미지는 바뀌지 않는다
        'Cache-Control': 'private, max-age=31536000, immutable',
        'X-Content-Type-Options': 'nosniff',
    });
});

/* ---------------- 방 진행(관리) 모델: 다음 발언자 결정 ---------------- */

app.post('/api/moderate', async (c) => {
    const req = await parseBody(c.req.raw, moderateRequestSchema);
    const profile = store.resolve(req.profileId);
    const modelId = req.model || profile.defaultModel;
    const reasoning = req.reasoning ?? profile.defaultReasoning;

    try {
        const { text, warnings } = await generateText({
            model: createModel(profile, modelId),
            reasoning,
            instructions: moderatorInstructions(req.userName),
            prompt: moderatorPrompt(req),
            maxRetries: 1,
            abortSignal: AbortSignal.any([
                c.req.raw.signal,
                AbortSignal.timeout(45_000),
            ]),
        });
        const decision = parseDecision(text, req.members.length);
        return c.json<ModerateResponse>({
            ok: true,
            ...decision,
            via: [
                describeModel(profile.provider, modelId, reasoning),
                reasoningNotice(warnings),
            ]
                .filter(Boolean)
                .join(' · ⚠ '),
        });
    } catch (err) {
        return c.json<ModerateResponse>({
            ok: false,
            error: errorMessage(err),
        });
    }
});

/* ---------------- 채팅 (NDJSON 스트리밍) ---------------- */

/** 한 번의 발언에서 링크 카드로 보여줄 최대 출처 수 */
const MAX_SOURCES = 3;

app.post('/api/chat', async (c) => {
    const req = await parseBody(c.req.raw, chatRequestSchema);
    const profile = store.resolve(req.profileId);
    const modelId = req.model || profile.defaultModel;
    const reasoning = req.reasoning ?? profile.defaultReasoning;
    const signal = c.req.raw.signal;
    // 검색 도구를 거절했던 모델은 프로필에 기록돼 있으므로 다시 요청하지 않는다
    const searching = !!req.search && canModelSearch(profile, modelId);
    const callModelId =
        searching && profile.provider === 'openrouter'
            ? onlineModelId(modelId)
            : modelId;
    const tools =
        searching && req.search
            ? webSearchTools(profile.provider, req.search)
            : undefined;

    return ndjsonResponse<ChatStreamEvent>(async (send) => {
        send({
            type: 'meta',
            provider: profile.provider,
            model: modelId,
            reasoning,
            profileName: profile.name,
        });
        if (req.search && !searching)
            send({ type: 'warning', message: '웹 검색 미지원 모델' });

        /**
         * 한 번 생성한다. 검색을 붙인 호출이 글을 내기 전에 검색 도구 때문에 거절되면
         * 오류를 보내지 않고 'retry'를 돌려 검색 없이 다시 부르게 한다.
         */
        const generate = async (
            withSearch: boolean
        ): Promise<'done' | 'retry'> => {
            const seen = new Set<string>();
            let wrote = false;
            const rejected = (err: unknown) =>
                withSearch && !wrote && isSearchToolRejection(err);
            try {
                const result = streamText({
                    model: createModel(
                        profile,
                        withSearch ? callModelId : modelId
                    ),
                    instructions: req.instructions,
                    messages: req.messages,
                    reasoning,
                    tools: withSearch ? tools : undefined,
                    abortSignal: signal,
                    maxRetries: 1,
                });
                for await (const part of result.fullStream) {
                    if (part.type === 'text-delta') {
                        wrote = true;
                        send({ type: 'delta', text: part.text });
                    } else if (part.type === 'tool-call')
                        send({
                            type: 'search',
                            query: searchQuery(part.input),
                        });
                    else if (
                        part.type === 'source' &&
                        part.sourceType === 'url' &&
                        !seen.has(part.url) &&
                        seen.size < MAX_SOURCES
                    ) {
                        seen.add(part.url);
                        send({
                            type: 'source',
                            url: part.url,
                            title: part.title?.trim() || part.url,
                        });
                    } else if (part.type === 'error') {
                        if (rejected(part.error)) return 'retry';
                        send({
                            type: 'error',
                            message: errorMessage(part.error),
                        });
                    }
                }
                const notice = reasoningNotice(await result.warnings);
                if (notice) send({ type: 'warning', message: notice });
                send({ type: 'done' });
            } catch (err) {
                if (signal.aborted) return 'done';
                if (rejected(err)) return 'retry';
                send({ type: 'error', message: errorMessage(err) });
            }
            return 'done';
        };

        if ((await generate(searching)) === 'retry') {
            await store
                .markNoSearch(profile.id, modelId)
                .catch((err) =>
                    console.error(
                        `[agenttalk] 웹 검색 미지원 기록 실패: ${errorMessage(err)}`
                    )
                );
            send({ type: 'searchUnsupported' });
            send({ type: 'warning', message: '웹 검색 미지원 모델' });
            await generate(false);
        }
    });
});

/** 검색 도구 입력에서 검색어를 꺼낸다 (프로바이더마다 형식이 다르고 없을 수도 있음) */
function searchQuery(input: unknown): string {
    const i = input as {
        query?: unknown;
        action?: { query?: unknown; queries?: unknown };
    } | null;
    const q =
        i?.query ??
        i?.action?.query ??
        (Array.isArray(i?.action?.queries) ? i.action.queries[0] : '');
    return typeof q === 'string' ? q.slice(0, 120) : '';
}

app.all('/api/*', (c) => c.json({ error: 'Not found' }, 404));

/* ---------------- 프로덕션: 빌드된 프론트엔드 제공 ---------------- */

if (IS_PROD) {
    app.use('*', serveStatic({ root: './dist' }));
    app.get('*', serveStatic({ path: './dist/index.html' }));
}

serve({ fetch: app.fetch, port: PORT, hostname: HOST }, (info) => {
    console.log(
        `[agenttalk] API server on http://${HOST}:${info.port} (data: ${DATA_DIR})`
    );
});
