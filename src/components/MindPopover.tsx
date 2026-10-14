import { useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { Agent, Room } from '@/types/chat';
import { cn } from '@utils/cn/cn';

const WIDTH = 288;
const GUTTER = 8;
/** 팝오버에 보여줄 최근 감정 변화 수 */
const HISTORY = 5;

/**
 * 에이전트 한 명의 감정과 기억을 보여주는 팝오버. 마우스를 올리거나 포커스하면 열린다.
 * 모든 비밀을 볼 수 있는 사람(관전자·사회자 등)에게만 쓴다.
 * 상황판이 overflow를 자르므로 body에 띄운다.
 */
const MindPopover = ({
    room,
    agent,
    title,
    className,
    children,
}: {
    room: Room;
    agent: Agent;
    /** 팝오버 맨 위에 보일 한 줄 (예: 이름 · 역할) */
    title: string;
    className?: string;
    children: ReactNode;
}) => {
    const [anchor, setAnchor] = useState<DOMRect | null>(null);
    const open = (e: { currentTarget: HTMLElement }) =>
        setAnchor(e.currentTarget.getBoundingClientRect());
    const close = () => setAnchor(null);
    const popoverId = `mind-${agent.id}`;

    return (
        <div
            className={className}
            tabIndex={0}
            aria-describedby={anchor ? popoverId : undefined}
            onMouseEnter={open}
            onMouseLeave={close}
            onFocus={open}
            onBlur={close}
        >
            {children}
            {anchor &&
                createPortal(
                    <div
                        id={popoverId}
                        role="tooltip"
                        className="pointer-events-none fixed z-50 rounded-xl bg-white p-3 text-xs text-neutral-700 shadow-[0_4px_24px_rgb(0_0_0/0.16)] ring-1 ring-black/5"
                        style={{
                            width: WIDTH,
                            top: anchor.bottom + GUTTER,
                            left: Math.min(
                                Math.max(
                                    GUTTER,
                                    anchor.left + anchor.width / 2 - WIDTH / 2
                                ),
                                window.innerWidth - WIDTH - GUTTER
                            ),
                        }}
                    >
                        <MindDetails room={room} agent={agent} title={title} />
                    </div>,
                    document.body
                )}
        </div>
    );
};

export const MindDetails = ({
    room,
    agent,
    title,
}: {
    room: Room;
    agent: Agent;
    title: string;
}) => {
    const changes = room.messages
        .filter((m) => m.sender === agent.id && m.feeling)
        .slice(-HISTORY);
    const memories = agent.memories ?? [];
    return (
        <div className="flex flex-col gap-2.5">
            <strong className="text-[13px] text-neutral-900">{title}</strong>
            <Section label="💭 지금 감정">
                <p className={cn(!agent.feeling && 'text-neutral-400')}>
                    {agent.feeling || '아직 정해지지 않았어요'}
                </p>
                {changes.length > 1 && (
                    <ol className="mt-1.5 flex flex-col gap-0.5 border-l-2 border-neutral-100 pl-2 text-neutral-500">
                        {changes.map((m) => (
                            <li key={m.id} className="line-clamp-2">
                                {m.feeling}
                            </li>
                        ))}
                    </ol>
                )}
            </Section>
            <Section label={`🧠 기억 ${memories.length}개`}>
                {memories.length ? (
                    <ul className="flex max-h-48 flex-col gap-1 overflow-hidden">
                        {memories
                            .slice()
                            .reverse()
                            .map((memory, i) => (
                                <li
                                    key={`${i}-${memory}`}
                                    className="rounded bg-neutral-50 px-2 py-1"
                                >
                                    {memory}
                                </li>
                            ))}
                    </ul>
                ) : (
                    <p className="text-neutral-400">아직 기억한 게 없어요</p>
                )}
            </Section>
        </div>
    );
};

const Section = ({
    label,
    children,
}: {
    label: string;
    children: ReactNode;
}) => (
    <section>
        <h4 className="mb-1 text-[11px] font-semibold text-neutral-500">
            {label}
        </h4>
        {children}
    </section>
);

export default MindPopover;
