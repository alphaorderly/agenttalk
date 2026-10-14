import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { MessageCircle, Plus, Settings } from 'lucide-react';
import {
    currentRoomIdAtom,
    modalAtom,
    roomsAtom,
    runningAtom,
} from '@stores/chat';
import { cn } from '@utils/cn/cn';
import { formatListTime } from '@utils/time/time';
import { GroupAvatar } from './Avatar';
import { modeOf } from '@/modes';

export const NavBar = () => {
    const setModal = useSetAtom(modalAtom);
    return (
        <nav className="bg-nav hidden w-16 shrink-0 flex-col items-center gap-2 pt-7 pb-4 md:flex">
            <button
                type="button"
                className="icon-btn size-11 rounded-xl bg-black/5"
                title="채팅"
            >
                <MessageCircle size={22} fill="currentColor" />
            </button>
            <div className="flex-1" />
            <button
                type="button"
                className="icon-btn size-11 rounded-xl text-neutral-500"
                title="설정"
                onClick={() => setModal({ type: 'settings' })}
            >
                <Settings size={22} />
            </button>
        </nav>
    );
};

const RoomList = ({ className }: { className?: string }) => {
    const rooms = useAtomValue(roomsAtom);
    const running = useAtomValue(runningAtom);
    const [currentId, setCurrentId] = useAtom(currentRoomIdAtom);
    const setModal = useSetAtom(modalAtom);

    const sorted = [...rooms].sort((a, b) => b.updatedAt - a.updatedAt);

    return (
        <section
            className={cn(
                'flex w-full shrink-0 flex-col border-r border-neutral-200 md:w-80',
                className
            )}
        >
            <header className="flex items-center justify-between px-[18px] pt-[22px] pb-3">
                <h1 className="text-xl font-bold">채팅</h1>
                <div className="flex">
                    <button
                        type="button"
                        className="icon-btn md:hidden"
                        title="설정"
                        onClick={() => setModal({ type: 'settings' })}
                    >
                        <Settings size={20} />
                    </button>
                    <button
                        type="button"
                        className="icon-btn"
                        title="새 채팅방"
                        onClick={() => setModal({ type: 'room', roomId: null })}
                    >
                        <Plus size={22} />
                    </button>
                </div>
            </header>

            <ul className="flex-1 overflow-y-auto">
                {sorted.map((room) => {
                    const mode = modeOf(room);
                    const last = [...room.messages]
                        .reverse()
                        .find(
                            (m) =>
                                m.sender !== 'system' &&
                                mode.userCanSee(room, m)
                        );
                    return (
                        <li key={room.id}>
                            <button
                                type="button"
                                onClick={() => setCurrentId(room.id)}
                                className={cn(
                                    'flex w-full items-center gap-3 px-[18px] py-2.5 text-left hover:bg-neutral-100',
                                    room.id === currentId && 'bg-neutral-100'
                                )}
                            >
                                <GroupAvatar room={room} />
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-baseline justify-between gap-2">
                                        <strong className="truncate text-sm">
                                            {room.name}
                                            <span className="ml-1 text-[13px] font-normal text-neutral-400">
                                                {room.agents.length + 1}
                                            </span>
                                            {room.id in running && (
                                                <span
                                                    className="ml-1.5 inline-block size-[7px] rounded-full bg-green-500 align-middle"
                                                    title="대화 중"
                                                />
                                            )}
                                        </strong>
                                        <time className="shrink-0 text-[11px] text-neutral-400">
                                            {formatListTime(
                                                last?.ts ?? room.updatedAt
                                            )}
                                        </time>
                                    </div>
                                    <div className="mt-1 truncate text-[12.5px] text-neutral-400">
                                        {(last &&
                                            (last.text ||
                                                (last.image ? '사진' : ''))) ??
                                            (room.topic ||
                                                '대화를 시작해 보세요')}
                                    </div>
                                </div>
                            </button>
                        </li>
                    );
                })}
            </ul>
        </section>
    );
};

export default RoomList;
