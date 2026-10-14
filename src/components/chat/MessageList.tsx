import { useAtomValue } from 'jotai';
import { LockKeyhole } from 'lucide-react';
import { useLayoutEffect, useRef } from 'react';
import { pendingAtom, userNameAtom } from '@stores/chat';
import type { SourceLink } from '@shared/providers';
import type { Message, PendingMessage, Room } from '@/types/chat';
import { cn } from '@utils/cn/cn';
import { formatTime, sameMinute } from '@utils/time/time';
import { recipientName, senderName } from '@utils/prompt/prompt';
import { imageUrl } from '@shared/images';
import { agentImage } from '@utils/face/face';
import { modeOf } from '@/modes';
import { modeUiOf } from '@/modes/ui';
import { Avatar } from '../Avatar';
import { PollCard } from './Poll';

const TypingDots = () => (
    <div className="inline-flex gap-1 rounded-[14px] bg-white px-3.5 py-3">
        {[0, 0.2, 0.4].map((d) => (
            <i
                key={d}
                className="size-1.5 rounded-full bg-slate-400"
                style={{ animation: `blink 1.2s ${d}s infinite` }}
            />
        ))}
    </div>
);

const hostname = (url: string) => {
    try {
        return new URL(url).hostname.replace(/^www\./, '');
    } catch {
        return url;
    }
};

/** 검색으로 공유한 링크 카드 */
const LinkCards = ({ sources }: { sources: SourceLink[] }) => (
    <div className="mt-1 flex flex-col gap-1">
        {sources.map((s) => (
            <a
                key={s.url}
                href={s.url}
                target="_blank"
                rel="noopener noreferrer"
                className="block max-w-[260px] rounded-[10px] bg-white px-3 py-2 hover:bg-neutral-50"
            >
                <div className="line-clamp-2 text-[13px] leading-snug font-medium break-words text-[#1f2933]">
                    🔗 {s.title}
                </div>
                <div className="mt-0.5 truncate text-[11px] text-[#6b7f92]">
                    {hostname(s.url)}
                </div>
            </a>
        ))}
    </div>
);

/** 에이전트가 만들어 보낸 사진. 누르면 원본을 새 탭에서 연다 */
const PhotoBubble = ({
    image,
    whisper,
}: {
    image: NonNullable<Message['image']>;
    whisper: boolean;
}) => (
    <a
        href={imageUrl(image.id)}
        target="_blank"
        rel="noopener noreferrer"
        title={image.prompt}
        className={cn(
            'block overflow-hidden rounded-[14px] bg-white',
            whisper && 'border border-dashed border-violet-400 p-1'
        )}
    >
        <img
            src={imageUrl(image.id)}
            alt={image.prompt}
            loading="lazy"
            className="max-h-80 w-[min(260px,60vw)] object-cover"
        />
    </a>
);

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 본문의 "@이름" 호출을 강조한다 */
function withMentions(text: string, names: string[]) {
    const sorted = names.filter(Boolean).sort((a, b) => b.length - a.length);
    if (!sorted.length) return text;
    const re = new RegExp(`(@{1,2}(?:${sorted.map(escapeRegExp).join('|')}))`);
    return text.split(re).map((part, i) =>
        i % 2 ? (
            <span key={i} className="font-semibold text-sky-700">
                {part}
            </span>
        ) : (
            part
        )
    );
}

/** 귓속말 표시: "🔒 철수 → 영희" (사용자는 모든 귓속말을 본다) */
const WhisperTag = ({
    room,
    message: m,
    userName,
    align,
}: {
    room: Room;
    message: Message;
    userName: string;
    align: 'left' | 'right';
}) => {
    // 귓속말 대신 모드의 비공개 대화가 있는 방 (예: 마피아끼리 밤 대화)
    const channel = modeOf(room).privateChannel;
    return (
        <div
            className={cn(
                'mb-0.5 text-[11px]',
                channel ? channel.className : 'text-violet-600',
                align === 'right' ? 'text-right' : 'ml-0.5'
            )}
        >
            {channel ? channel.badge : '🔒'} {senderName(room, m, userName)} →{' '}
            {(m.to ?? [])
                .map((id) => recipientName(room, id, userName))
                .join(', ')}
            {channel ? '' : ' 귓속말'}
        </div>
    );
};

const whisperKey = (m: Message | undefined) => m?.to?.join(',') ?? '';

interface BubbleProps {
    room: Room;
    message: Message;
    first: boolean;
    showTime: boolean;
    streaming?: boolean;
    /** 입력 중 표시 옆에 보여줄 상태 (예: 검색 중) */
    status?: string;
}

const Bubble = ({
    room,
    message: m,
    first,
    showTime,
    streaming,
    status,
}: BubbleProps) => {
    const userName = useAtomValue(userNameAtom);
    const whisper = !!m.to?.length;
    const names = [userName, ...room.agents.map((a) => a.name)];

    if (m.sender === 'system') {
        // 모드의 개인 알림(예: 역할, 조사 결과, 밤 기록)은 받은 사람만 본다
        const secret = m.notice && whisper;
        const notice =
            m.notice && !m.error
                ? modeUiOf(room.mode).noticeStyle?.(m.text)
                : null;
        if (notice) {
            const Icon = notice.icon;
            return (
                <div className="my-3.5 text-center">
                    <span
                        className={cn(
                            'inline-flex max-w-[90%] items-start gap-1.5 rounded-2xl px-3 py-1.5 text-left text-xs leading-snug shadow-[0_1px_2px_rgb(0_0_0/0.08)]',
                            secret ? 'bg-violet-600 text-white' : notice.tone
                        )}
                    >
                        {secret && (
                            <LockKeyhole
                                className="mt-px size-3.5 shrink-0 opacity-70"
                                aria-label="나만 보는 알림"
                            />
                        )}
                        <Icon
                            className="mt-px size-3.5 shrink-0"
                            strokeWidth={2.25}
                        />
                        <span>{notice.text}</span>
                    </span>
                </div>
            );
        }
        return (
            <div className="my-3.5 text-center">
                <span
                    className={cn(
                        'inline-block max-w-[90%] rounded-full px-3 py-1 text-xs text-white',
                        m.error
                            ? 'bg-red-500/85'
                            : secret
                              ? 'bg-violet-600/80'
                              : m.notice
                                ? 'bg-[#3c4a5a]/70'
                                : 'bg-black/15'
                    )}
                >
                    {secret && '🔒 '}
                    {m.text}
                </span>
            </div>
        );
    }

    const time = showTime && !streaming && (
        <span className="shrink-0 text-[10.5px] whitespace-nowrap text-[#556677]">
            {formatTime(m.ts)}
        </span>
    );

    if (m.sender === 'me') {
        return (
            <div
                className={cn('flex justify-end', first ? 'mt-3' : 'mt-[3px]')}
            >
                <div className="max-w-[80%] md:max-w-[70%]">
                    {whisper && first && (
                        <WhisperTag
                            room={room}
                            message={m}
                            userName={userName}
                            align="right"
                        />
                    )}
                    <div className="flex flex-row-reverse items-end gap-1.5">
                        {m.poll ? (
                            <PollCard room={room} message={m} poll={m.poll} />
                        ) : (
                            <div
                                className={cn(
                                    'rounded-[14px] px-[11px] py-2 text-sm leading-[1.45] break-words whitespace-pre-wrap',
                                    whisper
                                        ? 'border border-dashed border-violet-400 bg-violet-100'
                                        : 'bg-kakao',
                                    first && 'rounded-tr-[4px]'
                                )}
                            >
                                {withMentions(m.text, names)}
                            </div>
                        )}
                        {time}
                    </div>
                </div>
            </div>
        );
    }

    const agent = room.agents.find((a) => a.id === m.sender);
    const SenderTag = modeUiOf(room.mode).SenderTag;
    return (
        <div className={cn('flex gap-2', first ? 'mt-3' : 'mt-[3px]')}>
            {first ? (
                <Avatar
                    emoji={agent?.emoji ?? '👤'}
                    color={agent?.color ?? '#ddd'}
                    image={agentImage(room, agent, m.face)}
                />
            ) : (
                <div
                    className={cn(
                        'shrink-0',
                        agentImage(room, agent) ? 'w-12' : 'w-10'
                    )}
                />
            )}
            <div className="max-w-[80%] min-w-0 md:max-w-[70%]">
                {first && (
                    <div className="mb-1 ml-0.5 text-[12.5px] text-[#3d4a57]">
                        {senderName(room, m, userName)}
                        {SenderTag && (
                            <SenderTag room={room} senderId={m.sender} />
                        )}
                        {m.via && (
                            <span className="ml-1.5 text-[10.5px] text-[#6b7f92]">
                                {m.via}
                            </span>
                        )}
                    </div>
                )}
                {whisper && first && (
                    <WhisperTag
                        room={room}
                        message={m}
                        userName={userName}
                        align="left"
                    />
                )}
                <div className="flex items-end gap-1.5">
                    {streaming ? (
                        <>
                            <TypingDots />
                            {status && (
                                <span className="pb-1 text-[11px] text-[#556677]">
                                    {status}
                                </span>
                            )}
                        </>
                    ) : m.image ? (
                        <PhotoBubble image={m.image} whisper={whisper} />
                    ) : (
                        <div
                            className={cn(
                                'rounded-[14px] px-[11px] py-2 text-sm leading-[1.45] break-words whitespace-pre-wrap',
                                whisper
                                    ? 'border border-dashed border-violet-400 bg-violet-50'
                                    : 'bg-white',
                                first && 'rounded-tl-[4px]'
                            )}
                        >
                            {withMentions(m.text, names)}
                        </div>
                    )}
                    {time}
                </div>
                {m.sources && m.sources.length > 0 && (
                    <LinkCards sources={m.sources} />
                )}
            </div>
        </div>
    );
};

function pendingAsMessage(p: PendingMessage): Message {
    return {
        id: p.id,
        sender: p.agentId,
        text: p.text,
        ts: Date.now(),
        via: p.via,
        face: p.face,
        to: p.to,
    };
}

const MessageList = ({ room }: { room: Room }) => {
    const pending = useAtomValue(pendingAtom)[room.id];
    const boxRef = useRef<HTMLDivElement>(null);
    const stickRef = useRef(true);
    const roomRef = useRef(room.id);

    // 모드가 사람에게 숨기는 것 (예: 마피아 플레이어는 내 역할로 볼 수 있는 것만)
    const mode = modeOf(room);
    const visible = room.messages.filter((m) => mode.userCanSee(room, m));
    const items =
        pending && mode.userSeesPending(room, pending)
            ? [...visible, pendingAsMessage(pending)]
            : visible;

    // 사용자가 위로 스크롤해 둔 상태가 아니면 항상 맨 아래로
    useLayoutEffect(() => {
        const box = boxRef.current;
        if (!box) return;
        if (stickRef.current || roomRef.current !== room.id)
            box.scrollTop = box.scrollHeight;
        roomRef.current = room.id;
    });

    return (
        <div
            ref={boxRef}
            onScroll={(e) => {
                const b = e.currentTarget;
                stickRef.current =
                    b.scrollHeight - b.scrollTop - b.clientHeight < 80;
            }}
            className="flex-1 overflow-y-auto px-4 pt-2 pb-4"
        >
            {items.map((m, i) => {
                const prev = items[i - 1];
                const next = items[i + 1];
                // 같은 사람이라도 공개 말과 귓속말(또는 받는 사람)이 바뀌면 새 묶음으로 보인다
                const first =
                    !prev ||
                    prev.sender !== m.sender ||
                    whisperKey(prev) !== whisperKey(m) ||
                    !sameMinute(prev.ts, m.ts);
                const showTime =
                    !next ||
                    next.sender !== m.sender ||
                    whisperKey(next) !== whisperKey(m) ||
                    !sameMinute(next.ts, m.ts);
                return (
                    <Bubble
                        key={m.id}
                        room={room}
                        message={m}
                        first={first}
                        showTime={showTime}
                        streaming={m.id === pending?.id}
                        status={
                            m.id === pending?.id ? pending.status : undefined
                        }
                    />
                );
            })}
        </div>
    );
};

export default MessageList;
