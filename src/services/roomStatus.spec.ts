import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProfilesResponse, PublicProfile } from '@shared/providers';
import type {
    RoomStatusRequest,
    RoomStatusResponse,
    RoomStatusSummary,
} from '@shared/room-status';
import type { Room } from '@/types/chat';
import {
    appendMessage,
    currentRoomIdAtom,
    ownerStatusesAtom,
    roomStatusRuntimeAtom,
    roomStatusSettingsAtom,
    roomsAtom,
    runningAtom,
    store,
    userNameAtom,
} from '@stores/chat';
import { buildPrompt, moderatorTranscript } from '@utils/prompt/prompt';
import { queryClient } from './api';
import {
    retryRoomStatus,
    roomStatusBatch,
    roomStatusTranscript,
    startRoomStatusObserver,
} from './roomStatus';

const mocks = vi.hoisted(() => ({ summarize: vi.fn() }));
vi.mock('./api', async (original) => ({
    ...(await original<typeof import('./api')>()),
    summarizeRoomStatus: mocks.summarize,
}));
const profile: PublicProfile = {
    id: 'p',
    name: 'OpenAI',
    provider: 'openai',
    baseURL: '',
    defaultModel: 'test',
    defaultReasoning: 'none',
    hasKey: true,
    keyHint: 'test',
    createdAt: 1,
    updatedAt: 1,
};
const profiles: ProfilesResponse = {
    defaultProfileId: 'p',
    profiles: [profile],
};
const room = (id = 'r', count = 1): Room => ({
    id,
    name: '관찰 방',
    topic: '역할 게임',
    profileId: null,
    updatedAt: 0,
    agents: [
        {
            id: 'a',
            name: '철수',
            emoji: '🙂',
            color: '#fff',
            persona: '',
            secret: '철수 비밀',
            profileId: null,
            model: '',
        },
        {
            id: 'b',
            name: '영희',
            emoji: '🙂',
            color: '#fff',
            persona: '',
            secret: '영희 비밀',
            profileId: null,
            model: '',
        },
    ],
    messages: Array.from({ length: count }, (_, i) => ({
        id: `${id}-${i}`,
        sender: i ? 'a' : 'me',
        text: `${i}번`,
        ts: i,
    })),
});
const summary = (): RoomStatusSummary => ({
    markdown: '## 지금 상황\n- 인간 전용 현황',
});
const success = (_req?: RoomStatusRequest): RoomStatusResponse => ({
    ok: true,
    status: summary(),
    via: 'mock · test',
});
let dispose: (() => void) | undefined;
const start = () => {
    dispose = startRoomStatusObserver();
};
const tick = (ms = 800) => vi.advanceTimersByTimeAsync(ms);
const select = (r: Room) => {
    store.set(roomsAtom, [r]);
    store.set(currentRoomIdAtom, r.id);
};
const deferred = () => {
    let resolve!: (value: RoomStatusResponse) => void;
    const promise = new Promise<RoomStatusResponse>((res) => {
        resolve = res;
    });
    return { resolve, promise };
};

beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    dispose = undefined;
    queryClient.clear();
    queryClient.setQueryData(['profiles'], profiles);
    store.set(roomsAtom, []);
    store.set(currentRoomIdAtom, null);
    store.set(userNameAtom, '나');
    store.set(ownerStatusesAtom, {});
    store.set(roomStatusRuntimeAtom, {});
    store.set(runningAtom, {});
    store.set(roomStatusSettingsAtom, {
        profileId: null,
        model: '',
        reasoning: null,
    });
    mocks.summarize
        .mockReset()
        .mockImplementation((req: RoomStatusRequest) =>
            Promise.resolve(success(req))
        );
});
afterEach(() => {
    dispose?.();
    queryClient.clear();
    vi.useRealTimers();
});

describe('roomStatus observer', () => {
    it('debounces a stopped room, sends secrets/whispers only to the observer, and never posts its summary', async () => {
        const r = room();
        r.messages.push({
            id: 'whisper',
            sender: 'a',
            text: '몰래 의논',
            ts: 1,
            to: ['me'],
        });
        select(r);
        start();
        await tick(799);
        expect(mocks.summarize).not.toHaveBeenCalled();
        await tick(1);
        const req = mocks.summarize.mock.calls[0][0];
        expect(req.members.map((m: { secret: string }) => m.secret)).toEqual([
            '철수 비밀',
            '영희 비밀',
        ]);
        expect(req.transcript[1].to).toEqual(['me']);
        expect(store.get(ownerStatusesAtom).r.summary.markdown).toContain(
            '인간 전용 현황'
        );
        expect(store.get(roomsAtom)[0].messages).toEqual(r.messages);
        const prompt = buildPrompt(r, r.agents[0], {
            userName: '나',
            now: '',
            location: '',
            note: '',
        });
        expect(prompt.instructions).toContain('철수 비밀');
        expect(prompt.instructions).not.toContain('영희 비밀');
        expect(JSON.stringify(prompt)).not.toContain('인간 전용 현황');
        expect(JSON.stringify(moderatorTranscript(r, '나'))).not.toContain(
            '인간 전용 현황'
        );
        await tick(60_000);
        expect(mocks.summarize).toHaveBeenCalledTimes(1);
        store.set(runningAtom, { r: { turns: 1, status: '실시간 상태' } });
        appendMessage('r', { sender: 'system', error: true, text: '오류' });
        await tick(60_000);
        expect(mocks.summarize).toHaveBeenCalledTimes(1);
    });

    it('passes the program’s progress notices as facts but never error notices', () => {
        const r = room();
        r.messages.push(
            {
                id: 's1',
                sender: 'system',
                text: '⚖️ 영희님이 처형됐어요.',
                notice: true,
                ts: 2,
            },
            {
                id: 's2',
                sender: 'system',
                text: '🎭 역할: 철수 마피아',
                notice: true,
                to: ['gm'],
                ts: 3,
            },
            { id: 's3', sender: 'system', text: '⚠️ 오류', error: true, ts: 4 }
        );
        const transcript = roomStatusTranscript(r);
        expect(transcript.filter((m) => m.sender === 'system')).toEqual([
            {
                id: 's1',
                sender: 'system',
                senderName: '진행',
                text: '⚖️ 영희님이 처형됐어요.',
            },
            {
                id: 's2',
                sender: 'system',
                senderName: '진행',
                text: '🎭 역할: 철수 마피아',
                to: ['gm'],
            },
        ]);
    });

    it('batches committed bubbles and updates incrementally no more often than every five seconds', async () => {
        select(room('r', 2));
        start();
        await tick();
        appendMessage('r', { sender: 'a', text: '셋째' });
        appendMessage('r', { sender: 'a', text: '넷째' });
        await tick(4_999);
        expect(mocks.summarize).toHaveBeenCalledTimes(1);
        await tick(1);
        expect(mocks.summarize).toHaveBeenCalledTimes(2);
        expect(mocks.summarize.mock.calls[1][0].transcript).toHaveLength(2);
        expect(mocks.summarize.mock.calls[1][0].previous).toEqual(summary());
        expect(store.get(ownerStatusesAtom).r.messageIds).toHaveLength(4);
    });

    it('processes all 69 messages as bounded batches instead of discarding old history', async () => {
        select(room('r', 69));
        start();
        await tick();
        expect(mocks.summarize.mock.calls[0][0].transcript).toHaveLength(50);
        await tick(5_000);
        expect(mocks.summarize.mock.calls[1][0].transcript).toHaveLength(19);
        expect(store.get(ownerStatusesAtom).r.messageIds).toHaveLength(69);
        expect(store.get(roomStatusRuntimeAtom).r.loading).toBe(false);
    });

    it('keeps exactly one in-flight request and catches up after new messages arrive', async () => {
        const wait = deferred();
        mocks.summarize.mockImplementationOnce(() => wait.promise);
        select(room());
        start();
        await tick();
        appendMessage('r', { sender: 'b', text: '대기 중 새 내용' });
        await tick(6_000);
        expect(mocks.summarize).toHaveBeenCalledTimes(1);
        wait.resolve(success(mocks.summarize.mock.calls[0][0]));
        await tick(800);
        expect(mocks.summarize).toHaveBeenCalledTimes(2);
        expect(mocks.summarize.mock.calls[1][0].transcript[0].text).toBe(
            '대기 중 새 내용'
        );
    });

    it('retains a cache while profiles load and reuses it on reload without another call', async () => {
        select(room());
        start();
        await tick();
        const cache = store.get(ownerStatusesAtom).r;
        dispose?.();
        queryClient.removeQueries({ queryKey: ['profiles'] });
        start();
        expect(store.get(ownerStatusesAtom).r).toEqual(cache);
        queryClient.setQueryData(['profiles'], profiles);
        await tick(10_000);
        expect(mocks.summarize).toHaveBeenCalledTimes(1);
        expect(store.get(ownerStatusesAtom).r).toEqual(cache);
    });

    it('invalidates local settings and edited history while profile metadata is offline', async () => {
        select(room());
        start();
        await tick();
        dispose?.();
        queryClient.removeQueries({ queryKey: ['profiles'] });
        start();
        expect(store.get(ownerStatusesAtom).r).toBeDefined();
        store.set(roomsAtom, [
            {
                ...room(),
                agents: [
                    { ...room().agents[0], secret: '새 비밀' },
                    room().agents[1],
                ],
            },
        ]);
        expect(store.get(ownerStatusesAtom).r).toBeUndefined();
        await tick(10_000);
        expect(mocks.summarize).toHaveBeenCalledTimes(1);
        queryClient.setQueryData(['profiles'], profiles);
        await tick();
        expect(store.get(ownerStatusesAtom).r).toBeDefined();
        dispose?.();
        queryClient.removeQueries({ queryKey: ['profiles'] });
        start();
        store.set(roomsAtom, [
            {
                ...store.get(roomsAtom)[0],
                messages: [{ ...room().messages[0], text: '오프라인 수정' }],
            },
        ]);
        expect(store.get(ownerStatusesAtom).r).toBeUndefined();
    });

    it('invalidates settings and excludes old summaries from a rebuild', async () => {
        select(room());
        start();
        await tick();
        store.set(roomStatusSettingsAtom, {
            profileId: null,
            model: 'new-model',
            reasoning: null,
        });
        expect(store.get(ownerStatusesAtom).r).toBeUndefined();
        await tick(5_000);
        expect(mocks.summarize.mock.calls[1][0].previous).toBeNull();
        expect(mocks.summarize.mock.calls[1][0].model).toBe('new-model');
    });

    it('aborts and discards responses after clearing/deleting a room', async () => {
        const wait = deferred();
        mocks.summarize.mockImplementationOnce(() => wait.promise);
        select(room());
        start();
        await tick();
        const signal = mocks.summarize.mock.calls[0][1];
        store.set(roomsAtom, [{ ...room(), messages: [] }]);
        expect(signal.aborted).toBe(true);
        wait.resolve(success(mocks.summarize.mock.calls[0][0]));
        await tick(10_000);
        expect(store.get(ownerStatusesAtom).r).toBeUndefined();
        store.set(roomsAtom, []);
        await tick();
        expect(mocks.summarize).toHaveBeenCalledTimes(1);
    });

    it('ignores an old response after switching rooms even when the API ignores abort', async () => {
        const wait = deferred();
        mocks.summarize.mockImplementationOnce(() => wait.promise);
        const a = room('r'),
            b = room('other');
        store.set(roomsAtom, [a, b]);
        store.set(currentRoomIdAtom, a.id);
        start();
        await tick();
        store.set(currentRoomIdAtom, b.id);
        await tick();
        expect(store.get(ownerStatusesAtom).other).toBeDefined();
        wait.resolve(success(mocks.summarize.mock.calls[0][0]));
        await tick();
        expect(store.get(ownerStatusesAtom).r).toBeUndefined();
        store.set(currentRoomIdAtom, a.id);
        await tick(5_000);
        expect(store.get(ownerStatusesAtom).r).toBeDefined();
    });

    it('retains the last success on error, stops automatic retries, and allows explicit retry', async () => {
        select(room());
        start();
        await tick();
        const cache = store.get(ownerStatusesAtom).r;
        mocks.summarize.mockResolvedValueOnce({ ok: false, error: '실패' });
        appendMessage('r', { sender: 'a', text: '새 내용' });
        await tick(5_000);
        expect(store.get(ownerStatusesAtom).r).toEqual(cache);
        expect(store.get(roomStatusRuntimeAtom).r.error).toBe('실패');
        await tick(60_000);
        expect(mocks.summarize).toHaveBeenCalledTimes(2);
        retryRoomStatus('r');
        await tick();
        expect(mocks.summarize).toHaveBeenCalledTimes(3);
        expect(store.get(roomStatusRuntimeAtom).r.error).toBeUndefined();
    });

    it('rebuilds after editing an existing message without relying on updatedAt', async () => {
        select(room());
        start();
        await tick();
        store.set(roomsAtom, [
            {
                ...room(),
                messages: [{ ...room().messages[0], text: '수정한 내용' }],
            },
        ]);
        expect(store.get(ownerStatusesAtom).r).toBeUndefined();
        await tick(5_000);
        expect(mocks.summarize.mock.calls[1][0].previous).toBeNull();
    });

    it('does not send private data to unapproved providers or custom API destinations', async () => {
        queryClient.setQueryData(['profiles'], {
            ...profiles,
            profiles: [{ ...profile, baseURL: 'https://custom.example/v1' }],
        });
        select(room());
        start();
        await tick(60_000);
        expect(mocks.summarize).not.toHaveBeenCalled();
        expect(store.get(roomStatusRuntimeAtom).r.error).toContain(
            '승인된 OpenAI'
        );
        queryClient.setQueryData(['profiles'], {
            ...profiles,
            profiles: [{ ...profile, provider: 'anthropic' }],
        });
        await tick(60_000);
        expect(mocks.summarize).not.toHaveBeenCalled();
    });
});

describe('retained evidence and deletion cleanup', () => {
    it('passes the previous memo forward and discards legacy structured caches', async () => {
        const r = room();
        store.set(ownerStatusesAtom, {
            r: {
                // 이전 버전의 칸 나눔 형식 캐시
                summary: { overview: [] } as never,
                via: 'old',
                updatedAt: 0,
                inputKey: 'old',
                messageIds: ['r-0'],
                messageSignature: 'old',
            },
        });
        select(r);
        start();
        await tick();
        expect(mocks.summarize.mock.calls[0][0].previous).toBeNull();
        appendMessage('r', { sender: 'b', text: '후속 발언' });
        await tick(5_000);
        expect(mocks.summarize.mock.calls[1][0].previous).toEqual(summary());
    });
    it('removes runtime-only entries when an uncached room is deleted during its first request', async () => {
        const wait = deferred();
        mocks.summarize.mockImplementationOnce(() => wait.promise);
        select(room());
        start();
        await tick();
        store.set(roomsAtom, []);
        expect(store.get(roomStatusRuntimeAtom).r).toBeUndefined();
        wait.resolve(success(mocks.summarize.mock.calls[0][0]));
        await tick();
        expect(store.get(roomStatusRuntimeAtom).r).toBeUndefined();
    });
});

describe('summary input bounds', () => {
    it('splits oversized messages losslessly and applies both text and message limits', () => {
        const r = room();
        r.messages[0].text = '가'.repeat(80_001);
        const logs = roomStatusTranscript(r);
        expect(logs.map((m) => m.text).join('')).toBe(r.messages[0].text);
        expect(logs.map((m) => m.id)).toEqual([
            'r-0:part:1',
            'r-0:part:2',
            'r-0:part:3',
        ]);
        expect(roomStatusBatch(logs, 0)).toHaveLength(1);
        expect(
            roomStatusBatch(roomStatusTranscript(room('r', 69)), 0)
        ).toHaveLength(50);
    });
});
