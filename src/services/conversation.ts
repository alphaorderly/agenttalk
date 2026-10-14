import toast from 'react-hot-toast';
import {
    canModelSearch,
    describeModel,
    type ModerateResponse,
    type ProfilesResponse,
    type SourceLink,
} from '@shared/providers';
import type { Agent, PendingMessage, Room } from '@/types/chat';
import {
    appendMessage,
    idleNoteAtom,
    modalAtom,
    moderatorSettingsAtom,
    pendingAtom,
    recordVote,
    roomsAtom,
    runningAtom,
    store,
    updateRoom,
    userLocationAtom,
    userNameAtom,
    type RunState,
} from '@stores/chat';
import { applyMind, extractMind } from '@utils/mind/mind';
import {
    addressedAgents,
    buildPrompt,
    extractExpression,
    extractVote,
    isPass,
    moderatorNoteFor,
    moderatorTranscript,
    moderatorRequestContext,
    parseImageLine,
    parseWhisper,
    splitReply,
    typingDelay,
    type TurnContext,
} from '@utils/prompt/prompt';
import { DEFAULT_EXPRESSION } from '@shared/images';
import { modeOf, shareIntroductionsOf } from '@/modes';
import type { ModeIO, ModeTurn } from '@/modes/core';
import { engineOf } from '@/modes/engines';
import { uid } from '@utils/id/id';
import { nowLabel, timeZone } from '@utils/time/time';
import { moderate, queryClient, streamChat } from './api';
import {
    canAgentDraw,
    changeExpression,
    createAgentImage,
    currentFace,
    expressionsOn,
    setMessageFace,
} from './images';

/**
 * 에이전트 대화 루프. 고정된 순서/횟수 대신 방 진행(관리) 모델이 매번
 * "다음에 누가, 얼마 뒤에 말할지, 아니면 멈출지"를 정한다.
 * React 컴포넌트 생명주기와 무관하게 동작하므로 다른 방으로 이동해도 계속된다.
 */

/** 안전장치: 마지막 인간 입력/수동 재개 이후 실제 발언 생성 호출의 최대 횟수 */
const SAFETY_LIMIT = 30;
/** 비용을 막기 위해 한 번의 실행에서 쓸 수 있는 최대 웹 검색 횟수 */
const MAX_SEARCHES_PER_RUN = 3;
/** 고른 사람이 연달아 이만큼 패스하면 대화가 잦아든 것으로 보고 멈춘다 */
const MAX_PASS_STREAK = 2;
/** 비용을 막기 위해 한 번의 실행에서 에이전트들이 보낼 수 있는 최대 이미지 수 */
const MAX_IMAGES_PER_RUN = 2;

type Turn = Pick<TurnContext, 'note' | 'canPass' | 'canSearch' | 'canDraw'> &
    Pick<ModeTurn, 'forceTo' | 'silent' | 'choice' | 'onMessage'> & {
        /** 투표 차례면 투표 메시지 ID. 질문과 선택지는 그 메시지에서 읽는다 */
        pollId?: string;
    };

/** 발언 한 번의 결과 */
type SpeakResult = 'spoke' | 'passed' | 'failed';

interface SpeakHooks {
    onDraw?: () => void;
    onSearch?: () => void;
}

const controllers = new Map<string, AbortController>();
/** 지금 진행 중인 한 차례(판단 → 텀 → 발언). 사용자가 끼어들면 이것만 끊고 다시 판단한다 */
const turnControllers = new Map<string, AbortController>();
/** 실행이 완전히 끝날 때 resolve (멈춘 뒤 새로 시작하려면 기다려야 한다) */
const runs = new Map<string, Promise<void>>();
/** 말풍선이나 화자 교대가 아니라 실제 생성 호출을 센다. 멈췄다 자동 재시작해도 유지한다. */
const generationBudgets = new Map<
    string,
    { userMessageId: string | null; calls: number }
>();

function latestUserMessageId(room: Room): string | null {
    for (let i = room.messages.length - 1; i >= 0; i--) {
        if (room.messages[i].sender === 'me') return room.messages[i].id;
    }
    return null;
}

function generationBudget(room: Room, reset = false) {
    const userMessageId = latestUserMessageId(room);
    let budget = generationBudgets.get(room.id);
    if (!budget || reset || budget.userMessageId !== userMessageId) {
        budget = { userMessageId, calls: 0 };
        generationBudgets.set(room.id, budget);
    }
    return budget;
}

const getRoom = (roomId: string) =>
    store.get(roomsAtom).find((r) => r.id === roomId);

function setRun(roomId: string, patch: Partial<RunState> | null) {
    store.set(runningAtom, (prev) => {
        const next = { ...prev };
        if (patch === null) delete next[roomId];
        else {
            const base: RunState = prev[roomId] ?? { turns: 0, status: '' };
            next[roomId] = { ...base, ...patch };
        }
        return next;
    });
}

function setIdleNote(roomId: string, note: string | null) {
    store.set(idleNoteAtom, (prev) => {
        const next = { ...prev };
        if (note === null) delete next[roomId];
        else next[roomId] = note;
        return next;
    });
}

type PendingMap = Record<string, PendingMessage>;

function setPending(fn: (prev: PendingMap) => PendingMap) {
    store.set(pendingAtom, fn);
}

function clearPending(roomId: string) {
    setPending((prev) => {
        const next = { ...prev };
        delete next[roomId];
        return next;
    });
}

function sleep(ms: number, signal: AbortSignal) {
    return new Promise<void>((resolve) => {
        if (signal.aborted) return resolve();
        const finish = () => {
            clearTimeout(timer);
            signal.removeEventListener('abort', finish);
            resolve();
        };
        const timer = setTimeout(finish, ms);
        signal.addEventListener('abort', finish, { once: true });
    });
}

const profilesData = () =>
    queryClient.getQueryData<ProfilesResponse>(['profiles']);

function hasAnyProfile() {
    const data = profilesData();
    return !!data && data.profiles.length > 0;
}

/**
 * 에이전트 → 방 → 기본 프로필 순으로 정해지는 모델에 검색 도구를 줄 수 있는지.
 * 검색 여부는 에이전트가 정하므로, 도구 없이 매번 검색하는 OpenRouter `:online`은 제외한다.
 * 검색 도구를 거절했다고 프로필에 기록된 모델도 제외한다.
 */
function canSearch(room: Room, agent: Agent) {
    const data = profilesData();
    const id = agent.profileId ?? room.profileId ?? data?.defaultProfileId;
    const profile = data?.profiles.find((p) => p.id === id);
    if (!profile || profile.provider === 'openrouter') return false;
    // speak()가 보내는 모델과 같은 순서로 정한다 (비어 있으면 서버가 프로필 기본 모델을 쓴다)
    const model =
        agent.model ||
        (agent.profileId ? '' : (room.model ?? '')) ||
        profile.defaultModel;
    return canModelSearch(profile, model);
}

export function stopConversation(roomId: string) {
    controllers.get(roomId)?.abort();
}

export function isConversationRunning(roomId: string) {
    return controllers.has(roomId);
}

/**
 * 사용자가 메시지를 보낸 직후. 사용자 말이 항상 가장 우선이다.
 * - 자동 반응: 진행 중이면 하던 판단·입력·발언을 끊고 바로 사용자 말을 보고 다시 정한다.
 * - 기다리기: 에이전트끼리 하던 대화도 멈추고, @/@@로 부른 사람만 답한다.
 */
export async function onUserMessage(roomId: string) {
    const room = getRoom(roomId);
    if (!room) return;
    generationBudget(room);
    // 모드가 반응 여부를 정할 수 있다 (예: 마피아 게임의 밤에는 마피아끼리만 답한다)
    const reaction = engineOf(room).onUserMessage?.(roomId);
    if (reaction === 'ignore') return;
    if (reaction === 'react' || room.autoReply !== false) {
        if (controllers.has(roomId)) turnControllers.get(roomId)?.abort();
        else startConversation(roomId);
        return;
    }
    if (controllers.has(roomId)) {
        stopConversation(roomId);
        await runs.get(roomId);
    }
    const addressed = addressedAgents(getRoom(roomId) ?? room);
    if (addressed) startConversation(roomId, { only: addressed });
    else setIdleNote(roomId, '부를 때까지 기다려요 · ▶ 또는 @이름');
}

/**
 * 방 진행 모델에게 다음 발언자를 묻는다. 네트워크 오류도 ok:false로 돌려준다.
 * @param agents 고를 수 있는 멤버 (모드가 정한다. 예: 게임 중이면 생존자). 후보 번호는 이 목록 기준이다
 */
async function decideNext(
    room: Room,
    agents: Agent[],
    nudge: boolean,
    signal: AbortSignal
): Promise<ModerateResponse> {
    const settings = store.get(moderatorSettingsAtom);
    const userName = store.get(userNameAtom);
    try {
        return await moderate(
            {
                profileId: settings.profileId,
                model: settings.model,
                reasoning: settings.reasoning ?? null,
                roomName: room.name,
                topic: modeOf(room).moderatorTopic(room).slice(0, 2000),
                userName,
                members: agents.map((a) => ({
                    id: a.id,
                    name: a.name,
                    // 비공개 소개가 진행 모델의 상황 메모를 통해 다른 멤버에게 새지 않게 한다
                    persona: shareIntroductionsOf(room) ? a.persona : '',
                    talk: a.talk ?? 'normal',
                })),
                transcript: moderatorTranscript(room, userName),
                ...moderatorRequestContext(room, userName),
                agentStreak: generationBudget(room).calls,
                nudge,
                now: nowLabel(),
                location: store.get(userLocationAtom).trim(),
            },
            signal
        );
    } catch (err) {
        return {
            ok: false,
            error: err instanceof Error ? err.message : String(err),
        };
    }
}

/**
 * 에이전트 한 명의 발언을 생성한다. 생성하는 동안은 "입력 중…"만 보여주고,
 * 다 되면 줄 단위로 나눠 짧은 간격을 두고 말풍선 여러 개로 보낸다.
 * 오류면 시스템 메시지를 남기고 false.
 */
async function speak(
    room: Room,
    agent: Agent,
    turn: Turn,
    signal: AbortSignal,
    { onDraw, onSearch }: SpeakHooks = {}
): Promise<SpeakResult> {
    const roomId = room.id;
    const userName = store.get(userNameAtom);
    const location = store.get(userLocationAtom).trim();
    /** 표정 기능이 켜져 있으면 지금 이 에이전트의 얼굴 */
    const faceNow = () => {
        const fresh = getRoom(roomId);
        const self = fresh?.agents.find((a) => a.id === agent.id);
        return fresh && self && expressionsOn(fresh)
            ? currentFace(self)
            : undefined;
    };
    const pending: PendingMessage = {
        id: uid(),
        agentId: agent.id,
        text: '',
        face: faceNow(),
        // 모드가 숨겨 진행하는 차례는 보면 안 되는 사람에게 "입력 중"으로 드러나지 않게 표시한다
        ...(turn.forceTo && { to: turn.forceTo }),
        ...(turn.silent && { silent: true }),
    };
    const publish = () =>
        setPending((prev) => ({ ...prev, [roomId]: { ...pending } }));
    publish();

    const poll = turn.pollId
        ? room.messages.find((m) => m.id === turn.pollId)?.poll
        : undefined;
    const startedAt = Date.now();
    const sources: SourceLink[] = [];
    let searched = false;
    let text: string;
    try {
        text = await streamChat(
            {
                profileId: agent.profileId ?? room.profileId,
                // 모델 ID는 프로바이더마다 다르므로, 에이전트가 자기 프로필을 쓰면 방 모델을 물려받지 않는다
                model:
                    agent.model || (agent.profileId ? '' : (room.model ?? '')),
                // 에이전트 → 방 → (서버에서) 프로필 기본 effort
                reasoning: agent.reasoning ?? room.reasoning ?? null,
                search: turn.canSearch
                    ? { city: location, timezone: timeZone() }
                    : null,
                ...buildPrompt(room, agent, {
                    ...turn,
                    poll,
                    choice: turn.choice && {
                        question: turn.choice.question,
                        options: turn.choice.options,
                        after: turn.choice.after,
                    },
                    userName,
                    now: nowLabel(),
                    location,
                    expression:
                        expressionsOn(room) && agent.portrait
                            ? (agent.expression ?? DEFAULT_EXPRESSION)
                            : undefined,
                }),
            },
            {
                signal,
                onEvent: (e) => {
                    if (e.type === 'meta')
                        pending.via = describeModel(
                            e.provider,
                            e.model,
                            e.reasoning
                        );
                    else if (e.type === 'warning')
                        pending.via = `${pending.via} · ⚠ ${e.message}`;
                    else if (e.type === 'search') {
                        if (!searched) onSearch?.();
                        searched = true;
                        pending.status = e.query
                            ? `🔍 ${e.query} 찾는 중…`
                            : '🔍 찾는 중…';
                    } else if (e.type === 'source')
                        sources.push({ url: e.url, title: e.title });
                    else if (e.type === 'searchUnsupported') {
                        // 서버가 프로필에 기록했으니 다음 차례부터는 검색을 요청하지 않는다
                        void queryClient.invalidateQueries({
                            queryKey: ['profiles'],
                        });
                        return;
                    } else return;
                    publish();
                },
            }
        );
    } catch (err) {
        clearPending(roomId);
        if (signal.aborted) return 'failed';
        appendMessage(roomId, {
            sender: 'system',
            text: `⚠️ ${agent.name}: ${err instanceof Error ? err.message : String(err)}`,
            error: true,
            // 숨겨 진행하는 차례의 오류는 누가 행동했는지 드러나므로 다 보는 사람에게만 보인다
            ...((turn.silent || turn.forceTo) && { to: ['gm'] }),
        });
        return 'failed';
    }

    // [표정:…] 표시는 글자로 보내지 않고 얼굴만 바꾼다. 이미 만든 표정이면 이번 말풍선부터 새 얼굴이다
    const extracted = extractExpression(text);
    // [감정:…]·[기억:…]도 글자로 보내지 않고 이 에이전트의 마음에만 남긴다 (숨겨 진행하는 차례도)
    const mind = extractMind(extracted.text);
    extracted.text = mind.text;
    /** 이번 발언에서 바뀐 감정. 첫 말풍선에 붙여 감정 변화 기록으로 남긴다 */
    let feeling = recordMind(roomId, agent.id, mind);
    // [투표:번호] 표시도 글자로 보내지 않고 표만 기록한다
    let voted = false;
    if (poll && turn.pollId) {
        const vote = extractVote(extracted.text, poll.options.length);
        extracted.text = vote.text;
        if (vote.choice !== null) {
            recordVote(roomId, turn.pollId, {
                voter: agent.id,
                name: agent.name,
                choice: vote.choice,
            });
            voted = true;
        } else {
            appendMessage(roomId, {
                sender: 'system',
                text: `⚠️ ${agent.name}님이 투표 번호를 고르지 않았어요`,
                error: true,
            });
        }
    }
    // 모드 차례의 [선택:번호]도 글자로 보내지 않고 고른 것만 알린다
    let chose = false;
    if (turn.choice) {
        const pick = extractVote(extracted.text, turn.choice.options.length);
        extracted.text = pick.text;
        turn.choice.onPick(pick.choice, pick.text.trim());
        chose = true;
    }
    if (turn.silent) {
        clearPending(roomId);
        return 'spoke';
    }
    // 할 말이 없다고 넘기면 아무것도 보내지 않는다 (표정도 그대로)
    if (turn.canPass && isPass(extracted.text)) {
        clearPending(roomId);
        return 'passed';
    }
    const faceJob = extracted.expression
        ? changeExpression(roomId, agent.id, extracted.expression)
        : null;

    // 줄 맨 앞의 "@@이름"은 귓속말. 표시가 없는 다음 줄들도 같은 사람에게 이어서 보낸다.
    // 귓속말이 없는 모드도 있고, 모드가 받는 사람을 정한 차례는 그 사람에게만 보낸다
    const whispers = modeOf(room).whispers;
    let to: string[] | undefined = turn.forceTo?.length
        ? turn.forceTo
        : undefined;
    // 받는 사람이 정해진 차례인데 받을 사람이 없으면 아무것도 보내지 않는다 (공개되면 안 된다)
    if (turn.forceTo && !to) {
        clearPending(roomId);
        return 'spoke';
    }
    let drew = false;
    type Line = { text: string; image: string | null; to?: string[] };
    const lines = splitReply(extracted.text, room, agent, userName).flatMap(
        (line): Line[] => {
            const parsed = whispers
                ? parseWhisper(line, room, userName, agent.id)
                : { text: line, to: undefined };
            if (parsed.to) to = parsed.to;
            // 할 말과 함께 붙은 패스 표시는 버린다
            if (isPass(parsed.text)) return [];
            const image = parseImageLine(parsed.text);
            if (image) {
                // 허용되지 않았거나 이미 한 장 보냈으면 이미지 줄은 버린다
                if (!turn.canDraw || drew) return [];
                drew = true;
                return [{ text: '', image, to }];
            }
            return parsed.text ? [{ text: parsed.text, image: null, to }] : [];
        }
    );
    const sent: string[] = [];
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const last = i === lines.length - 1;
        if (line.image) {
            pending.status = '🎨 사진 만드는 중…';
            pending.face = faceNow();
            publish();
            onDraw?.();
            try {
                const id = await createAgentImage(
                    line.image,
                    agent.imageGen?.quality ?? 'low',
                    signal
                );
                if (signal.aborted) break;
                clearPending(roomId);
                const message = appendMessage(roomId, {
                    id: pending.id,
                    sender: agent.id,
                    senderName: agent.name,
                    text: '',
                    image: { id, prompt: line.image },
                    to: line.to,
                    via: pending.via,
                    face: faceNow(),
                    feeling,
                    sources: last && sources.length ? sources : undefined,
                });
                turn.onMessage?.(message);
                sent.push(pending.id);
                feeling = undefined;
            } catch (err) {
                if (signal.aborted) break;
                clearPending(roomId);
                appendMessage(roomId, {
                    sender: 'system',
                    text: `⚠️ ${agent.name} 사진 전송 실패: ${err instanceof Error ? err.message : String(err)}`,
                    error: true,
                });
            }
        } else {
            // 첫 말풍선은 생성 시간이, 다음 말풍선부터는 글자 수만큼의 입력 시간이 "타이핑"이다
            const typed = i === 0 ? Date.now() - startedAt : 0;
            await sleep(Math.max(0, typingDelay(line.text) - typed), signal);
            if (signal.aborted) break;
            clearPending(roomId);
            const message = appendMessage(roomId, {
                id: pending.id,
                sender: agent.id,
                senderName: agent.name,
                text: line.text,
                to: line.to,
                via: pending.via,
                face: faceNow(),
                feeling,
                // 링크 카드는 마지막 말풍선 아래에 붙인다
                sources: last && sources.length ? sources : undefined,
            });
            turn.onMessage?.(message);
            sent.push(pending.id);
            feeling = undefined;
        }
        if (!last) {
            pending.id = uid();
            pending.status = undefined;
            pending.face = faceNow();
            publish();
        }
    }
    clearPending(roomId);
    // 새 표정 이미지가 늦게 완성되면 이번에 보낸 말풍선도 그 얼굴로 바꾼다
    if (faceJob)
        void faceJob.then((face) => face && setMessageFace(roomId, sent, face));
    if (signal.aborted) return 'failed';
    return sent.length || voted || chose ? 'spoke' : 'passed';
}

/** 발언에서 뗀 감정·기억을 그 에이전트에게만 저장한다. 감정이 바뀌었으면 새 감정 */
function recordMind(
    roomId: string,
    agentId: string,
    mind: ReturnType<typeof extractMind>
): string | undefined {
    const before = getRoom(roomId)?.agents.find((a) => a.id === agentId);
    if (!before) return undefined;
    const after = applyMind(before, mind);
    if (after === before) return undefined;
    updateRoom(roomId, (r) => ({
        ...r,
        agents: r.agents.map((a) =>
            a.id === agentId ? applyMind(a, mind) : a
        ),
    }));
    return after.feeling !== before.feeling ? after.feeling : undefined;
}

/** 이 투표에 아직 표를 내지 않은 에이전트 id들 (방의 멤버 순서) */
export function pendingVoters(room: Room, pollId: string) {
    const poll = room.messages.find((m) => m.id === pollId)?.poll;
    if (!poll) return [];
    return room.agents
        .filter((a) => !poll.votes.some((v) => v.voter === a.id))
        .map((a) => a.id);
}

/**
 * 투표를 받는다. 진행 중인 대화는 멈추고, 아직 투표하지 않은 에이전트가 차례로 한 표씩 낸다.
 * 투표가 끝나면 멈추고 ▶로 이어서 얘기할 수 있다.
 */
export async function startPoll(roomId: string, pollId: string) {
    if (controllers.has(roomId)) {
        stopConversation(roomId);
        await runs.get(roomId);
    }
    const room = getRoom(roomId);
    if (!room) return;
    const voters = pendingVoters(room, pollId);
    if (voters.length) startConversation(roomId, { only: voters, pollId });
}

/**
 * 대화를 시작/재개한다.
 * @param manual 사용자가 ▶를 눌렀으면 true — 진행 모델이 바로 멈추지 않고 누군가 말하게 한다.
 *               사용자가 메시지를 보내 자동으로 시작된 경우는 false.
 */
export function startConversation(
    roomId: string,
    options: { manual?: boolean; only?: string[]; pollId?: string } = {}
) {
    if (controllers.has(roomId)) return;
    const run = runConversation(roomId, options);
    runs.set(roomId, run);
    void run.finally(() => {
        if (runs.get(roomId) === run) runs.delete(roomId);
    });
}

/**
 * @param only 있으면 진행 모델 없이 이 에이전트들만 차례로 답하고 멈춘다 (기다리기 모드에서 부른 경우).
 * @param pollId 있으면 only의 에이전트들이 이 투표에 한 표씩 낸다.
 */
async function runConversation(
    roomId: string,
    {
        manual = false,
        only,
        pollId,
    }: { manual?: boolean; only?: string[]; pollId?: string }
) {
    if (!hasAnyProfile()) {
        toast.error('먼저 프로바이더 프로필을 추가하세요.');
        store.set(modalAtom, { type: 'settings', section: 'profiles' });
        return;
    }

    const initialRoom = getRoom(roomId);
    if (!initialRoom) return;
    const engine = engineOf(initialRoom);
    // ▶로 직접 이어가면 모드가 기다리던 것을 푼다 (예: 사회자 대기)
    if (manual) engine.onResume?.(roomId);
    const budget = generationBudget(initialRoom, manual);
    const ctrl = new AbortController();
    const { signal } = ctrl;
    controllers.set(roomId, ctrl);
    setIdleNote(roomId, null);
    setRun(roomId, { turns: budget.calls, status: '대화 흐름을 보는 중…' });
    let nudge = manual;
    let searches = 0;
    let images = 0;
    /** 고른 사람들이 연달아 패스한 횟수. 누가 말하거나 사람이 새로 말하면 0 */
    let passStreak = 0;
    let passUserMessageId = latestUserMessageId(initialRoom);
    const hooks: SpeakHooks = {
        onDraw: () => images++,
        onSearch: () => searches++,
    };
    const drawable = (agent: Agent) =>
        images < MAX_IMAGES_PER_RUN && canAgentDraw(agent);
    const searchable = (room: Room, agent: Agent) =>
        searches < MAX_SEARCHES_PER_RUN && canSearch(room, agent);
    const queue = only ? [...only] : null;
    /** 모드가 직접 진행하는 차례(예: 마피아 밤 행동·투표)에 쓰는 대화 엔진 기능 */
    const modeIO: ModeIO = {
        // 모드 차례의 발언은 모드가 횟수를 정하므로 자동 진행 한도에 세지 않는다
        speak: async (room, agent, turn, sig) => {
            const result = await speak(room, agent, turn, sig);
            if (result === 'failed' && !sig.aborted)
                setIdleNote(roomId, '⚠️ 오류로 멈췄어요 · ▶로 다시 시도');
            return result;
        },
        status: (text) => setRun(roomId, { status: text }),
        idle: (text) => setIdleNote(roomId, text),
        sleep,
        resetBudget: () => {
            const room = getRoom(roomId);
            if (room) generationBudget(room, true);
            setRun(roomId, { turns: 0 });
        },
    };

    try {
        while (!signal.aborted) {
            const room = getRoom(roomId);
            if (!room || room.agents.length === 0) break;

            // 차례마다 새 컨트롤러: 사용자가 끼어들면 이 차례만 끊고 처음부터 다시 판단한다
            const turnCtrl = new AbortController();
            const onStop = () => turnCtrl.abort();
            signal.addEventListener('abort', onStop, { once: true });
            turnControllers.set(roomId, turnCtrl);
            const turnSignal = turnCtrl.signal;
            const step = await runTurn(room, turnSignal).finally(() =>
                signal.removeEventListener('abort', onStop)
            );
            if (signal.aborted) break;
            if (turnSignal.aborted) continue;
            if (step === 'stop') break;
        }
    } finally {
        controllers.delete(roomId);
        turnControllers.delete(roomId);
        clearPending(roomId);
        setRun(roomId, null);
    }

    /** 한 차례를 진행한다. 'stop'이면 실행을 끝낸다 */
    async function runTurn(
        room: Room,
        signal: AbortSignal
    ): Promise<'next' | 'stop'> {
        // 모드가 이 차례를 직접 진행할 수 있다 (예: 마피아 게임의 밤·투표)
        const engine = engineOf(room);
        const modeStep = engine.step?.(room, signal, modeIO);
        if (modeStep) return modeStep;
        const budget = generationBudget(room);
        if (budget.calls >= SAFETY_LIMIT) {
            setIdleNote(
                roomId,
                `자동 진행 한도(${SAFETY_LIMIT}회)에 도달해 멈췄어요. ▶로 이어갈 수 있어요.`
            );
            return 'stop';
        }
        if (queue) {
            const id = queue.shift();
            const agent = room.agents.find((a) => a.id === id);
            if (!agent) {
                setIdleNote(
                    roomId,
                    pollId
                        ? '투표가 끝났어요 · ▶로 이어서 얘기할 수 있어요'
                        : '부를 때까지 기다려요 · ▶ 또는 @이름'
                );
                return 'stop';
            }
            // 투표 중 사용자가 끼어들어 차례가 끊기면, 아직 투표하지 않은 사람을 다시 앞에 세운다
            const requeue = () => {
                const fresh = getRoom(roomId);
                if (
                    pollId &&
                    fresh &&
                    pendingVoters(fresh, pollId).includes(agent.id)
                )
                    queue.unshift(agent.id);
            };
            setRun(roomId, {
                status: pollId
                    ? `${agent.name} 투표 중`
                    : `${agent.name} 차례 · 부른 사람`,
            });
            await sleep(600, signal);
            if (signal.aborted) {
                requeue();
                return 'next';
            }
            const fresh = getRoom(roomId) ?? room;
            const self = fresh.agents.find((a) => a.id === agent.id) ?? agent;
            setRun(roomId, { turns: ++generationBudget(fresh).calls });
            // 직접 부른 사람(또는 투표 차례)이라 패스 없이 답한다
            const result = await speak(
                fresh,
                self,
                {
                    note: '',
                    canPass: false,
                    canSearch: !pollId && searchable(fresh, self),
                    canDraw: !pollId && drawable(self),
                    pollId,
                },
                signal,
                hooks
            );
            if (signal.aborted) {
                requeue();
                return 'next';
            }
            return result === 'failed' ? 'stop' : 'next';
        }

        // 사람이 새로 말했으면 이전의 패스는 셈하지 않는다
        const userMessageId = latestUserMessageId(room);
        if (userMessageId !== passUserMessageId) {
            passUserMessageId = userMessageId;
            passStreak = 0;
        }

        setRun(roomId, { status: '누가 말할지 보는 중…' });
        const startedAt = Date.now();
        /** 지금 말할 수 있는 멤버 (모드가 정한다. 예: 게임 중이면 생존자만) */
        const members = modeOf(room).speakingAgents(room);
        const decision = await decideNext(room, members, nudge, signal);
        nudge = false;
        if (signal.aborted) return 'next';
        if (!decision.ok) {
            const note = `진행 모델 오류로 멈췄어요: ${decision.error}`;
            toast.error(note);
            setIdleNote(roomId, note);
            return 'stop';
        }

        let reason = decision.reason;
        // 진행 모델의 메모가 에이전트에게 가는 유일한 길목. 진행 모델이 판단할 때 본 방(room)을
        // 기준으로, 고른 사람이 못 보는 귓속말이 섞여 있었으면 메모를 버린다
        const candidates = decision.candidates.flatMap((c) => {
            const agent = members[c.speaker - 1];
            return agent
                ? [
                      {
                          agent,
                          note: moderatorNoteFor(room, agent.id, c.note),
                          canPass: true,
                      },
                  ]
                : [];
        });
        // 사용자가 귓속말하거나 @로 부른 사람이 먼저, 패스 없이 답한다 (진행 모델이 다른 사람을 골라도)
        const addressed = addressedAgents(room);
        const called = addressed
            ? members.find((a) => addressed.includes(a.id))
            : undefined;
        if (called) {
            const picked = candidates.find((c) => c.agent.id === called.id);
            const rest = candidates.filter((c) => c.agent.id !== called.id);
            candidates.splice(0, candidates.length, {
                agent: called,
                note: picked?.note ?? '',
                canPass: false,
            });
            if (rest[0]) candidates.push(rest[0]);
            if (!picked) reason = '부른 사람이 답할 차례';
        }

        if (!candidates.length) {
            // 판단하는 사이에 사용자가 말했으면 그 말을 보고 다시 판단한다
            if (
                latestUserMessageId(getRoom(roomId) ?? room) !==
                latestUserMessageId(room)
            )
                return 'next';
            const quiet = engine.onQuiet?.(roomId, modeIO);
            if (quiet) return quiet;
            setIdleNote(roomId, reason || '대화가 잦아들었어요');
            return 'stop';
        }

        setRun(roomId, {
            status: `${candidates[0].agent.name} 차례${reason ? ` · ${reason}` : ''}`,
        });
        // 진행 모델이 판단하는 데 걸린 시간도 "텀"에 포함한다
        await sleep(
            Math.max(0, decision.waitMs - (Date.now() - startedAt)),
            signal
        );
        if (signal.aborted) return 'next';

        for (const [i, candidate] of candidates.entries()) {
            // 기다리는 동안 사용자가 말했거나 방 설정이 바뀌었을 수 있으니 최신 상태로 말한다
            const fresh = getRoom(roomId);
            const speaker = fresh?.agents.find(
                (a) => a.id === candidate.agent.id
            );
            if (!fresh || !speaker) continue;
            if (generationBudget(fresh).calls >= SAFETY_LIMIT) return 'next';
            if (i > 0)
                setRun(roomId, {
                    status: `${speaker.name} 차례 · 앞사람이 넘김`,
                });
            setRun(roomId, { turns: ++generationBudget(fresh).calls });
            const result = await speak(
                fresh,
                speaker,
                {
                    note: candidate.note,
                    canPass: candidate.canPass,
                    canSearch: searchable(fresh, speaker),
                    canDraw: drawable(speaker),
                },
                signal,
                hooks
            );
            if (signal.aborted) return 'next';
            if (result === 'failed') return 'stop';
            if (result === 'spoke') {
                // 패스는 세지 않고 실제로 말한 차례만 모드에 알린다 (예: 낮 토론 횟수)
                engine.onTalk?.(roomId);
                passStreak = 0;
                return 'next';
            }
            if (++passStreak >= MAX_PASS_STREAK) {
                const quiet = engine.onQuiet?.(roomId, modeIO);
                if (quiet) {
                    passStreak = 0;
                    return quiet;
                }
                setIdleNote(roomId, '다들 지금은 더 할 말이 없대요');
                return 'stop';
            }
            await sleep(400, signal);
            if (signal.aborted) return 'next';
        }
        return 'next';
    }
}

/**
 * 진행 중인 실행을 멈추고 끝날 때까지 기다린 뒤 change를 적용하고 다시 시작한다.
 * 모드의 단계 전환 버튼(예: 새 게임, 투표 시작)이 쓴다.
 * @param resetBudget 자동 진행 안전 한도를 다시 센다
 */
export async function restartConversation(
    roomId: string,
    change: () => void,
    { resetBudget = false }: { resetBudget?: boolean } = {}
) {
    if (controllers.has(roomId)) {
        stopConversation(roomId);
        await runs.get(roomId);
    }
    change();
    const room = getRoom(roomId);
    if (resetBudget && room) generationBudget(room, true);
    startConversation(roomId);
}
