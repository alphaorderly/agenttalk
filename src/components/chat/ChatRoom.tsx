import { useAtomValue, useSetAtom } from 'jotai';
import { ChevronLeft, Download, Menu, Play, Square } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { describeModel } from '@shared/providers';
import { useProfiles } from '@services/api';
import {
    onUserMessage,
    startConversation,
    stopConversation,
} from '@services/conversation';
import {
    appendMessage,
    currentRoomIdAtom,
    idleNoteAtom,
    modalAtom,
    ownerStatusesAtom,
    runningAtom,
    updateRoom,
    userNameAtom,
} from '@stores/chat';
import type { Agent, Room } from '@/types/chat';
import { cn } from '@utils/cn/cn';
import { downloadRoom, type ExportFormat } from '@utils/export/export';
import { parseWhisper } from '@utils/prompt/prompt';
import { modeOf } from '@/modes';
import { modeUiOf } from '@/modes/ui';
import { agentImage } from '@utils/face/face';
import { Avatar } from '../Avatar';
import MessageList from './MessageList';
import { PollButton, PollComposer } from './Poll';
import RoomStatusPanel from './RoomStatusPanel';

const EXPORT_OPTIONS: { format: ExportFormat; label: string; hint: string }[] =
    [
        { format: 'txt', label: '텍스트 (.txt)', hint: '읽기 좋은 대화 기록' },
        { format: 'json', label: 'JSON (.json)', hint: '설정까지 전체 데이터' },
    ];

/** 대화 기록을 파일로 내보내는 메뉴 */
const ExportMenu = ({ room }: { room: Room }) => {
    const userName = useAtomValue(userNameAtom);
    const ownerStatus = useAtomValue(ownerStatusesAtom)[room.id];
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;
        const close = (e: PointerEvent) => {
            if (!ref.current?.contains(e.target as Node)) setOpen(false);
        };
        const onKey = (e: KeyboardEvent) =>
            e.key === 'Escape' && setOpen(false);
        document.addEventListener('pointerdown', close);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('pointerdown', close);
            document.removeEventListener('keydown', onKey);
        };
    }, [open]);

    return (
        <div ref={ref} className="relative">
            <button
                type="button"
                className="icon-btn"
                title="대화 기록 내보내기"
                aria-expanded={open}
                onClick={() => setOpen((v) => !v)}
            >
                <Download size={19} />
            </button>
            {open && (
                <div className="absolute right-0 z-20 mt-1 w-52 overflow-hidden rounded-xl border border-neutral-200 bg-white py-1 shadow-lg">
                    {EXPORT_OPTIONS.map((o) => (
                        <button
                            key={o.format}
                            type="button"
                            className="flex w-full flex-col items-start px-3 py-2 text-left hover:bg-neutral-100"
                            onClick={() => {
                                const mode = modeOf(room);
                                if (
                                    !mode.userSeesAll(room) &&
                                    !confirm(mode.exportWarning)
                                )
                                    return;
                                downloadRoom(
                                    room,
                                    userName,
                                    o.format,
                                    ownerStatus
                                );
                                setOpen(false);
                            }}
                        >
                            <span className="text-sm font-semibold">
                                {o.label}
                            </span>
                            <span className="text-xs text-neutral-500">
                                {o.hint}
                            </span>
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
};

const RoomHeader = ({ room }: { room: Room }) => {
    const isRunning = useAtomValue(runningAtom)[room.id] !== undefined;
    const setModal = useSetAtom(modalAtom);
    const setCurrentId = useSetAtom(currentRoomIdAtom);
    const { data } = useProfiles();
    const profile = data?.profiles.find(
        (p) => p.id === (room.profileId ?? data.defaultProfileId)
    );

    return (
        <header className="flex items-center gap-2 px-4 pt-3.5 pb-2.5">
            <button
                type="button"
                className="icon-btn md:hidden"
                title="목록"
                onClick={() => setCurrentId(null)}
            >
                <ChevronLeft size={26} />
            </button>
            <div className="flex min-w-0 flex-1 items-baseline gap-1.5">
                <strong className="truncate">{room.name}</strong>
                <span className="text-chat-ink text-[13px]">
                    {room.agents.length + 1}
                </span>
                {profile && (
                    <span className="text-chat-ink/80 hidden truncate text-xs sm:inline">
                        ·{' '}
                        {describeModel(
                            profile.provider,
                            room.model || profile.defaultModel,
                            room.reasoning ?? profile.defaultReasoning
                        )}
                    </span>
                )}
            </div>
            <button
                type="button"
                disabled={!isRunning && room.agents.length === 0}
                onClick={() =>
                    isRunning
                        ? stopConversation(room.id)
                        : startConversation(room.id, { manual: true })
                }
                className={cn(
                    'flex items-center gap-1 rounded-full px-3.5 py-1.5 text-[13px] font-semibold disabled:opacity-50',
                    isRunning
                        ? 'bg-neutral-800 text-white'
                        : 'bg-kakao text-kakao-brown'
                )}
            >
                {isRunning ? (
                    <Square size={12} fill="currentColor" />
                ) : (
                    <Play size={12} fill="currentColor" />
                )}
                {isRunning
                    ? '정지'
                    : modeOf(room).isLive(room)
                      ? modeOf(room).liveRunLabel
                      : room.messages.length
                        ? '이어가기'
                        : '대화 시작'}
            </button>
            <ExportMenu room={room} />
            <button
                type="button"
                className="icon-btn"
                title="채팅방 설정"
                onClick={() => setModal({ type: 'room', roomId: room.id })}
            >
                <Menu size={20} />
            </button>
        </header>
    );
};

/** 진행 모델의 현재 판단(누구 차례인지) 또는 대화가 멈춘 이유 */
const RunStatus = ({ roomId }: { roomId: string }) => {
    const run = useAtomValue(runningAtom)[roomId];
    const idle = useAtomValue(idleNoteAtom)[roomId];
    const text = run ? `💬 ${run.status}` : idle ? `💤 ${idle}` : null;
    if (!text) return null;
    return (
        <div
            className="text-chat-ink truncate px-4 pb-1.5 text-[11.5px]"
            title={text}
        >
            {text}
        </div>
    );
};

/** 커서 바로 앞의 "@이름" 또는 "@@이름" 입력 중인 부분 */
function mentionQuery(text: string, caret: number) {
    const m = text.slice(0, caret).match(/(^|\s)(@@?)([^\s@]*)$/);
    if (!m) return null;
    return {
        marker: m[2],
        query: m[3],
        start: caret - m[2].length - m[3].length,
    };
}

const Composer = ({ room }: { room: Room }) => {
    const [text, setText] = useState('');
    const [caret, setCaret] = useState(0);
    const [active, setActive] = useState(0);
    const [dismissed, setDismissed] = useState(false);
    const [pollOpen, setPollOpen] = useState(false);
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const userName = useAtomValue(userNameAtom);

    const mention = dismissed ? null : mentionQuery(text, caret);
    const candidates = mention
        ? room.agents.filter((a) =>
              a.name.toLowerCase().includes(mention.query.toLowerCase())
          )
        : [];
    const mode = modeOf(room);
    const { whispers } = mode;
    const composer = mode.composer(room);
    // 귓속말이 없는 모드도 있다 (예: 마피아끼리 밤 대화는 받는 사람을 모드가 정한다)
    const whisper = whispers
        ? parseWhisper(text, room, userName, 'me').to
        : undefined;
    const misplacedWhisper =
        whispers &&
        !whisper &&
        room.agents.some((agent) => {
            const index = text.indexOf(`@@${agent.name}`);
            return index > 0 && text.slice(0, index).trim().length > 0;
        });

    const edit = (value: string, pos: number) => {
        setText(value);
        setCaret(pos);
        setActive(0);
        setDismissed(false);
    };

    const pick = (agent: Agent) => {
        if (!mention) return;
        const insert = `${mention.marker}${agent.name} `;
        const value = text.slice(0, mention.start) + insert + text.slice(caret);
        const pos = mention.start + insert.length;
        edit(value, pos);
        requestAnimationFrame(() => {
            inputRef.current?.focus();
            inputRef.current?.setSelectionRange(pos, pos);
        });
    };

    const send = () => {
        const t = text.trim();
        if (!t || !composer.allowed) return;
        // 맨 앞의 "@@이름"은 귓속말: 그 에이전트만 보고 답한다
        const parsed = whispers
            ? parseWhisper(t, room, userName, 'me')
            : { text: t, to: composer.to };
        if (!parsed.text) return;
        appendMessage(room.id, {
            sender: 'me',
            text: parsed.text,
            to: parsed.to,
        });
        edit('', 0);
        // 내 말이 가장 우선: 진행 중이면 하던 차례를 끊고 바로 반영한다 (기다리기 모드면 부른 사람만 답함)
        void onUserMessage(room.id);
    };

    const autoReply = room.autoReply !== false;

    if (!composer.allowed)
        return (
            <footer className="border-t border-[#dde3e8] bg-white px-4 py-3.5 text-center text-[13px] text-neutral-500">
                {composer.reason}
            </footer>
        );

    return (
        <footer className="relative flex flex-wrap gap-2.5 border-t border-[#dde3e8] bg-white px-3 py-2.5 sm:flex-nowrap">
            {pollOpen && (
                <PollComposer room={room} onClose={() => setPollOpen(false)} />
            )}
            {candidates.length > 0 && !pollOpen && (
                <ul className="absolute bottom-full left-3 mb-1 max-h-60 w-64 overflow-y-auto rounded-lg border border-[#dde3e8] bg-white py-1 shadow-lg">
                    <li className="px-3 pt-1 pb-1.5 text-[11px] text-[#6b7f92]">
                        {!whispers
                            ? '@ 부르기 — 모두가 봐요'
                            : mention?.marker === '@@'
                              ? '🔒 귓속말 — 이 사람만 봐요'
                              : '@ 부르기 — 모두가 봐요 (@@는 귓속말)'}
                    </li>
                    {candidates.map((a, i) => (
                        <li key={a.id}>
                            <button
                                type="button"
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => pick(a)}
                                onMouseEnter={() => setActive(i)}
                                className={cn(
                                    'flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm',
                                    i === active && 'bg-neutral-100'
                                )}
                            >
                                <span className="scale-75">
                                    <Avatar
                                        emoji={a.emoji}
                                        color={a.color}
                                        image={agentImage(room, a)}
                                    />
                                </span>
                                <span className="truncate">{a.name}</span>
                            </button>
                        </li>
                    ))}
                </ul>
            )}
            <div className="flex min-w-0 flex-1 basis-full flex-col sm:basis-0">
                {composer.toLabel && (
                    <div className="mb-1 text-[11.5px] text-red-600">
                        {composer.toLabel}
                    </div>
                )}
                {whisper && (
                    <div className="mb-1 text-[11.5px] text-violet-600">
                        🔒{' '}
                        {whisper
                            .map(
                                (id) =>
                                    room.agents.find((a) => a.id === id)
                                        ?.name ?? id
                            )
                            .join(', ')}
                        에게만 보내는 귓속말
                    </div>
                )}
                {misplacedWhisper && (
                    <p
                        className="mb-1 text-[11.5px] leading-snug text-amber-700"
                        role="status"
                    >
                        현재 공개 메시지예요. 귓속말은 맨 앞에 @@이름을 써
                        주세요.
                    </p>
                )}
                <textarea
                    ref={inputRef}
                    rows={2}
                    value={text}
                    onChange={(e) =>
                        edit(e.target.value, e.target.selectionStart)
                    }
                    onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
                    onBlur={() => setDismissed(true)}
                    onFocus={() => setDismissed(false)}
                    onKeyDown={(e) => {
                        if (e.nativeEvent.isComposing) return;
                        if (candidates.length > 0) {
                            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                                e.preventDefault();
                                const d = e.key === 'ArrowDown' ? 1 : -1;
                                setActive(
                                    (active + d + candidates.length) %
                                        candidates.length
                                );
                                return;
                            }
                            if (e.key === 'Enter' || e.key === 'Tab') {
                                e.preventDefault();
                                pick(candidates[active] ?? candidates[0]);
                                return;
                            }
                            if (e.key === 'Escape') {
                                e.preventDefault();
                                setDismissed(true);
                                return;
                            }
                        }
                        if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            send();
                        }
                    }}
                    placeholder={
                        composer.placeholder ??
                        '메시지를 입력하세요 (@이름 부르기 · @@이름 귓속말)'
                    }
                    className="min-w-0 flex-1 resize-none text-sm leading-snug outline-none"
                />
            </div>
            {composer.tools && (
                <PollButton onClick={() => setPollOpen((v) => !v)} />
            )}
            <button
                type="button"
                hidden={!composer.tools}
                onClick={() =>
                    updateRoom(room.id, (r) => ({
                        ...r,
                        autoReply: !autoReply,
                    }))
                }
                title={
                    autoReply
                        ? '내가 말하면 에이전트들이 알아서 반응해요. 누르면 부를 때까지 기다려요.'
                        : '▶를 누르거나 @이름으로 부를 때까지 기다려요. 누르면 자동 반응으로 바꿔요.'
                }
                className={cn(
                    'ml-auto shrink-0 self-end rounded-md px-2.5 py-2 text-[12px] font-medium whitespace-nowrap sm:ml-0',
                    autoReply
                        ? 'bg-sky-50 text-sky-700'
                        : 'bg-neutral-100 text-neutral-600'
                )}
            >
                {autoReply ? '💬 자동 반응' : '🤫 부르면 답함'}
            </button>
            <button
                type="button"
                onClick={send}
                disabled={!text.trim()}
                className="bg-kakao text-kakao-brown shrink-0 self-end rounded-md px-3.5 py-2 text-[13px] font-semibold disabled:bg-neutral-100 disabled:text-neutral-400"
            >
                전송
            </button>
        </footer>
    );
};

const ChatRoom = ({ room }: { room: Room }) => {
    const ModeBar = modeUiOf(room.mode).Bar;
    return (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <RoomHeader room={room} />
            <div className="flex min-h-0 flex-1 flex-col xl:flex-row">
                <div className="order-last flex min-h-0 min-w-0 flex-1 flex-col xl:order-first">
                    {ModeBar && <ModeBar room={room} />}
                    <MessageList room={room} />
                    <RunStatus roomId={room.id} />
                    <Composer key={room.id} room={room} />
                </div>
                {/* 방 메모는 모든 비밀을 읽으므로, 모드가 비밀을 가리는 동안(예: 마피아 플레이어)은 숨긴다 */}
                {modeOf(room).userSeesAll(room) && (
                    <RoomStatusPanel key={room.id} room={room} />
                )}
            </div>
        </div>
    );
};

export default ChatRoom;
