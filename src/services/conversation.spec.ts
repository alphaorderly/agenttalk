import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
    ChatRequest,
    ModerateRequest,
    ModerateResponse,
} from '@shared/providers';
import type { Agent, Room } from '@/types/chat';
import {
    appendMessage,
    idleNoteAtom,
    pendingAtom,
    roomsAtom,
    runningAtom,
    store,
} from '@stores/chat';
import {
    isConversationRunning,
    onUserMessage,
    startConversation,
    stopConversation,
} from './conversation';

const mocks = vi.hoisted(() => ({
    moderate: vi.fn(),
    streamChat: vi.fn(),
    toastError: vi.fn(),
}));

vi.mock('react-hot-toast', () => ({ default: { error: mocks.toastError } }));
vi.mock('./api', () => ({
    moderate: mocks.moderate,
    streamChat: mocks.streamChat,
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
let roomCount = 0;
const makeRoom = (overrides: Partial<Room> = {}): Room => ({
    id: `conversation-test-${++roomCount}`,
    name: '방',
    topic: '주제',
    profileId: null,
    agents: [agent('a', '철수')],
    messages: [{ id: `human-${roomCount}`, sender: 'me', text: '시작', ts: 0 }],
    updatedAt: 0,
    ...overrides,
});
const decision = (speaker = 1): ModerateResponse => ({
    ok: true,
    candidates: speaker ? [{ speaker, note: '' }] : [],
    waitMs: 0,
    reason: '계속',
    via: 'test',
});
const installRoom = (room: Room) => store.set(roomsAtom, [room]);
const currentRoom = () => store.get(roomsAtom)[0];

beforeEach(() => {
    vi.useFakeTimers();
    mocks.moderate.mockReset().mockResolvedValue(decision());
    mocks.streamChat.mockReset().mockResolvedValue('첫 줄\n둘째 줄\n셋째 줄');
    mocks.toastError.mockReset();
    store.set(roomsAtom, []);
    store.set(idleNoteAtom, {});
    store.set(pendingAtom, {});
    store.set(runningAtom, {});
});

afterEach(async () => {
    for (const room of store.get(roomsAtom)) stopConversation(room.id);
    await vi.runAllTimersAsync();
    vi.useRealTimers();
});

describe('conversation generation budget', () => {
    it('caps one continuously selected agent at 30 generation calls, counting a multi-bubble burst once', async () => {
        const room = makeRoom();
        installRoom(room);
        startConversation(room.id);
        await vi.runAllTimersAsync();
        expect(mocks.streamChat).toHaveBeenCalledTimes(30);
        expect(mocks.moderate).toHaveBeenCalledTimes(30);
        expect(
            currentRoom().messages.filter((m) => m.sender === 'a')
        ).toHaveLength(90);
        expect(store.get(idleNoteAtom)[room.id]).toContain('한도(30회)');
        expect(isConversationRunning(room.id)).toBe(false);

        startConversation(room.id);
        await vi.runAllTimersAsync();
        expect(mocks.streamChat).toHaveBeenCalledTimes(30);
        startConversation(room.id, { manual: true });
        await vi.runAllTimersAsync();
        expect(mocks.streamChat).toHaveBeenCalledTimes(60);

        appendMessage(room.id, {
            id: 'new-human',
            sender: 'me',
            text: '더 이야기해줘',
        });
        await onUserMessage(room.id);
        await vi.runAllTimersAsync();
        expect(mocks.streamChat).toHaveBeenCalledTimes(90);
    });

    it('resets by human message ID and aborts an in-flight generation before the next 30 calls', async () => {
        const room = makeRoom();
        installRoom(room);
        mocks.streamChat.mockImplementation(
            (_req, { signal }: { signal: AbortSignal }) => {
                if (mocks.streamChat.mock.calls.length === 2) {
                    return new Promise<string>((_resolve, reject) =>
                        signal.addEventListener(
                            'abort',
                            () => reject(new Error('aborted')),
                            { once: true }
                        )
                    );
                }
                return Promise.resolve('ㅇㅇ');
            }
        );
        startConversation(room.id);
        await vi.advanceTimersByTimeAsync(1500);
        expect(mocks.streamChat).toHaveBeenCalledTimes(2);
        expect(store.get(pendingAtom)[room.id]).toBeDefined();

        // Timestamp equality must not conceal a new human request.
        appendMessage(room.id, {
            id: 'human-interruption',
            sender: 'me',
            text: '다음 요청',
            ts: 0,
        });
        await onUserMessage(room.id);
        await vi.runAllTimersAsync();
        expect(mocks.streamChat).toHaveBeenCalledTimes(32);
        expect(
            currentRoom().messages.filter((m) => m.sender === 'a')
        ).toHaveLength(31);
        expect(currentRoom().messages.some((m) => m.error)).toBe(false);
        expect(store.get(pendingAtom)[room.id]).toBeUndefined();
    });
});

describe('moderator decisions', () => {
    it('preserves a consecutive selected speaker even when another member exists', async () => {
        const room = makeRoom({
            agents: [agent('a', '철수'), agent('b', '영희')],
            messages: [
                {
                    id: 'previous',
                    sender: 'a',
                    text: '내가 이어서 설명할게',
                    ts: 0,
                },
            ],
        });
        installRoom(room);
        mocks.moderate
            .mockResolvedValueOnce(decision())
            .mockResolvedValue(decision(0));
        startConversation(room.id);
        await vi.runAllTimersAsync();
        expect(
            currentRoom().messages.filter((m) => m.sender === 'b')
        ).toHaveLength(0);
        expect(mocks.streamChat).toHaveBeenCalledTimes(1);
    });

    it('stops with an idle reason and toast when the moderator fails, without random fallback', async () => {
        const room = makeRoom({
            agents: [agent('a', '철수'), agent('b', '영희')],
        });
        installRoom(room);
        mocks.moderate
            .mockResolvedValueOnce(decision())
            .mockRejectedValue(new Error('진행 연결 오류'));
        startConversation(room.id);
        await vi.runAllTimersAsync();
        expect(mocks.streamChat).toHaveBeenCalledTimes(1);
        expect(store.get(idleNoteAtom)[room.id]).toContain('진행 연결 오류');
        expect(mocks.toastError).toHaveBeenCalledWith(
            expect.stringContaining('진행 연결 오류')
        );
        expect(store.get(runningAtom)[room.id]).toBeUndefined();
        expect(store.get(pendingAtom)[room.id]).toBeUndefined();
        expect(isConversationRunning(room.id)).toBe(false);
    });

    it('leaves all-member eligibility and stop decisions with the moderator and hides member secrets', async () => {
        const room = makeRoom({
            agents: [
                { ...agent('a', '철수'), secret: '오직 철수만 아는 역할' },
                agent('b', '영희'),
            ],
            messages: [
                {
                    id: 'request',
                    sender: 'me',
                    text: '전원 소감을 한 명씩 말해줘',
                    ts: 0,
                },
            ],
        });
        installRoom(room);
        mocks.moderate.mockResolvedValue(decision(0));
        startConversation(room.id);
        await vi.runAllTimersAsync();
        expect(mocks.streamChat).not.toHaveBeenCalled();
        const request = mocks.moderate.mock.calls[0][0];
        expect(request.latestUserRequest).toEqual({
            id: 'request',
            text: '전원 소감을 한 명씩 말해줘',
        });
        expect(request.respondedMembers).toEqual([]);
        expect(JSON.stringify(request)).not.toContain('오직 철수만 아는 역할');
    });
});

describe('introduction visibility in conversation requests', () => {
    it.each<{
        label: string;
        settings: Partial<Room>;
        shared: boolean;
    }>([
        { label: 'legacy chat defaults', settings: {}, shared: true },
        { label: 'chat defaults', settings: { mode: 'chat' }, shared: true },
        { label: 'mafia defaults', settings: { mode: 'mafia' }, shared: false },
        {
            label: 'chat explicit private',
            settings: { mode: 'chat', shareIntroductions: false },
            shared: false,
        },
        {
            label: 'mafia explicit public',
            settings: { mode: 'mafia', shareIntroductions: true },
            shared: true,
        },
    ])(
        'respects $label in both moderator and agent requests',
        async ({ settings, shared }) => {
            const room = makeRoom({
                ...settings,
                agents: [
                    {
                        ...agent('a', '철수'),
                        persona: '차분한 사서. 오래된 책을 모은다.',
                    },
                    {
                        ...agent('b', '영희'),
                        persona: '호기심 많은 탐정. 사건 자료를 모은다.',
                    },
                ],
            });
            installRoom(room);
            mocks.moderate
                .mockResolvedValueOnce(decision())
                .mockResolvedValue(decision(0));
            startConversation(room.id);
            await vi.runAllTimersAsync();

            expect(mocks.moderate).toHaveBeenCalledTimes(2);
            for (const [request] of mocks.moderate.mock.calls) {
                const req = request as ModerateRequest;
                expect(req.members.map((m) => m.name)).toEqual([
                    '철수',
                    '영희',
                ]);
                expect(req.members.map((m) => m.persona)).toEqual(
                    shared ? room.agents.map((a) => a.persona) : ['', '']
                );
            }
            expect(mocks.streamChat).toHaveBeenCalledTimes(1);
            const req = mocks.streamChat.mock.calls[0][0] as ChatRequest;
            expect(req.instructions).toContain(room.agents[0].persona);
            expect(req.instructions).not.toContain('사건 자료를 모은다');
            if (shared) {
                expect(req.instructions).toContain('- 영희: 호기심 많은 탐정.');
            } else {
                expect(req.instructions).toContain('\n- 영희\n');
                expect(req.instructions).not.toContain('호기심 많은 탐정');
            }
        }
    );
});

describe('whisper call routing', () => {
    it('uses actual recipients in auto mode instead of @other names inside the whisper', async () => {
        const room = makeRoom({
            agents: [agent('a', '철수'), agent('b', '영희')],
            messages: [
                {
                    id: 'whisper',
                    sender: 'me',
                    text: '@철수 얘기는 너만 듣고 답해',
                    to: ['b'],
                    ts: 0,
                },
            ],
        });
        installRoom(room);
        mocks.moderate
            .mockResolvedValueOnce(decision())
            .mockResolvedValue(decision(0));
        startConversation(room.id);
        await vi.runAllTimersAsync();
        expect(
            currentRoom().messages.filter((m) => m.sender === 'a')
        ).toHaveLength(0);
        expect(
            currentRoom().messages.filter((m) => m.sender === 'b')
        ).toHaveLength(3);
    });

    it('keeps the existing waiting-mode call queue restricted to actual whisper recipients', async () => {
        const room = makeRoom({
            autoReply: false,
            agents: [agent('a', '철수'), agent('b', '영희')],
            messages: [
                {
                    id: 'whisper',
                    sender: 'me',
                    text: '@철수 얘기는 너만 듣고 답해',
                    to: ['b'],
                    ts: 0,
                },
            ],
        });
        installRoom(room);
        await onUserMessage(room.id);
        await vi.runAllTimersAsync();
        expect(mocks.moderate).not.toHaveBeenCalled();
        expect(mocks.streamChat).toHaveBeenCalledTimes(1);
        expect(
            currentRoom().messages.filter((m) => m.sender === 'a')
        ).toHaveLength(0);
        expect(
            currentRoom().messages.filter((m) => m.sender === 'b')
        ).toHaveLength(3);
    });
});
