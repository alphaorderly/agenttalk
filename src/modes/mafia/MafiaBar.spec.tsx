import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { pendingAtom, store } from '@stores/chat';
import type { Room } from '@/types/chat';
import MessageList from '@components/chat/MessageList';
import type { MafiaGame } from './types';
import { defaultMafiaSetup } from './rules';
import MafiaBar from './MafiaBar';

const mocks = vi.hoisted(() => ({
    submitMafiaAction: vi.fn(),
    startMafiaGame: vi.fn(),
    startMafiaVote: vi.fn(),
}));
vi.mock('./actions', () => ({
    ...mocks,
    stopMafiaGame: vi.fn(),
}));

const agent = (id: string, name: string) => ({
    id,
    name,
    emoji: '🙂',
    color: '#fff',
    persona: '',
    profileId: null,
    model: '',
});

function makeRoom(game: Partial<MafiaGame>): Room {
    return {
        id: 'r',
        name: '마을',
        topic: '',
        profileId: null,
        mode: 'mafia',
        agents: [agent('a', '철수'), agent('b', '영희'), agent('c', '지수')],
        messages: [
            {
                id: '1',
                sender: 'system',
                text: '🌙 1번째 밤',
                ts: 1,
                notice: true,
            },
            {
                id: '2',
                sender: 'system',
                text: '🎭 역할: 철수 마피아',
                ts: 2,
                notice: true,
                to: ['gm'],
            },
            {
                id: '3',
                sender: 'system',
                text: '🎭 내 역할은 경찰이에요',
                ts: 3,
                notice: true,
                to: ['me'],
            },
        ],
        updatedAt: 0,
        modeState: {
            mafia: {
                userRole: 'player',
                reveal: false,
                dayTalk: 12,
                phase: 'night',
                day: 1,
                players: [
                    { id: 'a', name: '철수', role: 'mafia', alive: true },
                    { id: 'b', name: '영희', role: 'doctor', alive: true },
                    { id: 'c', name: '지수', role: 'citizen', alive: true },
                    { id: 'me', name: '나', role: 'police', alive: true },
                ],
                night: { step: 'check', chatted: [], picks: {} },
                votes: {},
                talk: 0,
                hold: false,
                checks: [],
                ...game,
            },
        },
    };
}

/** 상단 참가자 목록의 자리 */
const seatOf = (name: string) =>
    within(screen.getByRole('list', { name: '참가자' })).getByText(name)
        .parentElement!;

beforeEach(() => {
    vi.clearAllMocks();
    // jsdom에는 <dialog>의 showModal/close가 없다
    HTMLDialogElement.prototype.showModal ??= function (
        this: HTMLDialogElement
    ) {
        this.open = true;
    };
    HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
        this.open = false;
    };
    store.set(pendingAtom, {});
});

describe('MafiaBar', () => {
    it('blocks a new manual game until all participant roles match the configured counts', () => {
        const room = makeRoom({});
        room.modeState = undefined;
        room.mafia = {
            ...defaultMafiaSetup(3),
            userRole: 'player',
            roleAssignment: 'manual',
            assignedRoles: {},
        };
        const { rerender } = render(<MafiaBar room={room} />);
        expect(
            screen.getByRole('button', { name: '게임 시작' })
        ).toBeDisabled();
        expect(screen.getByText(/철수의 역할을 지정/)).toBeTruthy();
        room.mafia.assignedRoles = {
            a: 'mafia',
            b: 'doctor',
            c: 'citizen',
            me: 'police',
        };
        rerender(<MafiaBar room={{ ...room }} />);
        expect(screen.getByRole('button', { name: '게임 시작' })).toBeEnabled();
        fireEvent.click(screen.getByRole('button', { name: '게임 시작' }));
        expect(mocks.startMafiaGame).toHaveBeenCalledWith('r');
    });
    it('shows a player only their own role and asks for the night action', () => {
        render(<MafiaBar room={makeRoom({})} />);
        expect(screen.getByText('1번째 밤')).toBeTruthy();
        expect(screen.getByLabelText('내 역할 경찰')).toBeTruthy();
        expect(screen.queryByRole('img', { name: '마피아' })).toBeNull();
        expect(screen.getByText('오늘 밤 누구를 조사할까요?')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: '철수' }));
        expect(mocks.submitMafiaAction).toHaveBeenCalledWith('r', 'a');
    });

    it('shows every role to an observer', () => {
        render(<MafiaBar room={makeRoom({ userRole: 'observer' })} />);
        expect(screen.getByRole('img', { name: '마피아' })).toBeTruthy();
        expect(screen.getByRole('img', { name: '의사' })).toBeTruthy();
        expect(screen.queryByText(/조사할까요/)).toBeNull();
    });

    it('explains the roles without revealing who has them', () => {
        render(<MafiaBar room={makeRoom({})} />);
        fireEvent.click(screen.getByRole('button', { name: '역할 설명' }));
        const dialog = screen.getByRole('dialog', { name: '역할 설명' });
        expect(dialog.textContent).toContain('이번 판마피아1의사1경찰1시민1');
        expect(dialog.textContent).toContain('내 역할');
        expect(dialog.textContent).not.toContain('철수');
        fireEvent.click(screen.getByRole('button', { name: '닫기' }));
        expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('offers the vote button to the host during the day', () => {
        render(
            <MafiaBar room={makeRoom({ userRole: 'host', phase: 'day' })} />
        );
        fireEvent.click(screen.getByRole('button', { name: '투표 시작' }));
        expect(mocks.startMafiaVote).toHaveBeenCalledWith('r');
    });

    it.each(['observer', 'host', 'player'] as const)(
        'hides assigned roles during introductions in the %s view',
        (userRole) => {
            render(
                <MafiaBar
                    room={makeRoom({
                        userRole,
                        phase: 'introduction',
                        introduced: [],
                    })}
                />
            );
            expect(screen.getByText(/자기소개/)).toBeTruthy();
            expect(screen.queryByLabelText('내 역할 경찰')).toBeNull();
            expect(screen.queryByRole('img', { name: '마피아' })).toBeNull();
            expect(screen.queryByRole('img', { name: '의사' })).toBeNull();
            expect(
                screen.queryByRole('button', { name: '투표 시작' })
            ).toBeNull();
            fireEvent.click(screen.getByRole('button', { name: '역할 설명' }));
            const dialog = screen.getByRole('dialog', {
                name: '역할 설명',
            });
            expect(dialog.textContent).not.toContain('내 역할');
        }
    );

    it('offers introduction skipping only during the human player’s turn', () => {
        const room = makeRoom({ phase: 'introduction', introduced: [] });
        const { rerender } = render(<MafiaBar room={room} />);
        expect(
            screen.queryByRole('button', { name: '소개 건너뛰기' })
        ).toBeNull();

        room.modeState!.mafia!.introduced = ['a', 'b', 'c'];
        rerender(<MafiaBar room={{ ...room }} />);
        fireEvent.click(screen.getByRole('button', { name: '소개 건너뛰기' }));
        expect(mocks.submitMafiaAction).toHaveBeenCalledWith('r', null);
        expect(screen.queryByText(/조사할까요/)).toBeNull();
    });
});

describe('MessageList in a mafia game', () => {
    it('hides other people’s secrets and typing at night from a living player', () => {
        store.set(pendingAtom, {
            r: { id: 'p', agentId: 'b', text: '', silent: true },
        });
        const { container } = render(<MessageList room={makeRoom({})} />);
        expect(screen.getByText('1번째 밤')).toBeTruthy();
        expect(screen.getByText(/내 역할은 경찰/)).toBeTruthy();
        expect(screen.queryByText(/역할: 철수 마피아/)).toBeNull();
        expect(container.querySelector('i')).toBeNull();
    });

    it('shows everything once the player is dead', () => {
        const room = makeRoom({});
        room.modeState!.mafia!.players[3].alive = false;
        render(<MessageList room={room} />);
        expect(screen.getByText(/역할: 철수 마피아/)).toBeTruthy();
    });

    it('tags message senders with the roles I know', () => {
        const room = makeRoom({});
        room.messages = [
            { id: 'x', sender: 'a', text: '안녕', ts: 1 },
            { id: 'y', sender: 'b', text: '반가워', ts: 2 },
        ];
        const { rerender } = render(<MessageList room={room} />);
        expect(screen.queryByText('마피아')).toBeNull();
        expect(screen.queryByText('의사')).toBeNull();

        rerender(
            <MessageList
                room={{
                    ...room,
                    modeState: {
                        mafia: {
                            ...room.modeState!.mafia!,
                            userRole: 'observer',
                        },
                    },
                }}
            />
        );
        expect(screen.getByText('마피아')).toBeTruthy();
        expect(screen.getByText('의사')).toBeTruthy();
    });

    it('shows an agent’s feeling and memories on hover to observers only', () => {
        const room = makeRoom({ userRole: 'observer' });
        room.agents[0] = {
            ...room.agents[0],
            feeling: '들킬까 봐 초조함',
            memories: ['영희가 나를 의심함'],
        };
        room.messages.push(
            { id: 'f1', sender: 'a', text: '음', ts: 4, feeling: '침착함' },
            {
                id: 'f2',
                sender: 'a',
                text: '아니에요',
                ts: 5,
                feeling: '들킬까 봐 초조함',
            }
        );
        const { unmount } = render(<MafiaBar room={room} />);
        fireEvent.mouseEnter(seatOf('철수'));
        const popover = screen.getByRole('tooltip');
        expect(popover.textContent).toContain('들킬까 봐 초조함');
        expect(popover.textContent).toContain('침착함');
        expect(popover.textContent).toContain('영희가 나를 의심함');
        fireEvent.mouseLeave(seatOf('철수'));
        expect(screen.queryByRole('tooltip')).toBeNull();
        unmount();

        // 살아 있는 플레이어에게는 남의 마음을 보여주지 않는다
        render(
            <MafiaBar
                room={{
                    ...room,
                    modeState: {
                        mafia: {
                            ...room.modeState!.mafia!,
                            userRole: 'player',
                        },
                    },
                }}
            />
        );
        fireEvent.mouseEnter(seatOf('철수'));
        expect(screen.queryByRole('tooltip')).toBeNull();
    });
});
