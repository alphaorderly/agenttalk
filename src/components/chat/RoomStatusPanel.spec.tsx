import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    idleNoteAtom,
    modalAtom,
    ownerStatusesAtom,
    pendingAtom,
    roomStatusRuntimeAtom,
    runningAtom,
    type OwnerRoomStatus,
} from '@stores/chat';
import type { Room } from '@/types/chat';
import ChatRoom from './ChatRoom';
import RoomStatusPanel from './RoomStatusPanel';

const { retryRoomStatus } = vi.hoisted(() => ({
    retryRoomStatus: vi.fn(),
}));
vi.mock('@services/roomStatus', () => ({
    retryRoomStatus,
    isMarkdownSummary: (cache?: { summary?: { markdown?: unknown } }) =>
        typeof cache?.summary?.markdown === 'string',
}));
vi.mock('@services/api', () => ({
    useProfiles: () => ({ data: undefined }),
}));
vi.mock('@services/conversation', () => ({
    onUserMessage: vi.fn(),
    startConversation: vi.fn(),
    stopConversation: vi.fn(),
}));

const room: Room = {
    id: 'mafia',
    name: '마피아 게임',
    topic: '대화 설정은 모델에게만 전달되는 주제',
    profileId: null,
    messages: [
        { id: 'user', sender: 'me', text: '모두 소감을 말해 주세요.', ts: 100 },
    ],
    updatedAt: 100,
    agents: ['루나', '하린', '제트', '리아', '비오', '태오', '모루'].map(
        (name, index) => ({
            id: String(index),
            name,
            emoji: '👤',
            color: '#eee',
            persona: '',
            secret: index === 0 ? '당신은 마피아입니다.' : '',
            profileId: null,
            model: '',
        })
    ),
};

const saved: OwnerRoomStatus = {
    updatedAt: 1_700_000_000_000,
    via: 'OpenAI · test-model',
    inputKey: 'fixture',
    messageIds: ['user'],
    messageSignature: 'fixture',
    summary: {
        markdown: [
            '## 지금 상황',
            '- **게임 종료** · 시민 승리',
            '',
            '| 생존 | 탈락 |',
            '| --- | --- |',
            '| 4명 | 3명 |',
        ].join('\n'),
    },
};

beforeEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
});

function mount(withSummary = true) {
    const store = createStore();
    store.set(ownerStatusesAtom, withSummary ? { [room.id]: saved } : {});
    render(
        <Provider store={store}>
            <RoomStatusPanel room={room} />
        </Provider>
    );
    return store;
}

describe('인간 전용 방 상태 패널', () => {
    it('정해진 칸 없이 마크다운 메모만 보여 주고 비밀 설정을 그대로 나열하지 않는다', () => {
        mount();
        const panel = screen.getByRole('complementary', {
            name: '방장 전용 메모',
        });
        expect(
            within(panel).getByRole('heading', { name: '지금 상황' })
        ).toBeInTheDocument();
        expect(within(panel).getByText('게임 종료')).toContainHTML('게임 종료');
        expect(within(panel).getByRole('table')).toBeInTheDocument();
        expect(
            within(panel).queryByText('당신은 마피아입니다.')
        ).not.toBeInTheDocument();
        expect(within(panel).queryByText(/응답/)).not.toBeInTheDocument();
        expect(
            within(panel).getByText(/OpenAI · test-model/)
        ).toBeInTheDocument();
    });

    it('이전 형식의 캐시는 표시하지 않는다', () => {
        const store = createStore();
        store.set(ownerStatusesAtom, {
            [room.id]: { ...saved, summary: { overview: [] } as never },
        });
        render(
            <Provider store={store}>
                <RoomStatusPanel room={room} />
            </Provider>
        );
        expect(
            screen.getByText('대화 기록을 바탕으로 메모를 준비하고 있어요.')
        ).toBeInTheDocument();
    });

    it('작은 화면의 컨트롤은 기본적으로 접히고 독립된 스크롤 영역을 펼친다', () => {
        mount();
        const toggle = screen.getByRole('button', {
            name: /방 메모 · 나만 보기/,
        });
        const content = document.getElementById(
            toggle.getAttribute('aria-controls')!
        );
        expect(toggle).toHaveAttribute('aria-expanded', 'false');
        expect(content).toHaveClass(
            'hidden',
            'xl:flex',
            'max-h-[40dvh]',
            'overflow-y-auto'
        );
        fireEvent.click(toggle);
        expect(toggle).toHaveAttribute('aria-expanded', 'true');
        expect(content).not.toHaveClass('hidden');
        expect(screen.getByRole('complementary')).toHaveClass(
            'xl:w-80',
            'xl:min-h-0'
        );
        fireEvent.click(toggle);
        expect(toggle).toHaveAttribute('aria-expanded', 'false');
    });

    it('요약 갱신을 기다리지 않고 현재 화자·검색·정지 상태를 보여 준다', () => {
        const store = mount();
        act(() =>
            store.set(runningAtom, {
                [room.id]: { turns: 1, status: '태오 차례 · 요청에 응답' },
            })
        );
        expect(screen.getAllByText('태오 차례 · 요청에 응답')).toHaveLength(2);
        act(() =>
            store.set(pendingAtom, {
                [room.id]: {
                    id: 'p',
                    agentId: '5',
                    text: '',
                    status: '🔍 찾는 중…',
                },
            })
        );
        expect(screen.getAllByText('태오 · 🔍 찾는 중…')).toHaveLength(2);
        act(() => {
            store.set(pendingAtom, {});
            store.set(runningAtom, {});
            store.set(idleNoteAtom, { [room.id]: '진행 모델 오류로 대기 중' });
        });
        expect(screen.getAllByText('진행 모델 오류로 대기 중')).toHaveLength(2);
        expect(screen.getByText('게임 종료')).toBeInTheDocument();
    });

    it('실패 시 이전 현황을 유지하고 재시도와 모델 설정을 제공한다', () => {
        const store = mount();
        act(() =>
            store.set(roomStatusRuntimeAtom, {
                [room.id]: { loading: false, error: 'API 키를 설정해 주세요.' },
            })
        );
        expect(screen.getByRole('alert')).toHaveTextContent('API 키');
        expect(screen.getByText('게임 종료')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: '다시 시도' }));
        expect(retryRoomStatus).toHaveBeenCalledWith(room.id);
        fireEvent.click(screen.getByRole('button', { name: '요약 모델 설정' }));
        expect(store.get(modalAtom)).toEqual({
            type: 'settings',
            section: 'assistants',
        });
    });
});

describe('채팅방 상태 통합', () => {
    it('고정 주제와 비밀 설정을 화면에 노출하지 않는다', () => {
        const store = createStore();
        store.set(ownerStatusesAtom, {});
        render(
            <Provider store={store}>
                <ChatRoom room={room} />
            </Provider>
        );
        expect(screen.queryByText(room.topic)).not.toBeInTheDocument();
        expect(
            screen.queryByText('당신은 마피아입니다.')
        ).not.toBeInTheDocument();
        expect(room.topic).toBe('대화 설정은 모델에게만 전달되는 주제');
    });

    it('본문 뒤의 귓속말 표시에 공개 메시지 안내를 표시한다', () => {
        render(
            <Provider store={createStore()}>
                <ChatRoom room={room} />
            </Provider>
        );
        const input = screen.getByRole('textbox');
        fireEvent.change(input, {
            target: { value: '투표할 사람은 누구야? @@태오' },
        });
        expect(
            screen.getByText(
                '현재 공개 메시지예요. 귓속말은 맨 앞에 @@이름을 써 주세요.'
            )
        ).toBeInTheDocument();
        fireEvent.change(input, {
            target: { value: '@@태오 투표할 사람은 누구야?' },
        });
        expect(
            screen.queryByText(/현재 공개 메시지예요/)
        ).not.toBeInTheDocument();
        expect(
            screen.getByText(/태오에게만 보내는 귓속말/)
        ).toBeInTheDocument();
    });
});
