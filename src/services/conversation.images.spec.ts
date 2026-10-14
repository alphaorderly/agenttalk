import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModerateResponse } from '@shared/providers';
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
    createAgentImage: vi.fn(),
    changeExpression: vi.fn(),
    setMessageFace: vi.fn(),
    canDraw: true,
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
vi.mock('./images', async () => ({
    ...(await vi.importActual<typeof import('@utils/face/face')>(
        '@utils/face/face'
    )),
    canAgentDraw: (agent: Agent) => mocks.canDraw && !!agent.imageGen?.enabled,
    createAgentImage: mocks.createAgentImage,
    changeExpression: mocks.changeExpression,
    setMessageFace: mocks.setMessageFace,
}));

const agent: Agent = {
    id: 'a',
    name: '철수',
    emoji: '🙂',
    color: '#fff',
    persona: '',
    profileId: null,
    model: '',
    imageGen: { enabled: true, quality: 'medium' },
    portrait: 'base',
    faces: { 기본: 'base' },
    expression: '기본',
};
const makeRoom = (overrides: Partial<Room> = {}): Room => ({
    id: 'img-room',
    name: '방',
    topic: '',
    profileId: null,
    agents: [agent],
    messages: [{ id: 'h', sender: 'me', text: '보여줘', ts: 0 }],
    updatedAt: 0,
    expressions: {
        enabled: true,
        quality: 'low',
        size: '1024x1024',
        style: '',
    },
    ...overrides,
});
const decision = (speaker: number): ModerateResponse => ({
    ok: true,
    candidates: speaker ? [{ speaker, note: '' }] : [],
    waitMs: 0,
    reason: '',
    via: 'test',
});
const agentMessages = () =>
    store.get(roomsAtom)[0].messages.filter((m) => m.sender === 'a');

beforeEach(() => {
    vi.useFakeTimers();
    mocks.canDraw = true;
    mocks.moderate
        .mockReset()
        .mockResolvedValueOnce(decision(1))
        .mockResolvedValue(decision(0));
    mocks.streamChat
        .mockReset()
        .mockResolvedValue(
            '[표정:신남]\n이거 봐 ㅋㅋ\n[이미지: 노을 지는 한강 사진]\n[이미지: 두번째 사진]'
        );
    mocks.createAgentImage.mockReset().mockResolvedValue('photo-1');
    mocks.changeExpression
        .mockReset()
        .mockReturnValue(Promise.resolve('excited'));
    mocks.setMessageFace.mockReset();
    store.set(idleNoteAtom, {});
    store.set(pendingAtom, {});
    store.set(runningAtom, {});
});

afterEach(async () => {
    for (const room of store.get(roomsAtom)) stopConversation(room.id);
    await vi.runAllTimersAsync();
    vi.useRealTimers();
});

describe('agent photos and expressions', () => {
    it('sends one photo per turn, hides the expression tag and updates the bubbles to the new face', async () => {
        store.set(roomsAtom, [makeRoom()]);
        startConversation('img-room');
        await vi.runAllTimersAsync();

        const request = mocks.streamChat.mock.calls[0][0];
        expect(request.instructions).toContain('[이미지:');
        expect(request.instructions).toContain('[표정:');
        expect(request.messages[0].content).toContain('지금 네 표정: 기본');
        expect(mocks.changeExpression).toHaveBeenCalledWith(
            'img-room',
            'a',
            '신남'
        );
        expect(mocks.createAgentImage).toHaveBeenCalledTimes(1);
        expect(mocks.createAgentImage.mock.calls[0].slice(0, 2)).toEqual([
            '노을 지는 한강 사진',
            'medium',
        ]);

        const sent = agentMessages();
        expect(sent.map((m) => m.text)).toEqual(['이거 봐 ㅋㅋ', '']);
        expect(sent[1].image).toEqual({
            id: 'photo-1',
            prompt: '노을 지는 한강 사진',
        });
        expect(sent.every((m) => m.face === 'base')).toBe(true);
        expect(JSON.stringify(sent)).not.toContain('표정');
        expect(mocks.setMessageFace).toHaveBeenCalledWith(
            'img-room',
            sent.map((m) => m.id),
            'excited'
        );
    });

    it('drops photo lines when the agent may not draw and omits face tags when the feature is off', async () => {
        mocks.canDraw = false;
        store.set(roomsAtom, [
            makeRoom({
                expressions: {
                    enabled: false,
                    quality: 'low',
                    size: 'auto',
                    style: '',
                },
            }),
        ]);
        startConversation('img-room');
        await vi.runAllTimersAsync();

        const request = mocks.streamChat.mock.calls[0][0];
        expect(request.instructions).not.toContain('[이미지:');
        expect(request.instructions).not.toContain('[표정:');
        expect(mocks.createAgentImage).not.toHaveBeenCalled();
        expect(agentMessages().map((m) => m.text)).toEqual(['이거 봐 ㅋㅋ']);
        expect(agentMessages()[0].face).toBeUndefined();
    });

    it('caps photos at two per run', async () => {
        mocks.moderate.mockReset().mockResolvedValue(decision(1));
        mocks.streamChat.mockReset().mockResolvedValue('[이미지: 사진]');
        mocks.changeExpression.mockReset().mockReturnValue(null);
        store.set(roomsAtom, [makeRoom()]);
        startConversation('img-room');
        await vi.advanceTimersByTimeAsync(60_000);
        stopConversation('img-room');
        await vi.runAllTimersAsync();
        expect(mocks.createAgentImage).toHaveBeenCalledTimes(2);
        expect(
            mocks.streamChat.mock.calls
                .slice(2)
                .every(([req]) => !req.instructions.includes('[이미지:'))
        ).toBe(true);
    });
});
