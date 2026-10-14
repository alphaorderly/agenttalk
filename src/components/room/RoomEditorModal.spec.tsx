import {
    act,
    fireEvent,
    render,
    screen,
    waitFor,
    within,
} from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import toast from 'react-hot-toast';
import {
    afterAll,
    afterEach,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import type { Preset } from '@services/api';
import type {
    CastingEvent,
    GenerateAgentsRequest,
    GeneratedAgent,
    ProfilesResponse,
} from '@shared/providers';
import { modalAtom, newAgent, roomsAtom } from '@stores/chat';
import type { Room, RoomMode } from '@/types/chat';
import { toPresetRoom } from '@utils/preset/preset';
import { defaultMafiaSetup, newGame } from '@/modes/mafia/rules';
import type { MafiaRole } from '@/modes/mafia/types';
import RoomEditorModal from './RoomEditorModal';

const mocks = vi.hoisted(() => ({
    usePresets: vi.fn(() => ({ data: [] as Preset[] })),
    createPreset: vi.fn(),
    stopConversation: vi.fn(),
    useProfiles: vi.fn(() => ({
        data: undefined as ProfilesResponse | undefined,
    })),
    streamCasting: vi.fn(),
}));

vi.mock('@services/api', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@services/api')>()),
    useProfiles: mocks.useProfiles,
    useModels: () => ({ data: undefined }),
    usePresets: mocks.usePresets,
    useCreatePreset: () => ({
        mutateAsync: mocks.createPreset,
        isPending: false,
    }),
    streamCasting: mocks.streamCasting,
}));

vi.mock('@services/conversation', () => ({
    onUserMessage: vi.fn(),
    startConversation: vi.fn(),
    stopConversation: mocks.stopConversation,
}));

const dialogMethods = ['showModal', 'close'] as const;
const originalDialogMethods = dialogMethods.map((method) =>
    Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, method)
);

beforeAll(() => {
    for (const method of dialogMethods) {
        Object.defineProperty(HTMLDialogElement.prototype, method, {
            configurable: true,
            value(this: HTMLDialogElement) {
                this.open = method === 'showModal';
            },
        });
    }
});

afterAll(() => {
    dialogMethods.forEach((method, index) => {
        const original = originalDialogMethods[index];
        if (original)
            Object.defineProperty(
                HTMLDialogElement.prototype,
                method,
                original
            );
        else Reflect.deleteProperty(HTMLDialogElement.prototype, method);
    });
});

beforeEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
    mocks.usePresets.mockReturnValue({ data: [] });
    mocks.createPreset.mockResolvedValue(undefined);
    mocks.useProfiles.mockReturnValue({ data: undefined });
    mocks.streamCasting.mockReset();
});

type CastingOptions = {
    signal: AbortSignal;
    onEvent: (e: CastingEvent) => void;
};

const castMember = (index: number): GeneratedAgent => ({
    name: `새멤버${index}`,
    emoji: '🙂',
    persona: '등산을 좋아하는 사서. 기록을 꼼꼼히 읽는다.',
    style: '존댓말로 짧게 말한다.',
    talk: 'normal',
    secret: '',
    relations: '',
});

/** 기획 → 상세화 이벤트를 흉내 낸다. failed에 든 위치는 실패로 보낸다 */
function emitCasting(
    req: GenerateAgentsRequest,
    onEvent: CastingOptions['onEvent'],
    failed: number[] = []
) {
    const start = req.existing.length;
    onEvent({
        type: 'plan',
        members: Array.from({ length: req.count }, (_, i) => ({
            name: castMember(start + i).name,
            emoji: '🙂',
        })),
    });
    for (let index = 0; index < req.count; index++)
        onEvent(
            failed.includes(index)
                ? { type: 'failed', index, error: 'JSON 오류' }
                : { type: 'agent', index, agent: castMember(start + index) }
        );
}

describe('모드와 소개 설정에 따른 에이전트 자동 생성', () => {
    beforeEach(() => {
        mocks.useProfiles.mockReturnValue({
            data: {
                defaultProfileId: 'profile',
                profiles: [
                    {
                        id: 'profile',
                        name: '테스트 프로필',
                        provider: 'openai',
                        baseURL: '',
                        defaultModel: 'gpt-5-mini',
                        defaultReasoning: 'none',
                        hasKey: true,
                        keyHint: '',
                        createdAt: 0,
                        updatedAt: 0,
                    },
                ],
            },
        });
        mocks.streamCasting.mockImplementation(
            async (req: GenerateAgentsRequest, { onEvent }: CastingOptions) => {
                emitCasting(req, onEvent);
                onEvent({ type: 'done', via: '테스트 모델' });
            }
        );
    });

    const requests = () =>
        mocks.streamCasting.mock.calls.map(
            ([req]) => req as GenerateAgentsRequest
        );
    const names = () =>
        screen
            .getAllByPlaceholderText('이름')
            .map((input) => (input as HTMLInputElement).value);

    async function generate(count = 2) {
        fireEvent.click(screen.getByRole('button', { name: '에이전트' }));
        fireEvent.change(
            screen.getByRole('spinbutton', { name: '만들 에이전트 수' }),
            { target: { value: count } }
        );
        fireEvent.click(screen.getByRole('button', { name: '자동 생성' }));
        await waitFor(() =>
            expect(
                screen.getByRole('button', { name: '자동 생성' })
            ).toBeEnabled()
        );
    }

    it.each([[], [newAgent(0), newAgent(1)]])(
        '10명을 한 번에 요청해 자리표시를 대체하고 모두 저장한다 (%#)',
        async (...agents) => {
            const store = mount(makeRoom({ topic: '여행 계획', agents }));
            await generate(10);

            expect(requests()).toHaveLength(1);
            expect(requests()[0]).toEqual(
                expect.objectContaining({ count: 10, existing: [] })
            );
            expect(names()).toEqual(
                Array.from({ length: 10 }, (_, i) => `새멤버${i}`)
            );

            fireEvent.click(screen.getByRole('button', { name: /^저장$/ }));
            await waitFor(() => expect(store.get(modalAtom)).toBeNull());
            expect(store.get(roomsAtom)[0].agents).toHaveLength(10);
        }
    );

    it('일부 멤버가 실패하면 알리고, 다시 누르면 부족한 인원만 요청한다', async () => {
        const successToast = vi.spyOn(toast, 'success');
        mocks.streamCasting.mockImplementationOnce(
            async (req: GenerateAgentsRequest, { onEvent }: CastingOptions) => {
                emitCasting(req, onEvent, [3, 7]);
                onEvent({ type: 'done', via: '테스트 모델' });
            }
        );
        mount(makeRoom({ topic: '여행 계획', agents: [] }));
        await generate(10);

        expect(names()).toHaveLength(8);
        expect(screen.getByRole('alert')).toHaveTextContent(
            '10명 중 8명만 생성됐어요. JSON 오류'
        );
        expect(
            screen.getByRole('spinbutton', { name: '만들 에이전트 수' })
        ).toHaveValue(2);
        expect(successToast).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: '자동 생성' }));
        await waitFor(() => expect(names()).toHaveLength(10));
        expect(requests()[1].count).toBe(2);
        expect(requests()[1].existing).toHaveLength(8);
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        expect(successToast).toHaveBeenCalledOnce();
    });

    it.each([
        {
            failure: '기획 오류',
            run: async (
                _: GenerateAgentsRequest,
                { onEvent }: CastingOptions
            ) => onEvent({ type: 'error', message: '기획 오류' }),
        },
        {
            failure: '네트워크 오류',
            run: async () => {
                throw new Error('네트워크 오류');
            },
        },
    ])(
        '$failure로 끝나면 자리표시를 그대로 두고 알린다',
        async ({ failure, run }) => {
            mocks.streamCasting.mockImplementationOnce(run);
            mount(
                makeRoom({
                    topic: '여행 계획',
                    agents: [newAgent(0), newAgent(1)],
                })
            );
            await generate(3);

            expect(names()).toEqual(['에이전트1', '에이전트2']);
            expect(screen.getByRole('alert')).toHaveTextContent(
                `3명 중 0명만 생성됐어요. ${failure}`
            );
            expect(
                screen.queryByRole('button', { name: '되돌리기' })
            ).not.toBeInTheDocument();
        }
    );

    it('상세화가 끝난 순서와 관계없이 기획 순서로 넣고, 되돌리면 자리표시가 돌아온다', async () => {
        mocks.streamCasting.mockImplementationOnce(
            async (_: GenerateAgentsRequest, { onEvent }: CastingOptions) => {
                onEvent({
                    type: 'plan',
                    members: [0, 1, 2].map((i) => ({
                        name: castMember(i).name,
                        emoji: '🙂',
                    })),
                });
                for (const index of [2, 0, 1])
                    onEvent({ type: 'agent', index, agent: castMember(index) });
                onEvent({ type: 'done', via: '테스트 모델' });
            }
        );
        mount(
            makeRoom({ topic: '여행 계획', agents: [newAgent(0), newAgent(1)] })
        );
        await generate(3);
        expect(names()).toEqual(['새멤버0', '새멤버1', '새멤버2']);

        fireEvent.click(screen.getByRole('button', { name: '되돌리기' }));
        expect(names()).toEqual(['에이전트1', '에이전트2']);
    });

    it('생성을 중단하면 스트림을 취소하고 완성된 멤버만 남긴다', async () => {
        let signal: AbortSignal | undefined;
        mocks.streamCasting.mockImplementationOnce(
            (req: GenerateAgentsRequest, options: CastingOptions) =>
                new Promise((_, reject) => {
                    signal = options.signal;
                    emitCasting({ ...req, count: 5 }, options.onEvent);
                    options.signal.addEventListener(
                        'abort',
                        () => reject(new DOMException('취소', 'AbortError')),
                        { once: true }
                    );
                })
        );
        mount(makeRoom({ topic: '여행 계획', agents: [] }));
        fireEvent.click(screen.getByRole('button', { name: '에이전트' }));
        fireEvent.change(
            screen.getByRole('spinbutton', { name: '만들 에이전트 수' }),
            { target: { value: 10 } }
        );
        fireEvent.click(screen.getByRole('button', { name: '자동 생성' }));
        fireEvent.click(
            await screen.findByRole('button', { name: '생성 중단' })
        );
        await waitFor(() => expect(names()).toHaveLength(5));
        expect(signal?.aborted).toBe(true);
        expect(screen.getByRole('alert')).toHaveTextContent(
            '생성을 중단했습니다.'
        );
        expect(
            screen.getByRole('spinbutton', { name: '만들 에이전트 수' })
        ).toHaveValue(5);
    });

    it('기존 마피아 방에서 자기소개와 역할 배분 지침을 함께 보낸다', async () => {
        const userRules = '마피아 2명을 배정한다. 반말을 쓴다';
        mount(
            makeRoom({
                mode: 'mafia',
                topic: '산골 마을',
                castingRules: userRules,
            })
        );
        await generate(6);
        expect(requests()).toHaveLength(1);
        const [req] = requests();
        expect(req.modeContext).toContain('첫 번째 밤 전에');
        expect(req.modeContext).toContain('차례로 짧게 자기소개');
        expect(req.modeContext).toContain('자동·수동 배분 설정');
        expect(req.modeContext).toContain('persona, style, relations, secret');
        expect(req.modeContext).toContain('상황 설정 속 처지와 배경, 성격');
        expect(req.shareIntroductions).toBe(false);
        expect(req.castingRules).toBe(userRules);
        expect(req.existing).toHaveLength(5);
        expect(
            screen.getByRole('textbox', { name: '자동 생성 규칙 (선택)' })
        ).toHaveValue(userRules);
    });

    const withSignal = expect.objectContaining({
        signal: expect.any(AbortSignal),
    });

    it('일반 방에서 마피아로 바꿔도 사용자 규칙을 유지하고 현재 모드 지침을 보낸다', async () => {
        const userRules = '모두 20대, 반말 위주';
        mount(makeRoom({ topic: '친구들의 모임', castingRules: userRules }));
        await pickMode('mafia');
        await generate();
        expect(mocks.streamCasting).toHaveBeenCalledExactlyOnceWith(
            expect.objectContaining({
                castingRules: userRules,
                shareIntroductions: false,
                modeContext: expect.stringContaining('차례로 짧게 자기소개'),
            }),
            withSignal
        );
    });

    it('소개를 공개한 마피아 방에도 자기소개 시간이 있다는 지침을 보낸다', async () => {
        mount(makeRoom({ mode: 'mafia', topic: '산골 마을' }));
        fireEvent.change(sharingField(), { target: { value: 'public' } });
        await generate();
        expect(mocks.streamCasting).toHaveBeenCalledExactlyOnceWith(
            expect.objectContaining({
                shareIntroductions: true,
                modeContext:
                    expect.stringContaining('소개 공개 설정과 관계없이'),
            }),
            withSignal
        );
    });

    it.each([
        { selection: 'default', expected: true },
        { selection: 'private', expected: false },
    ] as const)(
        '일반 대화는 $selection 소개 설정을 보내고 마피아 지침은 보내지 않는다',
        async ({ selection, expected }) => {
            mount(makeRoom({ topic: '여행 계획' }));
            fireEvent.change(sharingField(), { target: { value: selection } });
            await generate();
            expect(mocks.streamCasting).toHaveBeenCalledExactlyOnceWith(
                expect.objectContaining({
                    shareIntroductions: expected,
                    modeContext: undefined,
                }),
                withSignal
            );
        }
    );

    it('새 마피아 방은 자기소개할 배경을 만드는 기본 생성 규칙을 채운다', async () => {
        mount();
        await pickMode('mafia');
        await generate();
        expect(mocks.streamCasting).toHaveBeenCalledExactlyOnceWith(
            expect.objectContaining({
                castingRules:
                    expect.stringContaining('첫 자기소개에서 구별되도록'),
                modeContext: expect.stringContaining('차례로 짧게 자기소개'),
                shareIntroductions: false,
            }),
            withSignal
        );
    });
});

afterEach(() => {
    vi.restoreAllMocks();
});

function makeRoom(overrides: Partial<Room> = {}): Room {
    return {
        id: 'room',
        name: '소개 설정 테스트',
        topic: '',
        profileId: null,
        messages: [],
        updatedAt: 0,
        agents: ['철수', '영희', '민수', '지수', '태오'].map((name, index) => ({
            id: `agent-${index}`,
            name,
            emoji: '🙂',
            color: '#ffffff',
            persona: `${name}의 소개.`,
            profileId: null,
            model: '',
        })),
        ...overrides,
    };
}

function mount(room?: Room) {
    const store = createStore();
    store.set(roomsAtom, room ? [room] : []);
    store.set(modalAtom, { type: 'room', roomId: room?.id ?? null });
    render(
        <Provider store={store}>
            <RoomEditorModal />
        </Provider>
    );
    return store;
}

const sharingField = () =>
    screen.getByRole('combobox', { name: /^서로의 소개 공개/ });

const assignmentField = () =>
    screen.getByRole('combobox', { name: '역할 배분' });
const manualRoles: MafiaRole[] = [
    'mafia',
    'doctor',
    'police',
    'citizen',
    'citizen',
];

function assignRoles() {
    ['철수', '영희', '민수', '지수', '태오'].forEach((name, i) => {
        fireEvent.change(
            screen.getByRole('combobox', { name: `${name}의 역할` }),
            {
                target: { value: manualRoles[i] },
            }
        );
    });
}

describe('마피아 역할 배분 설정', () => {
    it('이전 방은 자동 배분을 표시하며 수동 선택을 저장하고 다시 열 수 있다', async () => {
        const room = makeRoom({ mode: 'mafia' });
        const store = mount(room);
        expect(assignmentField()).toHaveValue('random');
        fireEvent.change(assignmentField(), { target: { value: 'manual' } });
        assignRoles();
        fireEvent.click(screen.getByRole('button', { name: /^저장$/ }));
        await waitFor(() => expect(store.get(modalAtom)).toBeNull());
        const saved = store.get(roomsAtom)[0];
        expect(saved.mafia?.roleAssignment).toBe('manual');
        expect(saved.mafia?.assignedRoles).toEqual(
            Object.fromEntries(
                saved.agents.map((a, i) => [a.id, manualRoles[i]])
            )
        );
        act(() => store.set(modalAtom, { type: 'room', roomId: room.id }));
        expect(assignmentField()).toHaveValue('manual');
        expect(
            screen.getByRole('combobox', { name: '철수의 역할' })
        ).toHaveValue('mafia');
    });

    it('미지정·잘못된 역할 인원으로는 저장할 수 없고 자동으로 바꾸면 저장할 수 있다', async () => {
        const store = mount(makeRoom({ mode: 'mafia' }));
        fireEvent.change(assignmentField(), { target: { value: 'manual' } });
        await act(async () =>
            fireEvent.click(screen.getByRole('button', { name: /^저장$/ }))
        );
        expect(screen.getByRole('alert')).toHaveTextContent(
            '철수의 역할을 지정'
        );
        expect(store.get(modalAtom)).not.toBeNull();
        assignRoles();
        fireEvent.change(
            screen.getByRole('combobox', { name: '철수의 역할' }),
            { target: { value: 'citizen' } }
        );
        await act(async () =>
            fireEvent.click(screen.getByRole('button', { name: /^저장$/ }))
        );
        expect(screen.getByRole('alert')).toHaveTextContent('마피아 1명');
        fireEvent.change(assignmentField(), { target: { value: 'random' } });
        fireEvent.click(screen.getByRole('button', { name: /^저장$/ }));
        await waitFor(() => expect(store.get(modalAtom)).toBeNull());
        expect(store.get(roomsAtom)[0].mafia?.roleAssignment).toBe('random');
        expect(store.get(roomsAtom)[0].mafia?.assignedRoles?.['agent-0']).toBe(
            'citizen'
        );
    });

    it('플레이어로 바꾸면 나의 역할도 지정해야 한다', async () => {
        mount(makeRoom({ mode: 'mafia' }));
        fireEvent.change(assignmentField(), { target: { value: 'manual' } });
        assignRoles();
        await act(async () =>
            fireEvent.click(screen.getByRole('radio', { name: /^플레이어/ }))
        );
        expect(screen.getByRole('combobox', { name: '나의 역할' })).toHaveValue(
            ''
        );
        expect(screen.getByRole('alert')).toHaveTextContent('나의 역할');
        fireEvent.change(screen.getByRole('combobox', { name: '나의 역할' }), {
            target: { value: 'citizen' },
        });
        await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    });

    it('진행 중인 판의 역할은 설정을 수동으로 바꿔도 유지한다', async () => {
        const room = makeRoom({ mode: 'mafia', mafia: defaultMafiaSetup(5) });
        room.modeState = {
            mafia: {
                ...newGame(room, room.mafia!, '나', () => 0.3),
                phase: 'day',
            },
        };
        const existingGame = room.modeState?.mafia;
        const store = mount(room);
        fireEvent.change(assignmentField(), { target: { value: 'manual' } });
        assignRoles();
        fireEvent.click(screen.getByRole('button', { name: /^저장$/ }));
        await waitFor(() => expect(store.get(modalAtom)).toBeNull());
        expect(store.get(roomsAtom)[0].modeState?.mafia).toBe(existingGame);
        expect(store.get(roomsAtom)[0].mafia?.roleAssignment).toBe('manual');
    });
});

async function pickMode(mode: RoomMode) {
    await act(async () => {
        fireEvent.click(
            screen.getByRole('radio', {
                name: mode === 'mafia' ? /마피아 게임/ : /일반 대화/,
            })
        );
    });
}

function expectDefault(label: '공개' | '비공개') {
    expect(sharingField()).toHaveValue('default');
    expect(
        within(sharingField()).getByRole('option', {
            name: `모드 기본값 (${label})`,
        })
    ).toHaveProperty('selected', true);
}

describe('채팅방 소개 공개 설정', () => {
    it('새 방은 일반 대화 공개 기본값에서 시작하고 모드 전환을 따라간다', async () => {
        mount();
        expectDefault('공개');
        await pickMode('mafia');
        expectDefault('비공개');
        await pickMode('chat');
        expectDefault('공개');
    });

    it.each(['public', 'private'] as const)(
        '명시적으로 선택한 %s 설정은 모드를 바꿔도 유지한다',
        async (selection) => {
            mount();
            fireEvent.change(sharingField(), { target: { value: selection } });
            await pickMode('mafia');
            expect(sharingField()).toHaveValue(selection);
            await pickMode('chat');
            expect(sharingField()).toHaveValue(selection);
        }
    );

    it.each([
        { mode: undefined, label: '공개' },
        { mode: 'mafia', label: '비공개' },
    ] as const)(
        '소개 공개 설정이 없는 이전 $mode 방은 $label 기본값을 표시한다',
        ({ mode, label }) => {
            mount(makeRoom({ mode }));
            expectDefault(label);
        }
    );

    it.each([
        {
            mode: 'chat',
            initial: undefined,
            selection: 'private',
            saved: false,
        },
        { mode: 'mafia', initial: undefined, selection: 'public', saved: true },
        {
            mode: 'chat',
            initial: false,
            selection: 'default',
            saved: undefined,
        },
        {
            mode: 'mafia',
            initial: true,
            selection: 'default',
            saved: undefined,
        },
    ] as const)(
        '$mode 방의 $selection 선택을 저장하고 다시 열어도 유지한다',
        async ({ mode, initial, selection, saved }) => {
            const room = makeRoom({ mode, shareIntroductions: initial });
            const store = mount(room);
            fireEvent.change(sharingField(), { target: { value: selection } });
            fireEvent.click(screen.getByRole('button', { name: /^저장$/ }));

            await waitFor(() => expect(store.get(modalAtom)).toBeNull());
            expect(store.get(roomsAtom)[0].shareIntroductions).toBe(saved);
            expect(mocks.stopConversation).toHaveBeenCalledExactlyOnceWith(
                room.id
            );

            act(() => store.set(modalAtom, { type: 'room', roomId: room.id }));
            expect(sharingField()).toHaveValue(selection);
            if (selection === 'default') {
                expectDefault(mode === 'mafia' ? '비공개' : '공개');
                await pickMode(mode === 'mafia' ? 'chat' : 'mafia');
                expectDefault(mode === 'mafia' ? '공개' : '비공개');
            }
        }
    );

    it('소개 공개 여부가 바뀌지 않는 이름 수정은 진행 중인 대화를 멈추지 않는다', async () => {
        const store = mount(makeRoom());
        fireEvent.change(screen.getByRole('textbox', { name: '방 이름' }), {
            target: { value: '바뀐 방 이름' },
        });
        fireEvent.click(screen.getByRole('button', { name: /^저장$/ }));
        await waitFor(() => expect(store.get(modalAtom)).toBeNull());
        expect(store.get(roomsAtom)[0].name).toBe('바뀐 방 이름');
        expect(mocks.stopConversation).not.toHaveBeenCalled();
    });

    it.each([
        { shareIntroductions: undefined, selection: 'default' },
        { shareIntroductions: true, selection: 'public' },
    ] as const)(
        '마피아 프리셋을 불러오면 소개 설정 $selection을 복원한다',
        ({ shareIntroductions, selection }) => {
            mocks.usePresets.mockReturnValue({
                data: [
                    {
                        id: 'preset',
                        name: '마피아 프리셋',
                        room: toPresetRoom(
                            makeRoom({ mode: 'mafia', shareIntroductions })
                        ),
                        createdAt: 0,
                        updatedAt: 0,
                    },
                ],
            });
            mount();
            fireEvent.change(
                screen.getByRole('combobox', { name: /^프리셋에서 시작/ }),
                {
                    target: { value: 'preset' },
                }
            );
            expect(
                screen.getByRole('radio', { name: /마피아 게임/ })
            ).toHaveAttribute('aria-checked', 'true');
            expect(sharingField()).toHaveValue(selection);
            if (selection === 'default') expectDefault('비공개');
        }
    );

    it.each([
        { selection: 'private', saved: false },
        { selection: 'public', saved: true },
        { selection: 'default', saved: undefined },
    ] as const)(
        '저장 전의 $selection 선택도 프리셋에 반영한다',
        async ({ selection, saved }) => {
            const room = makeRoom({ mode: 'mafia', shareIntroductions: false });
            const store = mount(room);
            vi.spyOn(window, 'prompt').mockReturnValue('소개 공개 프리셋');
            fireEvent.change(sharingField(), { target: { value: selection } });
            fireEvent.click(
                screen.getByRole('button', { name: '프리셋으로 저장' })
            );

            await waitFor(() =>
                expect(mocks.createPreset).toHaveBeenCalledOnce()
            );
            const [preset] = mocks.createPreset.mock.calls[0];
            expect(preset.name).toBe('소개 공개 프리셋');
            expect(preset.room.shareIntroductions).toBe(saved);
            expect(preset.room.mode).toBe('mafia');
            expect(store.get(roomsAtom)[0].shareIntroductions).toBe(false);
            expect(store.get(modalAtom)).toEqual({
                type: 'room',
                roomId: room.id,
            });
        }
    );
});
