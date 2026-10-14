import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatRequest } from '@shared/providers';
import type { Agent, Room } from '@/types/chat';
import {
    idleNoteAtom,
    appendMessage,
    pendingAtom,
    roomsAtom,
    runningAtom,
    store,
    userNameAtom,
} from '@stores/chat';
import {
    onUserMessage,
    startConversation,
    stopConversation,
} from '@services/conversation';
import {
    startMafiaGame,
    startMafiaVote,
    stopMafiaGame,
    submitMafiaAction,
} from './actions';
import { speakingAgents, userAction, userCanSee, userComposer } from './rules';
import type { MafiaGame, MafiaRole } from './types';

const mocks = vi.hoisted(() => ({
    moderate: vi.fn(),
    streamChat: vi.fn(),
    planMafiaEnding: vi.fn(),
}));

vi.mock('react-hot-toast', () => ({ default: { error: vi.fn() } }));
vi.mock('@services/api', () => ({
    moderate: mocks.moderate,
    streamChat: mocks.streamChat,
    runModeAction: (
        mode: string,
        action: string,
        req: unknown,
        signal?: AbortSignal
    ) =>
        mode === 'mafia' && action === 'ending'
            ? mocks.planMafiaEnding(req, signal)
            : Promise.reject(new Error(`unexpected ${mode}/${action}`)),
    queryClient: {
        getQueryData: () => ({
            defaultProfileId: 'p',
            profiles: [{ id: 'p', provider: 'openai' }],
        }),
    },
}));

const agent = (id: string, name: string): Agent => ({
    id,
    name,
    emoji: '🙂',
    color: '#fff',
    persona: '',
    profileId: null,
    model: '',
});
const AGENTS = [
    agent('a', '철수'),
    agent('b', '영희'),
    agent('c', '지수'),
    agent('d', '민수'),
];

function makeRoom(
    roles: Record<string, MafiaRole>,
    patch: Partial<MafiaGame> = {}
): Room {
    return {
        id: 'r',
        name: '마을',
        topic: '산골 마을',
        profileId: null,
        mode: 'mafia',
        agents: AGENTS,
        messages: [],
        updatedAt: 0,
        modeState: {
            mafia: {
                userRole: 'observer',
                reveal: false,
                dayTalk: 12,
                phase: 'night',
                day: 1,
                players: Object.entries(roles).map(([id, role]) => ({
                    id,
                    name:
                        id === 'me'
                            ? '나'
                            : AGENTS.find((a) => a.id === id)!.name,
                    role,
                    alive: true,
                })),
                night: { step: 'chat', chatted: [], picks: {} },
                votes: {},
                talk: 0,
                hold: false,
                checks: [],
                ...patch,
            },
        },
    };
}

/** 이름별로 고를 대상: (질문 내용) → 대상 이름 */
type Plan = Record<string, (content: string) => string>;

/** 선택 차례면 계획대로 [선택:번호]를, 아니면 이름이 들어간 한마디를 돌려준다 */
const responder = (plan: Plan) => (req: ChatRequest) => {
    const name = req.instructions.match(/에 있는 "(.+?)"이다/)?.[1] ?? '';
    // 이전 밤 안내나 투표 로그가 현재 선택의 질문으로 오인되지 않게 한다.
    const content = (req.messages[0].content as string)
        .split('[여기까지]')
        .at(-1)!;
    if (content.includes('[선택:번호]')) {
        const options = [...content.matchAll(/^(\d+)\. (.+)$/gm)];
        const want = plan[name]?.(content);
        const hit = options.find((o) => o[2] === want);
        return Promise.resolve(hit ? `[선택:${hit[1]}]\n${name} 골랐음` : '');
    }
    return Promise.resolve(`${name} 한마디`);
};

const room = () => store.get(roomsAtom)[0];
const game = () => room().modeState!.mafia!;
const texts = () => room().messages.map((m) => m.text);
const userComposerOf = () => userComposer(room());
const STOP = { ok: true, candidates: [], waitMs: 0, reason: '' };

beforeEach(() => {
    vi.useFakeTimers();
    mocks.moderate.mockReset();
    mocks.streamChat.mockReset();
    mocks.moderate.mockResolvedValue(STOP);
    mocks.planMafiaEnding.mockReset();
    mocks.planMafiaEnding.mockResolvedValue({ ok: true, beats: [], via: '' });
    store.set(userNameAtom, '나');
    store.set(idleNoteAtom, {});
    store.set(pendingAtom, {});
    store.set(runningAtom, {});
});

afterEach(async () => {
    for (const r of store.get(roomsAtom)) stopConversation(r.id);
    await vi.runAllTimersAsync();
    vi.useRealTimers();
});

describe('mafia game · observer', () => {
    it('plays a whole game: night actions, morning, vote, last words, win', async () => {
        store.set(roomsAtom, [
            makeRoom({ a: 'mafia', b: 'doctor', c: 'police', d: 'citizen' }),
        ]);
        mocks.streamChat.mockImplementation(
            responder({
                철수: (c) => (c.includes('처형') ? '영희' : '민수'),
                영희: (c) => (c.includes('지킬') ? '영희' : '철수'),
                지수: () => '철수',
                민수: () => '철수',
            })
        );
        startConversation('r');
        await vi.runAllTimersAsync();

        const g = game();
        expect(g.phase).toBe('ended');
        expect(g.winner).toBe('citizen');
        expect(g.players.find((p) => p.id === 'd')?.death).toEqual({
            day: 1,
            cause: 'killed',
        });
        expect(g.players.find((p) => p.id === 'a')?.death?.cause).toBe(
            'executed'
        );
        expect(g.checks).toEqual([
            { day: 1, target: 'a', mafia: true, by: 'c' },
        ]);

        // 경찰 조사 결과는 경찰에게만, 의사의 밤 행동은 아무 말풍선도 남기지 않는다
        const result = room().messages.find((m) =>
            m.text.includes('조사 결과')
        );
        expect(result?.to).toEqual(['c']);
        const night = room().messages.slice(
            0,
            room().messages.findIndex((m) => m.text.includes('아침'))
        );
        expect(night.some((m) => m.sender === 'b')).toBe(false);
        expect(texts()).toContain('🗳️ 영희 → 철수');
        expect(texts().some((t) => t.includes('시민 팀 승리'))).toBe(true);
        // 죽은 민수는 투표하지 않는다
        expect(texts().some((t) => t.startsWith('🗳️ 민수'))).toBe(false);
        // 진행 모델은 살아 있는 사람만 고를 수 있다
        const members = mocks.moderate.mock.calls[0][0].members.map(
            (m: { name: string }) => m.name
        );
        expect(members).toEqual(['철수', '영희', '지수']);
    });

    it('records each solo night pick with its reason for the host and observers only', async () => {
        store.set(roomsAtom, [
            makeRoom({ a: 'mafia', b: 'doctor', c: 'police', d: 'citizen' }),
        ]);
        mocks.streamChat.mockImplementation(
            responder({
                철수: (c) => (c.includes('처형') ? '영희' : '민수'),
                영희: (c) => (c.includes('지킬') ? '영희' : '철수'),
                지수: () => '철수',
                민수: () => '철수',
            })
        );
        startConversation('r');
        await vi.runAllTimersAsync();

        const reasons = room().messages.filter(
            (m) => m.to?.[0] === 'gm' && m.text.includes('골랐음')
        );
        expect(reasons.map((m) => [m.text, m.to])).toEqual([
            ['🔪 마피아 철수 → 민수 노림 · 철수 골랐음', ['gm']],
            ['🩺 의사 영희 → 영희 지킴 · 영희 골랐음', ['gm']],
            ['🔍 경찰 지수 → 철수 조사 · 지수 골랐음', ['gm']],
        ]);
        // 다른 에이전트의 프롬프트에는 들어가지 않는다
        const prompts = mocks.streamChat.mock.calls.map(
            (c) => (c[0] as ChatRequest).messages[0].content as string
        );
        expect(prompts.some((p) => p.includes('지킴 ·'))).toBe(false);
        expect(prompts.some((p) => p.includes('조사 ·'))).toBe(false);
    });

    it('lets every doctor protect someone, and any save stops the kill', async () => {
        store.set(roomsAtom, [
            makeRoom({ a: 'mafia', b: 'doctor', c: 'doctor', d: 'citizen' }),
        ]);
        mocks.streamChat.mockImplementation(
            responder({
                철수: () => '민수',
                영희: (c) => (c.includes('지킬') ? '영희' : '철수'),
                지수: (c) => (c.includes('지킬') ? '민수' : '철수'),
                민수: () => '철수',
            })
        );
        startConversation('r');
        await vi.runAllTimersAsync();

        expect(texts()).toContain(
            '📝 1번째 밤 기록: 마피아 → 민수 · 의사 → 영희, 민수'
        );
        expect(
            texts().some((t) => t.includes('밤사이 아무도 죽지 않았어요'))
        ).toBe(true);
        expect(game().players.find((p) => p.id === 'd')?.alive).toBe(true);
    });

    it('lets each police officer investigate alone and tells only them', async () => {
        store.set(roomsAtom, [
            makeRoom({ a: 'mafia', b: 'police', c: 'police', d: 'citizen' }),
        ]);
        mocks.streamChat.mockImplementation(
            responder({
                철수: () => '민수',
                영희: (c) => (c.includes('조사') ? '철수' : '철수'),
                지수: (c) => (c.includes('조사') ? '민수' : '철수'),
                민수: () => '철수',
            })
        );
        startConversation('r');
        await vi.runAllTimersAsync();

        expect(game().checks).toEqual([
            { day: 1, target: 'a', mafia: true, by: 'b' },
            { day: 1, target: 'd', mafia: false, by: 'c' },
        ]);
        const results = room().messages.filter((m) =>
            m.text.includes('조사 결과')
        );
        expect(results.map((m) => m.to)).toEqual([['b'], ['c']]);
    });

    it('lets mafia agents talk to each other privately before picking', async () => {
        store.set(roomsAtom, [
            makeRoom({ a: 'mafia', b: 'mafia', c: 'police', d: 'citizen' }),
        ]);
        mocks.streamChat.mockImplementation(
            responder({
                철수: () => '민수',
                영희: () => '민수',
                지수: () => '영희',
            })
        );
        startConversation('r');
        await vi.advanceTimersByTimeAsync(20_000);
        stopConversation('r');

        const team = room().messages.filter(
            (m) => m.sender === 'a' || m.sender === 'b'
        );
        const atNight = team.filter(
            (m) =>
                room().messages.indexOf(m) <
                room().messages.findIndex((x) => x.text.includes('아침'))
        );
        expect(atNight.length).toBeGreaterThan(0);
        expect(atNight.every((m) => m.to?.length === 1)).toBe(true);
        expect(game().players.find((p) => p.id === 'd')?.alive).toBe(false);
    });
});

describe('mafia game · player', () => {
    it('waits for my night action and hides what I should not know', async () => {
        store.set(roomsAtom, [
            makeRoom(
                { a: 'mafia', b: 'doctor', c: 'citizen', me: 'police' },
                { userRole: 'player' }
            ),
        ]);
        mocks.streamChat.mockImplementation(
            responder({
                철수: (c) => (c.includes('처형') ? '영희' : '지수'),
                영희: (c) => (c.includes('지킬') ? '영희' : '철수'),
                지수: () => '철수',
            })
        );
        startConversation('r');
        await vi.runAllTimersAsync();

        expect(userAction(room())).toMatchObject({ kind: 'check' });
        expect(store.get(idleNoteAtom).r).toContain('조사할 사람');
        // 마피아·의사의 밤 행동은 내게 보이지 않는다 (혼자인 마피아의 말도 공개되지 않는다)
        expect(
            room()
                .messages.filter((m) => userCanSee(room(), m))
                .some((m) => m.sender === 'a' || m.sender === 'b')
        ).toBe(false);

        submitMafiaAction('r', 'a');
        await vi.runAllTimersAsync();
        const result = room().messages.find((m) =>
            m.text.includes('조사 결과')
        );
        expect(result?.to).toEqual(['me']);
        expect(userCanSee(room(), result!)).toBe(true);
        // 지수가 밤에 죽고 낮 토론이 잦아들면 내 결정을 기다린다
        expect(game().phase).toBe('day');
        expect(game().players.find((p) => p.id === 'c')?.alive).toBe(false);
        expect(store.get(idleNoteAtom).r).toContain('투표 시작');

        await startMafiaVote('r');
        await vi.runAllTimersAsync();
        expect(userAction(room())).toMatchObject({ kind: 'vote' });
        submitMafiaAction('r', 'a');
        await vi.runAllTimersAsync();

        expect(game().phase).toBe('ended');
        expect(game().winner).toBe('citizen');
    });

    it('lets me say last words through the chat box', async () => {
        store.set(roomsAtom, [
            makeRoom(
                { a: 'mafia', b: 'doctor', c: 'citizen', me: 'citizen' },
                {
                    userRole: 'player',
                    phase: 'lastWords',
                    accused: 'me',
                    lastSaid: false,
                }
            ),
        ]);
        mocks.streamChat.mockImplementation(responder({}));
        startConversation('r');
        await vi.runAllTimersAsync();
        expect(userAction(room())).toMatchObject({ kind: 'lastWords' });

        submitMafiaAction('r', null);
        await vi.runAllTimersAsync();
        expect(game().players.find((p) => p.id === 'me')?.alive).toBe(false);
        expect(texts()).toContain('⚖️ 나님이 처형됐어요.');
    });
});

describe('mafia game · host', () => {
    it('holds at each phase until the host presses ▶', async () => {
        store.set(roomsAtom, [
            makeRoom(
                { a: 'mafia', b: 'doctor', c: 'police', d: 'citizen' },
                { userRole: 'host', hold: true }
            ),
        ]);
        mocks.streamChat.mockImplementation(
            responder({
                철수: () => '민수',
                영희: () => '지수',
                지수: () => '영희',
            })
        );
        startConversation('r');
        await vi.runAllTimersAsync();
        expect(mocks.streamChat).not.toHaveBeenCalled();
        expect(store.get(idleNoteAtom).r).toContain('밤 진행');

        startConversation('r', { manual: true });
        await vi.runAllTimersAsync();
        expect(game().phase).toBe('day');
        expect(game().hold).toBe(true);
        expect(store.get(idleNoteAtom).r).toContain('낮 토론 시작');
    });
});

describe('starting a game', () => {
    it("starts a new game without the previous game's log, feelings or memories", async () => {
        const old = Date.now() - 60_000;
        store.set(roomsAtom, [
            {
                ...makeRoom({}),
                agents: AGENTS.map((a) => ({
                    ...a,
                    feeling: '지난 판에 영희를 쏴서 괴로움',
                    memories: ['영희가 마피아였다'],
                })),
                messages: [
                    {
                        id: 'm1',
                        sender: 'system',
                        text: '🎬 철수는 영희를 제거했다',
                        notice: true,
                        ts: old,
                    },
                    { id: 'm2', sender: 'b', text: '살려 줘', ts: old + 1 },
                ],
                modeState: {
                    mafia: {
                        ...makeRoom({ a: 'mafia', b: 'citizen' }).modeState!
                            .mafia!,
                        phase: 'ended',
                        winner: 'mafia',
                        startedAt: old - 1000,
                    },
                },
                mafia: {
                    userRole: 'observer',
                    mafia: 1,
                    doctor: 0,
                    police: 0,
                    reveal: false,
                    dayTalk: 6,
                },
            },
        ]);
        mocks.streamChat.mockImplementation(responder({}));
        await startMafiaGame('r');
        await vi.runAllTimersAsync();
        expect(game().startedAt).toBeGreaterThan(old);
        const sent = mocks.streamChat.mock.calls.map(
            (call) => (call[0] as ChatRequest).messages[0].content as string
        );
        expect(sent.length).toBeGreaterThan(0);
        for (const content of sent) {
            expect(content).not.toContain('영희를 제거했다');
            expect(content).not.toContain('살려 줘');
            expect(content).not.toContain('괴로움');
            expect(content).not.toContain('영희가 마피아였다');
        }
    });
    it('starts a manual game with the specified roles and reveals them only after introductions', async () => {
        const roles = {
            a: 'mafia',
            b: 'doctor',
            c: 'police',
            d: 'citizen',
        } as const;
        store.set(roomsAtom, [
            {
                ...makeRoom({}),
                modeState: undefined,
                mafia: {
                    userRole: 'host',
                    roleAssignment: 'manual',
                    assignedRoles: roles,
                    mafia: 1,
                    doctor: 1,
                    police: 1,
                    reveal: false,
                    dayTalk: 6,
                },
            },
        ]);
        mocks.streamChat.mockImplementation(responder({}));
        await startMafiaGame('r');
        await vi.runAllTimersAsync();
        expect(
            Object.fromEntries(game().players.map((p) => [p.id, p.role]))
        ).toEqual(roles);
        expect(game().phase).toBe('introduction');
        expect(texts().some((t) => t.startsWith('🎭'))).toBe(false);
        startConversation('r', { manual: true });
        await vi.runAllTimersAsync();
        expect(game().phase).toBe('night');
        expect(game().day).toBe(1);
        expect(game().hold).toBe(true);
        expect(
            room().messages.find((m) => m.text.startsWith('🎭 역할:'))
        ).toMatchObject({
            to: ['gm'],
            text: '🎭 역할: 철수 마피아, 영희 의사, 지수 경찰, 민수 시민',
        });
    });
    it('starts with introductions and defers role notices until the first night', async () => {
        store.set(roomsAtom, [
            {
                ...makeRoom({}),
                modeState: undefined,
                mafia: {
                    userRole: 'host',
                    mafia: 1,
                    doctor: 1,
                    police: 1,
                    reveal: false,
                    dayTalk: 6,
                },
            },
        ]);
        await startMafiaGame('r');
        await vi.runAllTimersAsync();
        expect(game().players).toHaveLength(4);
        expect(game().dayTalk).toBe(6);
        expect(game().phase).toBe('introduction');
        expect(game().introduced).toEqual([]);
        expect(texts().some((t) => t.includes('자기소개'))).toBe(true);
        expect(texts().some((t) => t.startsWith('🎭'))).toBe(false);
        expect(texts().some((t) => t.includes('1번째 밤'))).toBe(false);

        mocks.streamChat.mockImplementation(responder({}));
        startConversation('r', { manual: true });
        await vi.runAllTimersAsync();
        expect(game().phase).toBe('night');
        expect(game().day).toBe(1);
        expect(game().hold).toBe(true);
        const roles = room().messages.find((m) => m.text.startsWith('🎭'));
        expect(roles?.to).toEqual(['gm']);
        expect(texts().some((t) => t.includes('1번째 밤'))).toBe(true);
    });
});

describe('mafia introductions', () => {
    const roles = {
        a: 'mafia',
        b: 'doctor',
        c: 'police',
        d: 'citizen',
    } as const;

    it('introduces every agent publicly in seat order before automatic night actions', async () => {
        store.set(roomsAtom, [
            makeRoom(roles, { phase: 'introduction', introduced: [] }),
        ]);
        mocks.streamChat.mockImplementation(
            responder({
                철수: (c) => (c.includes('처형') ? '영희' : '민수'),
                영희: (c) => (c.includes('지킬') ? '영희' : '철수'),
                지수: () => '철수',
                민수: () => '철수',
            })
        );
        startConversation('r');
        await vi.runAllTimersAsync();

        const firstNight = room().messages.findIndex((m) =>
            m.text.startsWith('🌙 1번째 밤')
        );
        expect(firstNight).toBeGreaterThan(0);
        const introductions = room()
            .messages.slice(0, firstNight)
            .filter((m) => m.sender !== 'system');
        expect(introductions.map((m) => m.sender)).toEqual([
            'a',
            'b',
            'c',
            'd',
        ]);
        expect(introductions.every((m) => !m.to?.length)).toBe(true);
        expect(game().introduced).toEqual(['a', 'b', 'c', 'd']);
        for (const [req] of mocks.streamChat.mock.calls.slice(0, 4)) {
            expect(req.instructions).not.toContain('너의 역할:');
            expect(req.instructions).not.toContain('같은 마피아:');
            expect(req.messages[0].content).toContain('자기소개');
        }
        expect(mocks.streamChat.mock.calls[4][0].instructions).toContain(
            '너의 역할: 마피아'
        );
        expect(game().winner).toBe('citizen');
    });

    it('resumes saved progress and skips removed participants without repeating introductions', async () => {
        const saved = makeRoom(roles, {
            userRole: 'host',
            phase: 'introduction',
            introduced: ['a'],
        });
        saved.agents = saved.agents.filter((a) => a.id !== 'b');
        saved.messages = [
            { id: 'intro-a', sender: 'a', text: '철수 소개', ts: 1 },
        ];
        store.set(roomsAtom, [saved]);
        mocks.streamChat.mockImplementation(responder({}));
        startConversation('r');
        await vi.runAllTimersAsync();

        expect(
            room()
                .messages.filter((m) => m.sender !== 'system')
                .map((m) => m.sender)
        ).toEqual(['a', 'c', 'd']);
        expect(mocks.streamChat).toHaveBeenCalledTimes(2);
        expect(mocks.moderate).not.toHaveBeenCalled();
        expect(game()).toMatchObject({
            phase: 'night',
            day: 1,
            hold: true,
        });
    });

    it.each(['empty', 'failure'] as const)(
        'keeps the same introduction turn for retry after %s output',
        async (failure) => {
            store.set(roomsAtom, [
                makeRoom(roles, {
                    userRole: 'host',
                    phase: 'introduction',
                    introduced: [],
                }),
            ]);
            if (failure === 'empty') mocks.streamChat.mockResolvedValue('');
            else mocks.streamChat.mockRejectedValue(new Error('offline'));
            startConversation('r');
            await vi.runAllTimersAsync();
            expect(game().phase).toBe('introduction');
            expect(game().introduced).toEqual([]);
            expect(mocks.streamChat).toHaveBeenCalledTimes(1);
            expect(mocks.moderate).not.toHaveBeenCalled();

            mocks.streamChat.mockImplementation(responder({}));
            startConversation('r', { manual: true });
            await vi.runAllTimersAsync();
            expect(game().introduced).toEqual(['a', 'b', 'c', 'd']);
            expect(game().phase).toBe('night');
            expect(
                room()
                    .messages.filter((m) => m.sender !== 'system')
                    .map((m) => m.sender)
            ).toEqual(['a', 'b', 'c', 'd']);
        }
    );

    it('retries the same participant after an interrupted generation with no published introduction', async () => {
        store.set(roomsAtom, [
            makeRoom(roles, {
                userRole: 'host',
                phase: 'introduction',
                introduced: [],
            }),
        ]);
        mocks.streamChat.mockImplementation(
            (_req: ChatRequest, { signal }: { signal: AbortSignal }) =>
                new Promise<string>((_resolve, reject) => {
                    signal.addEventListener('abort', () =>
                        reject(new Error('aborted'))
                    );
                })
        );
        startConversation('r');
        await vi.runAllTimersAsync();
        expect(mocks.streamChat).toHaveBeenCalledTimes(1);
        stopConversation('r');
        await vi.runAllTimersAsync();
        expect(game().introduced).toEqual([]);
        expect(room().messages).toEqual([]);

        mocks.streamChat.mockImplementation(responder({}));
        startConversation('r', { manual: true });
        await vi.runAllTimersAsync();
        expect(game().introduced).toEqual(['a', 'b', 'c', 'd']);
        expect(room().messages.find((m) => m.sender !== 'system')?.sender).toBe(
            'a'
        );
    });

    it('persists the first published introduction immediately and does not repeat it after reload', async () => {
        store.set(roomsAtom, [
            makeRoom(roles, {
                userRole: 'host',
                phase: 'introduction',
                introduced: [],
            }),
        ]);
        mocks.streamChat.mockResolvedValue('첫 소개 한마디\n두 번째 소개');
        startConversation('r');
        for (let i = 0; i < 20; i++) {
            if (room().messages.some((m) => m.sender === 'a')) break;
            await vi.advanceTimersToNextTimerAsync();
        }
        expect(room().messages.filter((m) => m.sender === 'a')).toHaveLength(1);
        // 첫 말풍선과 완료 상태가 함께 저장돼야 전송 중 새로고침에도 중복되지 않는다.
        expect(game().introduced).toEqual(['a']);
        const snapshot = JSON.parse(JSON.stringify(room())) as Room;
        stopConversation('r');
        await vi.runAllTimersAsync();
        expect(game().introduced).toEqual(['a']);

        store.set(roomsAtom, [snapshot]);
        mocks.streamChat.mockImplementation(responder({}));
        startConversation('r', { manual: true });
        await vi.runAllTimersAsync();
        expect(room().messages.filter((m) => m.sender === 'a')).toHaveLength(1);
        expect(mocks.streamChat).toHaveBeenCalledTimes(4);
        expect(game().phase).toBe('night');
    });

    it.each(['chat', 'skip'] as const)(
        'waits for the human introduction and proceeds after %s',
        async (action) => {
            store.set(roomsAtom, [
                makeRoom(
                    { ...roles, c: 'citizen', me: 'police' },
                    {
                        userRole: 'player',
                        phase: 'introduction',
                        introduced: [],
                    }
                ),
            ]);
            mocks.streamChat.mockImplementation(
                responder({ 철수: () => '민수', 영희: () => '영희' })
            );
            startConversation('r');
            await vi.runAllTimersAsync();
            expect(userAction(room())).toMatchObject({
                kind: 'introduction',
            });
            expect(game().introduced).toEqual(['a', 'b', 'c', 'd']);
            expect(texts().some((t) => t.startsWith('🎭'))).toBe(false);

            if (action === 'chat') {
                appendMessage('r', {
                    sender: 'me',
                    text: '안녕하세요. 저는 책을 좋아하는 나예요.',
                });
                await onUserMessage('r');
            } else submitMafiaAction('r', null);
            await vi.runAllTimersAsync();

            expect(game().introduced).toContain('me');
            expect(game().phase).toBe('night');
            expect(game().day).toBe(1);
            expect(userAction(room())).toMatchObject({ kind: 'check' });
            const rolesNotice = room().messages.find((m) =>
                m.text.startsWith('🎭 내 역할')
            );
            expect(rolesNotice?.to).toEqual(['me']);
        }
    );
});

describe('mafia ending', () => {
    /** 마피아 철수가 처형되기 직전: 처형되면 시민 팀이 이긴다 */
    const beforeExecution = (patch: Partial<MafiaGame> = {}) =>
        makeRoom(
            { a: 'mafia', b: 'doctor', c: 'police', d: 'citizen' },
            { phase: 'lastWords', accused: 'a', lastSaid: true, ...patch }
        );
    const said = (name: string) =>
        mocks.streamChat.mock.calls
            .map((c) => c[0] as ChatRequest)
            .filter((req) => req.instructions.includes(`"${name}"이다`));

    it('plays the scenes the director planned from the setting, then ends the game', async () => {
        store.set(roomsAtom, [beforeExecution()]);
        mocks.planMafiaEnding.mockResolvedValue({
            ok: true,
            via: '',
            beats: [
                { type: 'narration', text: '문이 열리고 출구가 보인다.' },
                {
                    type: 'line',
                    speaker: '영희',
                    direction: '출구 앞에 섰다. 처형된 철수의 자리를 본다.',
                },
                {
                    type: 'talk',
                    speakers: 'all',
                    turns: 1,
                    direction: '누가 누구를 의심했는지 이야기한다.',
                },
            ],
        });
        mocks.moderate.mockResolvedValueOnce({
            ok: true,
            candidates: [{ speaker: 1, note: '' }],
            waitMs: 0,
            reason: '',
        });
        mocks.streamChat.mockImplementation((req: ChatRequest) =>
            Promise.resolve(
                `${req.instructions.match(/에 있는 "(.+?)"이다/)?.[1]} 한마디`
            )
        );
        startConversation('r');
        await vi.runAllTimersAsync();

        // 연출 모델은 상황 설정, 승패, 역할 공개된 참가자, 이번 판 기록을 받는다
        const [request] = mocks.planMafiaEnding.mock.calls[0];
        expect(request).toMatchObject({
            topic: '산골 마을',
            winner: 'citizen',
        });
        expect(request.players[0]).toMatchObject({
            name: '철수',
            role: '마피아',
            alive: false,
            death: '1번째 낮 투표로 처형됨',
        });
        expect(
            request.transcript.some((m: { text: string }) =>
                m.text.includes('철수님이 처형됐어요')
            )
        ).toBe(true);

        const scene = texts().slice(
            texts().findIndex((t) => t.includes('시민 팀 승리'))
        );
        expect(scene).toEqual([
            '🏁 마피아가 모두 사라졌어요. 시민 팀 승리!',
            expect.stringContaining('🎭 역할 공개'),
            '🎬 문이 열리고 출구가 보인다.',
            '영희 한마디',
            '철수 한마디',
        ]);
        // 장면의 상황은 그 인물에게만 지금 상황으로 전해진다
        const line = said('영희')[0].messages[0].content as string;
        expect(line).toContain('엔딩 장면 속 너의 차례');
        expect(line).toContain('처형된 철수의 자리를 본다');
        expect(said('영희')[0].instructions).toContain('시민 팀이 이겼다');
        // 자유 대화에는 죽은 사람을 포함해 장면의 참가자 모두가 나올 수 있다
        expect(
            mocks.moderate.mock.calls[0][0].members.map(
                (m: { name: string }) => m.name
            )
        ).toEqual(['철수', '영희', '지수', '민수']);
        expect(mocks.moderate.mock.calls[0][0].topic).toContain(
            '누가 누구를 의심했는지'
        );
        expect(game().phase).toBe('ended');
        expect(store.get(idleNoteAtom).r).toContain('뒷얘기');
    });

    it('falls back to everyone talking when the director fails', async () => {
        store.set(roomsAtom, [beforeExecution()]);
        mocks.planMafiaEnding.mockResolvedValue({ ok: false, error: '오류' });
        startConversation('r');
        await vi.runAllTimersAsync();

        const notice = room().messages.find((m) =>
            m.text.includes('엔딩 연출을 만들지 못해')
        );
        expect(notice?.to).toEqual(['gm']);
        expect(
            mocks.moderate.mock.calls
                .at(-1)![0]
                .members.map((m: { name: string }) => m.name)
        ).toEqual(['철수', '영희', '지수', '민수']);
        expect(game().phase).toBe('ended');
    });

    it('waits for my line in the ending and lets me skip it with ▶', async () => {
        store.set(roomsAtom, [
            makeRoom(
                { a: 'mafia', b: 'doctor', c: 'citizen', me: 'citizen' },
                {
                    userRole: 'player',
                    phase: 'lastWords',
                    accused: 'a',
                    lastSaid: true,
                }
            ),
        ]);
        mocks.planMafiaEnding.mockResolvedValue({
            ok: true,
            via: '',
            beats: [
                { type: 'line', speaker: '나', direction: '살아남았다' },
                { type: 'narration', text: '모두 집으로 돌아간다.' },
            ],
        });
        startConversation('r');
        await vi.runAllTimersAsync();

        expect(game().phase).toBe('epilogue');
        expect(store.get(idleNoteAtom).r).toContain('엔딩 속 내 차례');
        expect(userComposerOf()).toMatchObject({ allowed: true });

        appendMessage('r', { sender: 'me', text: '살았다…' });
        void onUserMessage('r');
        await vi.runAllTimersAsync();

        expect(texts().at(-1)).toBe('🎬 모두 집으로 돌아간다.');
        expect(game().phase).toBe('ended');
    });

    it('skips the rest of the ending with the stop button', async () => {
        store.set(roomsAtom, [
            beforeExecution({
                phase: 'epilogue',
                winner: 'citizen',
                epilogue: {
                    at: 0,
                    talk: 0,
                    beats: [{ type: 'narration', text: '끝' }],
                },
            }),
        ]);
        stopMafiaGame('r');
        expect(game().phase).toBe('ended');
        expect(texts()).toEqual(['🎬 엔딩을 건너뛰었어요']);
    });
});

describe('mafia verdict', () => {
    const requests = (name: string) =>
        mocks.streamChat.mock.calls
            .map((c) => c[0] as ChatRequest)
            .filter((req) => req.instructions.includes(`"${name}"이다`))
            .map((req) => req.messages[0].content as string);

    it('asks the others whether to execute, hides each choice until all chose, then executes', async () => {
        store.set(roomsAtom, [
            makeRoom(
                { a: 'mafia', b: 'doctor', c: 'police', d: 'citizen' },
                {
                    phase: 'lastWords',
                    accused: 'a',
                    lastSaid: true,
                    verdict: true,
                }
            ),
        ]);
        mocks.streamChat.mockImplementation(
            responder({
                영희: () => '처형한다',
                지수: () => '처형한다',
                민수: () => '살려 둔다',
            })
        );
        startConversation('r');
        await vi.runAllTimersAsync();

        // 지목된 철수는 투표하지 않는다
        expect(requests('철수')).toHaveLength(0);
        // 뒤에 고르는 사람은 앞사람의 선택과 한마디를 보지 못한다
        const later = requests('민수')[0];
        expect(later).toContain('1. 처형한다');
        expect(later).not.toContain('영희 골랐음');
        const from = texts().findIndex((t) => t.includes('찬반 투표해요'));
        expect(texts().slice(from, from + 6)).toEqual([
            '⚖️ 철수님을 처형할지 찬반 투표해요. 찬성이 반대보다 많아야 처형하고, 같으면 살려 둬요.',
            '영희 골랐음',
            '지수 골랐음',
            '민수 골랐음',
            '⚖️ 찬반 결과: 처형 2 · 살려 둠 1 (처형: 영희, 지수 / 살려 둠: 민수)',
            '⚖️ 철수님이 처형됐어요.',
        ]);
        expect(game().winner).toBe('citizen');
    });

    it('spares on a tie, counts a missing pick as spare and tells only the host', async () => {
        store.set(roomsAtom, [
            makeRoom(
                { a: 'mafia', b: 'doctor', c: 'police', d: 'citizen' },
                {
                    userRole: 'host',
                    phase: 'lastWords',
                    accused: 'd',
                    lastSaid: true,
                    verdict: true,
                }
            ),
        ]);
        mocks.streamChat.mockImplementation(
            responder({ 철수: () => '처형한다', 지수: () => '살려 둔다' })
        );
        startConversation('r');
        await vi.runAllTimersAsync();

        const warning = room().messages.find((m) =>
            m.text.includes('영희님이 찬반을 고르지 않아')
        );
        expect(warning?.to).toEqual(['gm']);
        expect(texts()).toContain(
            '⚖️ 찬반 결과: 처형 1 · 살려 둠 2 (처형: 철수 / 살려 둠: 영희, 지수)'
        );
        expect(texts()).toContain('⚖️ 민수님은 살아남았어요.');
        expect(game().players.find((p) => p.id === 'd')?.alive).toBe(true);
        expect(game()).toMatchObject({ phase: 'night', day: 2 });
        expect(game().verdicts).toBeUndefined();
    });

    it('waits for my verdict as a player and keeps it hidden until the reveal', async () => {
        store.set(roomsAtom, [
            makeRoom(
                { a: 'mafia', b: 'doctor', c: 'citizen', me: 'citizen' },
                {
                    userRole: 'player',
                    phase: 'lastWords',
                    accused: 'a',
                    lastSaid: true,
                    verdict: true,
                }
            ),
        ]);
        mocks.streamChat.mockImplementation(
            responder({ 영희: () => '살려 둔다', 지수: () => '처형한다' })
        );
        startConversation('r');
        await vi.runAllTimersAsync();

        expect(store.get(idleNoteAtom).r).toContain('처형할지 골라');
        expect(userAction(room())).toMatchObject({
            kind: 'verdict',
            plain: true,
            options: [
                { id: '0', name: '처형한다' },
                { id: '1', name: '살려 둔다' },
            ],
        });
        // 아직 공개 전이라 다른 사람의 선택이 보이지 않는다
        expect(texts().some((t) => t.includes('골랐음'))).toBe(false);

        submitMafiaAction('r', '0');
        await vi.runAllTimersAsync();
        expect(texts()).toContain(
            '⚖️ 찬반 결과: 처형 2 · 살려 둠 1 (처형: 지수, 나 / 살려 둠: 영희)'
        );
        expect(game().winner).toBe('citizen');
    });

    it('keeps the old flow for games saved before the verdict existed', async () => {
        store.set(roomsAtom, [
            makeRoom(
                { a: 'mafia', b: 'doctor', c: 'police', d: 'citizen' },
                { phase: 'lastWords', accused: 'a', lastSaid: true }
            ),
        ]);
        startConversation('r');
        await vi.runAllTimersAsync();
        expect(texts().some((t) => t.includes('찬반'))).toBe(false);
        expect(texts()).toContain('⚖️ 철수님이 처형됐어요.');
    });

    it('counts a vote without a number as abstaining and tells only the host', async () => {
        store.set(roomsAtom, [
            makeRoom(
                { a: 'mafia', b: 'doctor', c: 'police', d: 'citizen' },
                { userRole: 'host', phase: 'vote' }
            ),
        ]);
        mocks.streamChat.mockImplementation(responder({}));
        startConversation('r');
        await vi.runAllTimersAsync();

        const warnings = room().messages.filter((m) =>
            m.text.includes('투표 번호를 쓰지 않아 기권으로')
        );
        expect(warnings).toHaveLength(4);
        expect(warnings.every((m) => m.to?.[0] === 'gm')).toBe(true);
        expect(texts()).toContain(
            '🗳️ 투표 결과: 모두 기권 · 아무도 처형하지 않아요.'
        );
    });
});

describe('mafia ending decisions', () => {
    const beforeExecution = () =>
        makeRoom(
            { a: 'mafia', b: 'doctor', c: 'police', d: 'citizen' },
            { phase: 'lastWords', accused: 'a', lastSaid: true }
        );

    it('lets the character decide, then has the director continue from that choice', async () => {
        store.set(roomsAtom, [beforeExecution()]);
        mocks.planMafiaEnding
            .mockResolvedValueOnce({
                ok: true,
                via: '',
                after: 'alive',
                beats: [
                    { type: 'narration', text: '탁자 위에 상자가 놓여 있다.' },
                    {
                        type: 'decision',
                        speaker: '영희',
                        direction: '설정상 상자를 열어야 한다.',
                        options: ['연다', '두고 간다'],
                    },
                    // 결정 뒤의 장면은 결정을 보고 다시 짜야 하므로 버린다
                    { type: 'narration', text: '미리 쓴 결과' },
                ],
            })
            .mockResolvedValueOnce({
                ok: true,
                via: '',
                beats: [
                    {
                        type: 'narration',
                        text: '영희가 문밖으로 떠난다.',
                        gone: ['영희'],
                    },
                    { type: 'line', speaker: '영희', direction: '떠난 뒤' },
                    { type: 'line', speaker: '지수', direction: '남았다' },
                ],
            });
        mocks.streamChat.mockImplementation(
            responder({ 영희: () => '두고 간다' })
        );
        startConversation('r');
        await vi.runAllTimersAsync();

        const [first] = mocks.planMafiaEnding.mock.calls[0];
        const [second] = mocks.planMafiaEnding.mock.calls[1];
        expect(first.decisionsLeft).toBe(5);
        expect(second.decisionsLeft).toBe(4);
        expect(
            second.transcript.some((m: { text: string }) =>
                m.text.includes('영희님의 선택: 두고 간다')
            )
        ).toBe(true);

        const scene = texts().slice(
            texts().findIndex((t) => t.startsWith('🎬'))
        );
        expect(scene).toEqual([
            '🎬 탁자 위에 상자가 놓여 있다.',
            '영희 골랐음',
            '🎬 영희님의 선택: 두고 간다',
            '🎬 영희가 문밖으로 떠난다.',
            '지수 한마디',
        ]);
        // 결과는 바뀌지 않고, 엔딩에서 빠진 사람은 따로 기록한다
        expect(game().players.find((p) => p.id === 'b')?.alive).toBe(true);
        expect(game().epilogue).toMatchObject({ gone: ['b'], after: 'alive' });
        expect(game().phase).toBe('ended');
        expect(speakingAgents(room()).map((a) => a.name)).toEqual([
            '지수',
            '민수',
        ]);
        const instructions = mocks.streamChat.mock.calls
            .map((c) => c[0] as ChatRequest)
            .find((r) => r.instructions.includes('"영희"이다'))!;
        expect(instructions.messages[0].content).toContain(
            '엔딩 장면 속 너의 결정 차례'
        );
    });

    it('waits for my decision in the ending and passes my choice on', async () => {
        store.set(roomsAtom, [
            makeRoom(
                { a: 'mafia', b: 'doctor', c: 'citizen', me: 'citizen' },
                {
                    userRole: 'player',
                    phase: 'lastWords',
                    accused: 'a',
                    lastSaid: true,
                }
            ),
        ]);
        mocks.planMafiaEnding
            .mockResolvedValueOnce({
                ok: true,
                via: '',
                beats: [
                    {
                        type: 'decision',
                        speaker: '나',
                        direction: '문 앞에 섰다',
                        options: ['나간다', '남는다'],
                    },
                ],
            })
            .mockResolvedValueOnce({
                ok: true,
                via: '',
                beats: [{ type: 'narration', text: '문이 닫힌다.' }],
            });
        startConversation('r');
        await vi.runAllTimersAsync();

        expect(userAction(room())).toMatchObject({
            kind: 'decision',
            plain: true,
            options: [
                { id: '0', name: '나간다' },
                { id: '1', name: '남는다' },
            ],
        });
        expect(userComposerOf()).toMatchObject({ allowed: false });

        submitMafiaAction('r', '1');
        await vi.runAllTimersAsync();
        expect(texts().slice(-2)).toEqual([
            '🎬 나님의 선택: 남는다',
            '🎬 문이 닫힌다.',
        ]);
        expect(game().phase).toBe('ended');
    });
});

describe('feelings and memories', () => {
    it('keeps each agent’s feeling and memories to that agent, even from hidden turns', async () => {
        store.set(roomsAtom, [
            makeRoom({ a: 'mafia', b: 'doctor', c: 'police', d: 'citizen' }),
        ]);
        const plan = responder({
            철수: () => '민수',
            영희: (c) => (c.includes('지킬') ? '민수' : '철수'),
            지수: () => '철수',
            민수: () => '철수',
        });
        mocks.streamChat.mockImplementation(async (req: ChatRequest) => {
            const reply = await plan(req);
            const name = req.instructions.match(/에 있는 "(.+?)"이다/)?.[1];
            return name === '철수'
                ? `[감정: 들킬까 봐 초조함]\n${reply}\n[기억: 민수를 노림]`
                : name === '영희'
                  ? `${reply}\n[기억: 민수를 지킴]`
                  : reply;
        });
        startConversation('r');
        await vi.runAllTimersAsync();

        const agents = room().agents;
        expect(agents.find((a) => a.id === 'a')).toMatchObject({
            feeling: '들킬까 봐 초조함',
            memories: ['민수를 노림'],
        });
        // 의사의 숨은 밤 행동에서도 기억을 남긴다
        expect(agents.find((a) => a.id === 'b')?.memories).toEqual([
            '민수를 지킴',
        ]);
        expect(texts().some((t) => t.includes('[기억'))).toBe(false);
        expect(texts().some((t) => t.includes('[감정'))).toBe(false);
        const prompts = mocks.streamChat.mock.calls.map(
            (c) => c[0] as ChatRequest
        );
        const of = (name: string) =>
            prompts
                .filter((r) => r.instructions.includes(`"${name}"이다`))
                .map((r) => r.messages[0].content as string);
        // 철수의 다음 차례에는 자기 감정과 기억이 보이고, 다른 사람에게는 보이지 않는다
        expect(of('철수').at(-1)).toContain('[철수만 아는 기억]');
        for (const other of ['영희', '지수', '민수'])
            expect(of(other).some((c) => c.includes('민수를 노림'))).toBe(
                false
            );
    });

    it('clears memories and feelings when a new game starts', async () => {
        const saved = makeRoom({
            a: 'mafia',
            b: 'doctor',
            c: 'police',
            d: 'citizen',
        });
        saved.agents = saved.agents.map((a) => ({
            ...a,
            feeling: '지침',
            memories: ['지난 판 기억'],
        }));
        saved.modeState = undefined;
        store.set(roomsAtom, [saved]);
        mocks.streamChat.mockResolvedValue('안녕하세요');
        await startMafiaGame('r');
        expect(room().agents.every((a) => a.memories?.length === 0)).toBe(true);
        expect(room().agents.every((a) => a.feeling === undefined)).toBe(true);
    });
});
