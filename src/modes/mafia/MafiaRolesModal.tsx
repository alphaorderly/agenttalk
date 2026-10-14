import { Flag, Lightbulb, Moon, Sun } from 'lucide-react';
import Modal from '@components/Modal';
import type { Room } from '@/types/chat';
import { cn } from '@utils/cn/cn';
import {
    ROLE_GUIDE,
    ROLE_LABELS,
    ROLE_ORDER,
    gameOf,
    knownRole,
    roleCounts,
} from './rules';
import { ROLE_ICON, ROLE_TONE } from './visuals';

/**
 * 역할별 설명. 이번 판(또는 다음 판)의 역할 구성과 각 역할이 하는 일을 보여준다.
 * 누가 어떤 역할인지는 보여주지 않으므로 플레이어에게도 열어 둔다 (내 역할만 표시).
 */
const MafiaRolesModal = ({
    room,
    open,
    onClose,
}: {
    room: Room;
    open: boolean;
    onClose: () => void;
}) => {
    const game = gameOf(room);
    const counts = roleCounts(room);
    const mine = knownRole(room, 'me', 'me');
    const reveal = game?.reveal ?? room.mafia?.reveal ?? false;
    const flow = [
        {
            icon: Moon,
            title: '밤',
            text: '마피아가 한 명을 노리고, 의사는 지키고, 경찰은 조사해요.',
        },
        {
            icon: Sun,
            title: '낮',
            text: '살아 있는 사람이 토론한 뒤 투표로 한 명을 처형해요. 동표면 아무도 처형하지 않아요.',
        },
        {
            icon: Flag,
            title: '승리',
            text: `마피아가 모두 죽으면 시민 팀, 마피아 수가 나머지와 같아지면 마피아 팀이 이겨요. ${
                reveal
                    ? '죽으면 역할이 공개돼요.'
                    : '죽어도 역할은 공개되지 않아요.'
            }`,
        },
    ];
    return (
        <Modal open={open} onClose={onClose} title="역할 설명">
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
                <span className="text-neutral-500">
                    {game ? '이번 판' : '게임을 시작하면'}
                </span>
                {ROLE_ORDER.filter((r) => counts[r]).map((r) => (
                    <span
                        key={r}
                        className="inline-flex items-center gap-1 rounded-full bg-neutral-100 px-2 py-0.5 font-medium text-neutral-700"
                    >
                        {ROLE_LABELS[r]}
                        <span className="tabular-nums">{counts[r]}</span>
                    </span>
                ))}
            </div>
            <ul className="flex flex-col gap-2">
                {ROLE_ORDER.map((role) => {
                    const guide = ROLE_GUIDE[role];
                    const count = counts[role];
                    const Icon = ROLE_ICON[role];
                    return (
                        <li
                            key={role}
                            className={cn(
                                'relative flex flex-col gap-2 rounded-xl border p-3',
                                mine === role
                                    ? 'border-neutral-900 ring-1 ring-neutral-900'
                                    : 'border-neutral-200',
                                !count && 'opacity-45'
                            )}
                        >
                            <div className="flex items-center gap-2.5">
                                <span
                                    className={cn(
                                        'grid size-9 shrink-0 place-items-center rounded-xl',
                                        ROLE_TONE[role]
                                    )}
                                >
                                    <Icon
                                        className="size-[18px]"
                                        strokeWidth={2.25}
                                    />
                                </span>
                                <div className="min-w-0 flex-1 leading-tight">
                                    <strong className="text-sm">
                                        {ROLE_LABELS[role]}
                                    </strong>
                                    <div className="mt-0.5 text-[11.5px] text-neutral-500">
                                        <span
                                            className={
                                                guide.team === 'mafia'
                                                    ? 'text-rose-600'
                                                    : 'text-sky-700'
                                            }
                                        >
                                            {guide.team === 'mafia'
                                                ? '마피아 팀'
                                                : '시민 팀'}
                                        </span>
                                        {' · '}
                                        {count
                                            ? `${count}명`
                                            : '이번 판엔 없음'}
                                    </div>
                                </div>
                                {mine === role && (
                                    <span className="bg-kakao text-kakao-brown self-start rounded-full px-2 py-0.5 text-[11px] font-bold">
                                        내 역할
                                    </span>
                                )}
                            </div>
                            <p className="text-[13px] leading-relaxed">
                                {guide.ability}
                            </p>
                            <p className="flex gap-1.5 text-xs leading-relaxed text-neutral-500">
                                <Lightbulb className="mt-0.5 size-3.5 shrink-0" />
                                {guide.tip}
                            </p>
                        </li>
                    );
                })}
            </ul>
            <ol className="flex flex-col divide-y divide-neutral-100 rounded-xl bg-neutral-50 px-3">
                {flow.map(({ icon: Icon, title, text }) => (
                    <li key={title} className="flex gap-2.5 py-2.5 text-xs">
                        <Icon className="mt-px size-4 shrink-0 text-neutral-500" />
                        <strong className="w-7 shrink-0 font-semibold">
                            {title}
                        </strong>
                        <span className="leading-relaxed text-neutral-600">
                            {text}
                        </span>
                    </li>
                ))}
            </ol>
            <div className="flex justify-end">
                <button type="button" className="btn-ghost" onClick={onClose}>
                    닫기
                </button>
            </div>
        </Modal>
    );
};

export default MafiaRolesModal;
