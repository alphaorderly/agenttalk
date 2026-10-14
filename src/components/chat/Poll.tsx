import { useAtomValue } from 'jotai';
import { Plus, Vote, X } from 'lucide-react';
import { useState } from 'react';
import { pendingVoters, startPoll } from '@services/conversation';
import { appendMessage, runningAtom } from '@stores/chat';
import type { Message, Poll, Room } from '@/types/chat';

/** 선택지 개수 범위 */
const MIN_OPTIONS = 2;
const MAX_OPTIONS = 6;

/** 질문과 선택지를 적어 투표를 올리는 작은 창 */
export const PollComposer = ({
    room,
    onClose,
}: {
    room: Room;
    onClose: () => void;
}) => {
    const [question, setQuestion] = useState('');
    const [options, setOptions] = useState(['', '']);

    const filled = options.map((o) => o.trim()).filter(Boolean);
    const duplicated = new Set(filled).size !== filled.length;
    const error = !question.trim()
        ? '질문을 적어 주세요'
        : filled.length < MIN_OPTIONS
          ? `선택지를 ${MIN_OPTIONS}개 이상 적어 주세요`
          : duplicated
            ? '같은 선택지가 있어요'
            : room.agents.length === 0
              ? '투표할 에이전트가 없어요'
              : null;

    const submit = () => {
        if (error) return;
        const m = appendMessage(room.id, {
            sender: 'me',
            text: question.trim(),
            poll: { question: question.trim(), options: filled, votes: [] },
        });
        onClose();
        void startPoll(room.id, m.id);
    };

    return (
        <div
            className="absolute bottom-full left-3 z-20 mb-1 w-[min(22rem,calc(100%-1.5rem))] rounded-xl border border-[#dde3e8] bg-white p-3 shadow-lg"
            role="dialog"
            aria-label="투표 만들기"
            onKeyDown={(e) => e.key === 'Escape' && onClose()}
        >
            <div className="mb-2 flex items-center justify-between">
                <strong className="text-sm">📊 투표 만들기</strong>
                <button
                    type="button"
                    className="icon-btn"
                    title="닫기"
                    onClick={onClose}
                >
                    <X size={16} />
                </button>
            </div>
            <input
                autoFocus
                className="field mb-2 w-full"
                placeholder="질문 (예: 점심 뭐 먹을까?)"
                maxLength={200}
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
            />
            <div className="flex flex-col gap-1.5">
                {options.map((o, i) => (
                    <div key={i} className="flex items-center gap-1.5">
                        <span className="w-4 text-right text-xs text-neutral-500">
                            {i + 1}
                        </span>
                        <input
                            className="field min-w-0 flex-1"
                            placeholder={`선택지 ${i + 1}`}
                            maxLength={100}
                            value={o}
                            onChange={(e) =>
                                setOptions(
                                    options.map((v, j) =>
                                        j === i ? e.target.value : v
                                    )
                                )
                            }
                            onKeyDown={(e) => {
                                if (e.nativeEvent.isComposing) return;
                                if (e.key === 'Enter') {
                                    e.preventDefault();
                                    submit();
                                }
                            }}
                        />
                        {options.length > MIN_OPTIONS && (
                            <button
                                type="button"
                                className="icon-btn"
                                title="선택지 빼기"
                                onClick={() =>
                                    setOptions(
                                        options.filter((_, j) => j !== i)
                                    )
                                }
                            >
                                <X size={14} />
                            </button>
                        )}
                    </div>
                ))}
            </div>
            <div className="mt-2.5 flex items-center justify-between gap-2">
                {options.length < MAX_OPTIONS ? (
                    <button
                        type="button"
                        className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-neutral-600 hover:bg-black/5"
                        onClick={() => setOptions([...options, ''])}
                    >
                        <Plus size={13} /> 선택지 추가
                    </button>
                ) : (
                    <span />
                )}
                <button
                    type="button"
                    className="bg-kakao text-kakao-brown rounded-md px-3 py-1.5 text-[13px] font-semibold disabled:bg-neutral-100 disabled:text-neutral-400"
                    disabled={!!error}
                    title={error ?? '에이전트들이 하나씩 골라요'}
                    onClick={submit}
                >
                    투표 올리기
                </button>
            </div>
        </div>
    );
};

/** 컴포저의 투표 버튼 */
export const PollButton = ({ onClick }: { onClick: () => void }) => (
    <button
        type="button"
        className="shrink-0 self-end rounded-md bg-neutral-100 px-2.5 py-2 text-neutral-600 hover:bg-neutral-200"
        title="투표 만들기 · 에이전트들이 하나씩 골라요"
        aria-label="투표 만들기"
        onClick={onClick}
    >
        <Vote size={16} />
    </button>
);

/** 채팅에 올라간 투표: 선택지별 득표와 누가 골랐는지 */
export const PollCard = ({
    room,
    message,
    poll,
}: {
    room: Room;
    message: Message;
    poll: Poll;
}) => {
    const running = useAtomValue(runningAtom)[room.id] !== undefined;
    const remaining = pendingVoters(room, message.id).length;
    const max = Math.max(1, ...poll.options.map((_, i) => count(poll, i)));

    return (
        <div className="w-[min(18rem,70vw)] rounded-[14px] bg-white px-3 py-2.5 text-sm">
            <div className="text-[11px] font-semibold text-[#6b7f92]">
                📊 투표
            </div>
            <div className="mt-0.5 mb-2 font-semibold break-words">
                {poll.question}
            </div>
            <ul className="flex flex-col gap-2">
                {poll.options.map((option, i) => {
                    const voters = poll.votes.filter((v) => v.choice === i);
                    return (
                        <li key={i}>
                            <div className="flex items-baseline justify-between gap-2">
                                <span className="break-words">
                                    {i + 1}. {option}
                                </span>
                                <span className="shrink-0 text-xs text-[#6b7f92]">
                                    {voters.length}표
                                </span>
                            </div>
                            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-neutral-100">
                                <div
                                    className="bg-kakao h-full rounded-full transition-[width]"
                                    style={{
                                        width: `${(voters.length / max) * 100}%`,
                                    }}
                                />
                            </div>
                            {voters.length > 0 && (
                                <div className="mt-1 flex flex-wrap gap-1">
                                    {voters.map((v) => (
                                        <span
                                            key={v.voter}
                                            className="rounded-full bg-neutral-100 px-1.5 py-0.5 text-[11px] text-[#3d4a57]"
                                        >
                                            {room.agents.find(
                                                (a) => a.id === v.voter
                                            )?.emoji ?? '👤'}{' '}
                                            {v.name}
                                        </span>
                                    ))}
                                </div>
                            )}
                        </li>
                    );
                })}
            </ul>
            <div className="mt-2.5 flex items-center justify-between gap-2 text-[11px] text-[#6b7f92]">
                <span>
                    {poll.votes.length}명 투표
                    {remaining > 0 && ` · ${remaining}명 남음`}
                </span>
                {remaining > 0 && !running && (
                    <button
                        type="button"
                        className="rounded-md bg-neutral-100 px-2 py-0.5 font-medium text-neutral-700 hover:bg-neutral-200"
                        onClick={() => void startPoll(room.id, message.id)}
                    >
                        남은 사람 투표 받기
                    </button>
                )}
            </div>
        </div>
    );
};

const count = (poll: Poll, choice: number) =>
    poll.votes.filter((v) => v.choice === choice).length;
