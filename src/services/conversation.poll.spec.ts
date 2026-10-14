import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatRequest } from '@shared/providers';
import type { Agent, Room } from '@/types/chat';
import {
    idleNoteAtom,
    pendingAtom,
    roomsAtom,
    runningAtom,
    store,
} from '@stores/chat';
import { pendingVoters, startPoll, stopConversation } from './conversation';

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
const makeRoom = (): Room => ({
    id: 'poll',
    name: '방',
    topic: '',
    profileId: null,
    agents: [agent('a', '철수'), agent('b', '영희')],
    messages: [
        {
            id: 'p1',
            sender: 'me',
            text: '점심 뭐 먹지',
            ts: 0,
            poll: {
                question: '점심 뭐 먹지',
                options: ['짜장', '짬뽕'],
                votes: [],
            },
        },
    ],
    updatedAt: 0,
});
const replyBy = (replies: Record<string, string>) => (req: ChatRequest) => {
    const name = req.instructions.match(/에 있는 "(.+?)"이다/)?.[1] ?? '';
    return Promise.resolve(replies[name] ?? '');
};
const room = () => store.get(roomsAtom)[0];
const poll = () => room().messages.find((m) => m.id === 'p1')!.poll!;

beforeEach(() => {
    vi.useFakeTimers();
    mocks.moderate.mockReset();
    mocks.streamChat.mockReset();
    store.set(idleNoteAtom, {});
    store.set(pendingAtom, {});
    store.set(runningAtom, {});
    store.set(roomsAtom, [makeRoom()]);
});

afterEach(async () => {
    for (const r of store.get(roomsAtom)) stopConversation(r.id);
    await vi.runAllTimersAsync();
    vi.useRealTimers();
});

describe('polls', () => {
    it('lets every agent vote once without the moderator, keeping the tag out of the chat', async () => {
        mocks.streamChat.mockImplementation(
            replyBy({ 철수: '[투표:2]\n짬뽕이지 ㅋㅋ', 영희: '[투표: 1번]' })
        );
        await startPoll('poll', 'p1');
        await vi.runAllTimersAsync();

        expect(mocks.moderate).not.toHaveBeenCalled();
        expect(poll().votes).toEqual([
            { voter: 'a', name: '철수', choice: 1 },
            { voter: 'b', name: '영희', choice: 0 },
        ]);
        expect(
            room()
                .messages.filter((m) => m.sender !== 'me')
                .map((m) => `${m.senderName}:${m.text}`)
        ).toEqual(['철수:짬뽕이지 ㅋㅋ']);
        expect(store.get(idleNoteAtom).poll).toContain('투표가 끝났어요');
    });

    it('hides earlier votes from agents who have not voted yet', async () => {
        mocks.streamChat.mockImplementation(
            replyBy({ 철수: '[투표:2]', 영희: '[투표:1]' })
        );
        await startPoll('poll', 'p1');
        await vi.runAllTimersAsync();

        const second = mocks.streamChat.mock.calls[1][0] as ChatRequest;
        const content = second.messages[0].content as string;
        expect(content).toContain('결과는 투표하면 보임');
        expect(content).not.toContain('짬뽕 — 철수');
        expect(content).toContain('[투표:번호]');
        expect(content).toContain('1. 짜장\n2. 짬뽕');
    });

    it('reports a missing vote and asks only the remaining agents next time', async () => {
        mocks.streamChat.mockImplementation(
            replyBy({ 철수: '음 모르겠다', 영희: '[투표:9]\n[투표:1]' })
        );
        await startPoll('poll', 'p1');
        await vi.runAllTimersAsync();

        expect(poll().votes).toEqual([{ voter: 'b', name: '영희', choice: 0 }]);
        expect(room().messages.some((m) => m.error)).toBe(true);
        expect(pendingVoters(room(), 'p1')).toEqual(['a']);

        mocks.streamChat.mockClear();
        mocks.streamChat.mockResolvedValue('[투표:1]');
        await startPoll('poll', 'p1');
        await vi.runAllTimersAsync();
        expect(mocks.streamChat).toHaveBeenCalledTimes(1);
        expect(pendingVoters(room(), 'p1')).toEqual([]);
    });
});
