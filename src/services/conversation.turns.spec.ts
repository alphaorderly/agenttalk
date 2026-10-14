import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatRequest, ModerateResponse } from '@shared/providers';
import type { Agent, Room } from '@/types/chat';
import {
    idleNoteAtom,
    pendingAtom,
    roomsAtom,
    runningAtom,
    store,
} from '@stores/chat';
import { startConversation, stopConversation } from './conversation';

const mocks = vi.hoisted(() => ({
    moderate: vi.fn(),
    streamChat: vi.fn(),
}));

vi.mock('react-hot-toast', () => ({ default: { error: vi.fn() } }));
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
const makeRoom = (messages: Room['messages'] = []): Room => ({
    id: 'turns',
    name: '방',
    topic: '',
    profileId: null,
    agents: [agent('a', '철수'), agent('b', '영희')],
    messages: [{ id: 'h', sender: 'me', text: '안녕', ts: 0 }, ...messages],
    updatedAt: 0,
});
const decide = (...candidates: [number, string?][]): ModerateResponse => ({
    ok: true,
    candidates: candidates.map(([speaker, note = '']) => ({ speaker, note })),
    waitMs: 0,
    reason: '',
    via: 'test',
});
/** 프롬프트로 누가 말하는지 알아내 이름별 답을 돌려준다 */
const replyBy = (replies: Record<string, string>) => (req: ChatRequest) => {
    const name = req.instructions.match(/에 있는 "(.+?)"이다/)?.[1] ?? '';
    return Promise.resolve(replies[name] ?? '');
};
const spoken = () =>
    store
        .get(roomsAtom)[0]
        .messages.filter((m) => m.sender !== 'me')
        .map((m) => `${m.senderName}:${m.text}`);
const run = async (room: Room) => {
    store.set(roomsAtom, [room]);
    startConversation(room.id);
    await vi.runAllTimersAsync();
};

beforeEach(() => {
    vi.useFakeTimers();
    mocks.moderate.mockReset();
    mocks.streamChat.mockReset();
    store.set(idleNoteAtom, {});
    store.set(pendingAtom, {});
    store.set(runningAtom, {});
});

afterEach(async () => {
    for (const room of store.get(roomsAtom)) stopConversation(room.id);
    await vi.runAllTimersAsync();
    vi.useRealTimers();
});

describe('moderator hands over the turn, agents decide', () => {
    it('lets the next candidate speak when the first passes, and passes the note as information', async () => {
        mocks.moderate
            .mockResolvedValueOnce(decide([1, '방장이 인사함'], [2]))
            .mockResolvedValue(decide());
        mocks.streamChat.mockImplementation(
            replyBy({ 철수: '[패스]', 영희: '안녕하세요!' })
        );
        await run(makeRoom());

        expect(spoken()).toEqual(['영희:안녕하세요!']);
        const first = mocks.streamChat.mock.calls[0][0] as ChatRequest;
        expect(first.messages[0].content).toContain(
            '참고할 상황: 방장이 인사함'
        );
        expect(first.messages[0].content).toContain('[패스]');
        expect(first).not.toHaveProperty('mode');
    });

    it('stops quietly after two passes in a row', async () => {
        mocks.moderate.mockResolvedValue(decide([1], [2]));
        mocks.streamChat.mockResolvedValue('패스');
        await run(makeRoom());

        expect(spoken()).toEqual([]);
        expect(mocks.streamChat).toHaveBeenCalledTimes(2);
        expect(store.get(idleNoteAtom).turns).toBe(
            '다들 지금은 더 할 말이 없대요'
        );
    });

    it('puts the person the user called first and does not let them pass', async () => {
        mocks.moderate
            .mockResolvedValueOnce(decide([1, '메모']))
            .mockResolvedValue(decide());
        mocks.streamChat.mockImplementation(
            replyBy({ 철수: '나도 몰라', 영희: '응 나 불렀어?' })
        );
        const room = makeRoom();
        room.messages = [{ id: 'h', sender: 'me', text: '@영희 뭐해?', ts: 0 }];
        await run(room);

        expect(spoken()[0]).toBe('영희:응 나 불렀어?');
        const first = mocks.streamChat.mock.calls[0][0] as ChatRequest;
        expect(first.instructions).toContain('"영희"');
        expect(first.messages[0].content).not.toContain('[패스]');
    });

    it('stops on an empty candidate list with the moderator reason', async () => {
        mocks.moderate.mockResolvedValue({ ...decide(), reason: '결론 남' });
        await run(makeRoom());
        expect(mocks.streamChat).not.toHaveBeenCalled();
        expect(store.get(idleNoteAtom).turns).toBe('결론 남');
    });

    it('gives search-capable agents the search tool without a moderator order', async () => {
        mocks.moderate
            .mockResolvedValueOnce(decide([1]))
            .mockResolvedValue(decide());
        mocks.streamChat.mockResolvedValue('ㅇㅇ');
        await run(makeRoom());
        const req = mocks.streamChat.mock.calls[0][0] as ChatRequest;
        expect(req.search).toMatchObject({ city: expect.any(String) });
        expect(req.instructions).toContain('웹 검색 도구를 쓴다');
    });
});

describe('moderator notes never carry whispers to outsiders', () => {
    const whisperRoom = (): Room => ({
        ...makeRoom([
            {
                id: 'w',
                sender: 'a',
                senderName: '철수',
                to: ['b'],
                text: '나 사실 마피아야',
                ts: 0,
            },
        ]),
        agents: [agent('a', '철수'), agent('b', '영희'), agent('c', '민수')],
    });
    const contentFor = (name: string) =>
        mocks.streamChat.mock.calls
            .map(([req]) => req as ChatRequest)
            .filter((req) => req.instructions.includes(`"${name}"이다`))
            .map((req) => req.messages[0].content as string)
            .join('\n');

    it('drops a leaking note for a non-party but keeps it for the recipient', async () => {
        mocks.moderate
            .mockResolvedValueOnce(decide([3, '철수가 영희에게 마피아라고 함']))
            .mockResolvedValueOnce(decide([2, '철수가 너에게 비밀을 말함']))
            .mockResolvedValue(decide());
        mocks.streamChat.mockImplementation(
            replyBy({ 민수: '배고프다', 영희: '@@철수 헐' })
        );
        await run(whisperRoom());

        const outsider = contentFor('민수');
        expect(outsider).not.toContain('마피아');
        expect(outsider).not.toContain('진행자 메모');
        expect(contentFor('영희')).toContain(
            '참고할 상황: 철수가 너에게 비밀을 말함'
        );
    });
});
