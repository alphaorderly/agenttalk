import { useEffect, useRef } from 'react';
import { startPersistence } from '@services/persistence';
import { startRoomStatusObserver } from '@services/roomStatus';
import { useAtomValue } from 'jotai';
import { Loader2 } from 'lucide-react';
import { Toaster } from 'react-hot-toast';
import { currentRoomAtom, roomsLoadAtom } from '@stores/chat';
import { cn } from '@utils/cn/cn';
import ChatRoom from '@components/chat/ChatRoom';
import RoomEditorModal from '@components/room/RoomEditorModal';
import RoomList, { NavBar } from '@components/RoomList';
import SettingsModal from '@components/settings/SettingsModal';

const EmptyChat = () => (
    <div className="m-auto text-center text-[#5c7186]">
        <div className="bg-kakao text-kakao-brown mb-3 inline-grid size-20 place-items-center rounded-[28px] text-xl font-black tracking-tight">
            TALK
        </div>
        <p>채팅방을 선택하거나 새로 만들어 주세요.</p>
    </div>
);

/** 서버(SQLite)에서 대화 기록을 불러오는 중이거나 실패했을 때 */
const LoadState = ({ onRetry }: { onRetry: () => void }) => {
    const load = useAtomValue(roomsLoadAtom);
    if (load.state === 'ready') return null;
    return (
        <div className="fixed inset-0 z-10 grid place-items-center bg-white/90">
            {load.state === 'loading' ? (
                <p className="flex items-center gap-2 text-sm text-neutral-500">
                    <Loader2 size={16} className="animate-spin" /> 대화 기록을
                    불러오는 중…
                </p>
            ) : (
                <div className="max-w-sm text-center">
                    <p className="mb-1 font-semibold">
                        대화 기록을 불러올 수 없어요
                    </p>
                    <p className="mb-4 text-sm break-words text-neutral-500">
                        {load.error} · <code>yarn dev</code>로 API 서버가 함께
                        실행 중인지 확인하세요.
                    </p>
                    <button
                        type="button"
                        className="btn-primary"
                        onClick={onRetry}
                    >
                        다시 시도
                    </button>
                </div>
            )}
        </div>
    );
};

const App = () => {
    const room = useAtomValue(currentRoomAtom);
    const persistence = useRef<ReturnType<typeof startPersistence>>(null);
    useEffect(() => startRoomStatusObserver(), []);
    useEffect(() => {
        const instance = startPersistence();
        persistence.current = instance;
        return instance.dispose;
    }, []);

    return (
        <div className="flex h-dvh overflow-hidden bg-white">
            <NavBar />
            {/* 모바일에서는 목록과 채팅방 중 하나만 보인다 */}
            <RoomList className={cn(room && 'hidden md:flex')} />
            <main
                className={cn(
                    'bg-chat min-w-0 flex-1',
                    room ? 'flex' : 'hidden md:flex'
                )}
            >
                {room ? <ChatRoom room={room} /> : <EmptyChat />}
            </main>

            <SettingsModal />
            <RoomEditorModal />
            <LoadState onRetry={() => persistence.current?.retry()} />
            <Toaster position="top-center" />
        </div>
    );
};

export default App;
