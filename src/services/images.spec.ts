import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProfilesResponse, PublicProfile } from '@shared/providers';
import type { Agent, Room } from '@/types/chat';
import {
    faceJobsAtom,
    imageSettingsAtom,
    roomsAtom,
    store,
} from '@stores/chat';
import {
    changeExpression,
    ensurePortraits,
    imageTarget,
    resolveImageProfile,
    setMessageFace,
} from './images';

const mocks = vi.hoisted(() => ({
    requestImage: vi.fn(),
    toastError: vi.fn(),
    profiles: undefined as ProfilesResponse | undefined,
}));
vi.mock('react-hot-toast', () => ({ default: { error: mocks.toastError } }));
vi.mock('./api', () => ({
    requestImage: mocks.requestImage,
    apiErrorMessage: async (err: unknown) => String(err),
    queryClient: { getQueryData: () => mocks.profiles },
}));

const profile = (overrides: Partial<PublicProfile>): PublicProfile => ({
    id: 'p',
    name: 'OpenAI',
    provider: 'openai',
    baseURL: '',
    defaultModel: 'gpt',
    defaultReasoning: 'provider-default',
    hasKey: true,
    keyHint: '••••1234',
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
});
const agent = (overrides: Partial<Agent> = {}): Agent => ({
    id: 'a',
    name: '철수',
    emoji: '🙂',
    color: '#ffd6a5',
    persona: '낙천적인 개발자',
    secret: '사실 마피아',
    profileId: null,
    model: '',
    ...overrides,
});
const room = (agents: Agent[], enabled = true): Room => ({
    id: 'r',
    name: '방',
    topic: '',
    profileId: null,
    agents,
    messages: [],
    updatedAt: 0,
    expressions: {
        enabled,
        quality: 'low',
        size: '1024x1024',
        style: '',
    },
});
const current = () => store.get(roomsAtom)[0].agents[0];
let counter = 0;

beforeEach(() => {
    counter = 0;
    mocks.toastError.mockReset();
    mocks.requestImage.mockReset().mockImplementation(async () => ({
        ok: true,
        id: `img-${++counter}`,
        via: 'test',
    }));
    mocks.profiles = { defaultProfileId: 'p', profiles: [profile({})] };
    store.set(imageSettingsAtom, { profileId: null, model: '' });
    store.set(faceJobsAtom, {});
});

describe('resolveImageProfile', () => {
    it('prefers an explicit OpenAI profile, then the default, then the first OpenAI key', () => {
        const data: ProfilesResponse = {
            defaultProfileId: 'claude',
            profiles: [
                profile({ id: 'claude', provider: 'anthropic' }),
                profile({ id: 'nokey', hasKey: false }),
                profile({ id: 'o1' }),
                profile({ id: 'o2' }),
            ],
        };
        expect(
            resolveImageProfile({ profileId: null, model: '' }, data)?.id
        ).toBe('o1');
        expect(
            resolveImageProfile({ profileId: 'o2', model: '' }, data)?.id
        ).toBe('o2');
        expect(
            resolveImageProfile({ profileId: 'claude', model: '' }, data)
        ).toBeUndefined();
        expect(
            resolveImageProfile({ profileId: 'nokey', model: '' }, data)
        ).toBeUndefined();
    });

    it('falls back to the default image model', () => {
        expect(imageTarget()).toEqual({
            profileId: 'p',
            model: 'gpt-image-2',
        });
        mocks.profiles = undefined;
        expect(imageTarget()).toBeNull();
    });
});

describe('ensurePortraits', () => {
    it('creates a portrait from public settings only and replaces the icon', async () => {
        store.set(roomsAtom, [room([agent()])]);
        await ensurePortraits('r');
        const req = mocks.requestImage.mock.calls[0][0];
        expect(req).toMatchObject({
            profileId: 'p',
            quality: 'low',
            size: '1024x1024',
        });
        expect(req.reference).toBeUndefined();
        expect(req.prompt).toContain('낙천적인 개발자');
        expect(req.prompt).not.toContain('마피아');
        expect(current()).toMatchObject({
            portrait: 'img-1',
            faces: { 기본: 'img-1' },
            expression: '기본',
        });
        // 이미 얼굴이 있으면 다시 만들지 않는다
        await ensurePortraits('r');
        expect(mocks.requestImage).toHaveBeenCalledTimes(1);
    });

    it('does nothing when the feature is off and asks for a key when none is set', async () => {
        store.set(roomsAtom, [room([agent()], false)]);
        await ensurePortraits('r');
        expect(mocks.requestImage).not.toHaveBeenCalled();
        store.set(roomsAtom, [room([agent()])]);
        mocks.profiles = { defaultProfileId: null, profiles: [] };
        await ensurePortraits('r');
        expect(mocks.requestImage).not.toHaveBeenCalled();
        expect(mocks.toastError).toHaveBeenCalledWith(
            expect.stringContaining('OpenAI API 키')
        );
    });
});

describe('changeExpression', () => {
    const withFace = (overrides: Partial<Agent> = {}) =>
        agent({
            portrait: 'base',
            faces: { 기본: 'base', 웃음: 'laugh' },
            expression: '기본',
            ...overrides,
        });

    it('switches immediately to an expression that was already made', () => {
        store.set(roomsAtom, [room([withFace()])]);
        expect(changeExpression('r', 'a', '웃음')).toBeNull();
        expect(current().expression).toBe('웃음');
        expect(changeExpression('r', 'a', '기본')).toBeNull();
        expect(current().expression).toBe('기본');
        expect(mocks.requestImage).not.toHaveBeenCalled();
    });

    it('edits the base portrait for a new expression and keeps it for reuse', async () => {
        store.set(roomsAtom, [room([withFace()])]);
        const job = changeExpression('r', 'a', '화남');
        expect(current().expression).toBe('기본');
        expect(await job).toBe('img-1');
        const req = mocks.requestImage.mock.calls[0][0];
        expect(req.reference).toBe('base');
        expect(req.prompt).toContain('angry');
        expect(current().faces).toMatchObject({ 화남: 'img-1' });
        expect(current().expression).toBe('화남');
        expect(store.get(faceJobsAtom)).toEqual({});
    });

    it('ignores unknown labels, disabled rooms and results for a replaced portrait', async () => {
        store.set(roomsAtom, [room([withFace()])]);
        expect(changeExpression('r', 'a', '행복함')).toBeNull();
        store.set(roomsAtom, [room([withFace()], false)]);
        expect(changeExpression('r', 'a', '화남')).toBeNull();

        store.set(roomsAtom, [room([withFace()])]);
        const job = changeExpression('r', 'a', '슬픔');
        store.set(roomsAtom, [room([withFace({ portrait: 'new-base' })])]);
        expect(await job).toBeNull();
        expect(current().faces).not.toHaveProperty('슬픔');
    });

    it('does not let a slower earlier expression override the latest one', async () => {
        store.set(roomsAtom, [room([withFace()])]);
        const first = changeExpression('r', 'a', '슬픔');
        changeExpression('r', 'a', '웃음');
        await first;
        expect(current().expression).toBe('웃음');
        expect(current().faces).toMatchObject({ 슬픔: 'img-1' });
    });
});

describe('setMessageFace', () => {
    it('patches only the given bubbles', () => {
        store.set(roomsAtom, [
            {
                ...room([agent()]),
                messages: [
                    { id: 'm1', sender: 'a', text: '1', ts: 0, face: 'old' },
                    { id: 'm2', sender: 'a', text: '2', ts: 0, face: 'old' },
                ],
            },
        ]);
        setMessageFace('r', ['m2'], 'new');
        expect(store.get(roomsAtom)[0].messages.map((m) => m.face)).toEqual([
            'old',
            'new',
        ]);
    });
});
