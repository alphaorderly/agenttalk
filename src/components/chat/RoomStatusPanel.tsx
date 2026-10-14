import { useAtomValue, useSetAtom } from 'jotai';
import {
    ChevronDown,
    ChevronUp,
    Loader2,
    LockKeyhole,
    RefreshCw,
} from 'lucide-react';
import { useState } from 'react';
import { isMarkdownSummary, retryRoomStatus } from '@services/roomStatus';
import {
    idleNoteAtom,
    modalAtom,
    ownerStatusesAtom,
    pendingAtom,
    roomStatusRuntimeAtom,
    runningAtom,
} from '@stores/chat';
import type { Room } from '@/types/chat';
import { cn } from '@utils/cn/cn';
import Markdown from '../Markdown';

/** 방장 전용 메모. 참가자 메시지/프롬프트와 분리하고, 중요한 내용만 마크다운으로 보여준다. */
const RoomStatusPanel = ({ room }: { room: Room }) => {
    const [expanded, setExpanded] = useState(false);
    const cached = useAtomValue(ownerStatusesAtom)[room.id];
    const saved = isMarkdownSummary(cached) ? cached : undefined;
    const runtime = useAtomValue(roomStatusRuntimeAtom)[room.id];
    const run = useAtomValue(runningAtom)[room.id];
    const pending = useAtomValue(pendingAtom)[room.id];
    const idle = useAtomValue(idleNoteAtom)[room.id];
    const setModal = useSetAtom(modalAtom);
    const contentId = `room-status-${room.id}`;
    const pendingName = pending
        ? (room.agents.find((agent) => agent.id === pending.agentId)?.name ??
          '(나간 멤버)')
        : '';
    const execution = pending
        ? `${pendingName} · ${pending.status || '입력 중…'}`
        : run
          ? run.status
          : idle || '대기 중';

    return (
        <aside
            aria-label="방장 전용 메모"
            className="order-first flex shrink-0 flex-col border-y border-[#dde3e8] bg-white/90 xl:order-last xl:min-h-0 xl:w-80 xl:border-y-0 xl:border-l"
        >
            <button
                type="button"
                aria-expanded={expanded}
                aria-controls={contentId}
                onClick={() => setExpanded((value) => !value)}
                className="flex min-w-0 items-center gap-2 px-4 py-2 text-left xl:hidden"
            >
                <LockKeyhole size={14} className="shrink-0 text-violet-600" />
                <span className="shrink-0 text-[12px] font-semibold">
                    방 메모 · 나만 보기
                </span>
                <span className="min-w-0 flex-1 truncate text-[11px] text-neutral-500">
                    {execution}
                </span>
                {expanded ? (
                    <ChevronUp size={15} className="shrink-0" />
                ) : (
                    <ChevronDown size={15} className="shrink-0" />
                )}
            </button>
            <div className="hidden items-center gap-1.5 border-b border-neutral-100 px-4 py-3 xl:flex">
                <LockKeyhole size={14} className="text-violet-600" />
                <h2 className="flex-1 text-[13px] font-semibold">
                    방 메모 · 나만 보기
                </h2>
                {runtime?.loading && (
                    <Loader2
                        size={14}
                        className="animate-spin text-neutral-400"
                        aria-label="정리 중"
                    />
                )}
            </div>
            <div
                id={contentId}
                className={cn(
                    'max-h-[40dvh] flex-col gap-3 overflow-y-auto px-4 py-3 xl:max-h-none xl:min-h-0 xl:flex-1',
                    expanded ? 'flex' : 'hidden xl:flex'
                )}
            >
                <p
                    role="status"
                    aria-live="polite"
                    className="rounded-lg bg-neutral-50 px-2.5 py-1.5 text-[11.5px] leading-relaxed break-words text-neutral-600"
                >
                    {execution}
                </p>
                {runtime?.error && (
                    <div className="rounded-lg bg-red-50 p-2.5">
                        <p
                            role="alert"
                            className="text-[12px] break-words text-red-700"
                        >
                            {runtime.error}
                        </p>
                        {saved && (
                            <p className="mt-1 text-[11px] text-red-600">
                                마지막으로 정리한 메모를 보여주고 있어요.
                            </p>
                        )}
                        <div className="mt-2 flex flex-wrap gap-2">
                            <button
                                type="button"
                                disabled={runtime.loading}
                                onClick={() => void retryRoomStatus(room.id)}
                                className="flex items-center gap-1 rounded-md bg-white px-2 py-1 text-[11px] font-semibold text-red-700 disabled:opacity-50"
                            >
                                <RefreshCw size={12} /> 다시 시도
                            </button>
                            <button
                                type="button"
                                onClick={() =>
                                    setModal({
                                        type: 'settings',
                                        section: 'assistants',
                                    })
                                }
                                className="rounded-md bg-white px-2 py-1 text-[11px] text-neutral-700"
                            >
                                요약 모델 설정
                            </button>
                        </div>
                    </div>
                )}
                {saved?.summary.markdown ? (
                    <Markdown>{saved.summary.markdown}</Markdown>
                ) : (
                    <p className="text-[12px] leading-relaxed text-neutral-500">
                        {runtime?.loading
                            ? '대화를 읽고 중요한 내용을 정리하는 중…'
                            : room.messages.length
                              ? '대화 기록을 바탕으로 메모를 준비하고 있어요.'
                              : '대화가 시작되면 중요한 내용만 골라 정리해요.'}
                    </p>
                )}
                <div className="mt-auto border-t border-neutral-100 pt-2 text-[10.5px] leading-relaxed text-neutral-400">
                    {saved && (
                        <p className="break-words">
                            {runtime?.loading
                                ? '최신 내용을 반영하는 중…'
                                : `갱신 ${new Date(
                                      saved.updatedAt
                                  ).toLocaleTimeString('ko-KR', {
                                      hour: '2-digit',
                                      minute: '2-digit',
                                  })}`}
                            {saved.via && ` · ${saved.via}`}
                        </p>
                    )}
                    <p>
                        귓속말과 비밀 설정도 참고하지만 꼭 필요한 것만 🔒로
                        적어요. 참가자에게는 전달되지 않아요.
                    </p>
                </div>
            </div>
        </aside>
    );
};

export default RoomStatusPanel;
