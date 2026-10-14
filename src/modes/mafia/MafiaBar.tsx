import {
    BookOpen,
    ChevronDown,
    Clapperboard,
    Crosshair,
    Gavel,
    Hand,
    Play,
    RotateCcw,
    Search,
    ShieldPlus,
    SkipForward,
    Skull,
    Square,
    TriangleAlert,
    UserRound,
    Vote,
    type LucideIcon,
} from 'lucide-react';
import { useState } from 'react';
import toast from 'react-hot-toast';
import { Avatar } from '@components/Avatar';
import MindPopover from '@components/MindPopover';
import type { Room } from '@/types/chat';
import { cn } from '@utils/cn/cn';
import { agentImage } from '@utils/face/face';
import {
    startMafiaGame,
    startMafiaVote,
    stopMafiaGame,
    submitMafiaAction,
} from './actions';
import MafiaRolesModal from './MafiaRolesModal';
import RoleGlyph from './RoleGlyph';
import {
    ROLE_LABELS,
    USER_ROLE_LABELS,
    defaultMafiaSetup,
    gameOf,
    knownRole,
    liveGame,
    playerOf,
    setupProblem,
    userAction,
    userSeesAll,
    voteCounts,
    type UserAction,
} from './rules';
import type { MafiaGame, MafiaPlayer } from './types';
import { SEAT_ICON, phaseTheme, stripEmoji } from './visuals';

const ACTION_ICON: Record<UserAction['kind'], LucideIcon> = {
    introduction: Hand,
    kill: Crosshair,
    save: ShieldPlus,
    check: Search,
    vote: Vote,
    verdict: Gavel,
    decision: Clapperboard,
    lastWords: Gavel,
};

/** 참가자 얼굴. 에이전트는 방의 아바타(생성 이미지 포함), 나는 노란 사람 아이콘 */
const Face = ({
    room,
    id,
    className,
}: {
    room: Room;
    id: string;
    className?: string;
}) => {
    const agent = room.agents.find((a) => a.id === id);
    if (!agent)
        return (
            <span
                aria-hidden
                className={cn(
                    'text-kakao grid shrink-0 place-items-center bg-neutral-800',
                    className
                )}
            >
                <UserRound className="size-1/2" strokeWidth={2.25} />
            </span>
        );
    return (
        <span aria-hidden className="contents">
            <Avatar
                emoji={agent.emoji}
                color={agent.color}
                image={agentImage(room, agent)}
                className={className}
            />
        </span>
    );
};

/** 참가자 한 자리: 얼굴, 이름, 내가 아는 역할, 생존 여부, 받은 표 */
const Seat = ({
    room,
    game,
    player,
    votes,
    dark,
}: {
    room: Room;
    game: MafiaGame;
    player: MafiaPlayer;
    votes?: number;
    dark: boolean;
}) => {
    const role = knownRole(room, 'me', player.id);
    const accused =
        (game.phase === 'lastWords' || game.phase === 'verdict') &&
        game.accused === player.id;
    const mine = player.id === 'me';
    const roleLabel =
        role && (role === 'notMafia' ? '조사 결과 시민 쪽' : ROLE_LABELS[role]);
    const fate = player.alive
        ? undefined
        : player.death?.cause === 'executed'
          ? `${player.death.day}번째 낮 처형`
          : `${player.death?.day}번째 밤 사망`;
    const summary = [player.name, roleLabel, fate].filter(Boolean).join(' · ');
    // 다 보는 사람(관전·사회 등)은 에이전트의 감정과 기억을 팝오버로 본다
    const agent = userSeesAll(room)
        ? room.agents.find((a) => a.id === player.id)
        : undefined;
    const seatClass =
        'flex w-[48px] shrink-0 flex-col items-center gap-1 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-sky-500';
    const content = (
        <>
            <div className="relative">
                <div
                    className={cn(
                        'rounded-[15px] p-[2px] transition',
                        accused
                            ? 'bg-rose-500'
                            : mine && player.alive
                              ? 'bg-kakao'
                              : 'bg-transparent'
                    )}
                >
                    <Face
                        room={room}
                        id={player.id}
                        className={cn(
                            'size-10 rounded-[13px] text-lg',
                            !player.alive && 'opacity-35 grayscale'
                        )}
                    />
                </div>
                {!player.alive && (
                    <span className="absolute inset-0 grid place-items-center">
                        <Skull
                            aria-label={fate}
                            className={cn(
                                'size-5',
                                dark ? 'text-white' : 'text-neutral-800'
                            )}
                            strokeWidth={2.25}
                        />
                    </span>
                )}
                {role && (
                    <span
                        role="img"
                        aria-label={roleLabel}
                        className="absolute -right-1 -bottom-1"
                    >
                        <RoleGlyph
                            role={role}
                            iconClassName="size-[11px]"
                            className={cn(
                                'size-[18px] ring-2',
                                dark ? 'ring-[#161b2e]' : 'ring-white'
                            )}
                        />
                    </span>
                )}
                {!!votes && (
                    <span
                        className="absolute -top-1.5 -right-1.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-sky-600 px-1 text-[10.5px] font-bold text-white tabular-nums"
                        aria-label={`${votes}표`}
                    >
                        {votes}
                    </span>
                )}
            </div>
            <span
                className={cn(
                    'max-w-full truncate text-[11px] leading-none',
                    !player.alive && 'line-through opacity-50',
                    mine && 'font-semibold'
                )}
            >
                {mine ? '나' : player.name}
            </span>
        </>
    );
    return (
        <li className="shrink-0">
            {agent ? (
                <MindPopover
                    room={room}
                    agent={agent}
                    title={summary}
                    className={seatClass}
                >
                    {content}
                </MindPopover>
            ) : (
                <div className={seatClass} title={summary}>
                    {content}
                </div>
            )}
        </li>
    );
};

/** 내가 할 게임 행동 (밤 행동, 투표, 최후의 한마디) */
const ActionPanel = ({ room, dark }: { room: Room; dark: boolean }) => {
    const action = userAction(room);
    if (!action) return null;
    const Icon = ACTION_ICON[action.kind];
    const choose =
        action.kind !== 'introduction' && action.kind !== 'lastWords';
    const sub = dark
        ? 'bg-white/10 text-white hover:bg-white/20'
        : 'border border-neutral-200 bg-white hover:border-neutral-900';
    return (
        <div
            className={cn(
                'mx-3 mb-3 rounded-xl p-3',
                dark
                    ? 'bg-white/[0.06] ring-1 ring-white/10'
                    : 'bg-neutral-50 ring-1 ring-neutral-200'
            )}
        >
            <div className="flex items-center gap-2">
                <span
                    className={cn(
                        'grid size-6 shrink-0 place-items-center rounded-md',
                        action.kind === 'kill'
                            ? 'bg-rose-600 text-white'
                            : dark
                              ? 'bg-white text-[#161b2e]'
                              : 'bg-neutral-900 text-white'
                    )}
                >
                    <Icon className="size-3.5" strokeWidth={2.5} />
                </span>
                <p className="text-[13px] font-semibold">
                    {stripEmoji(action.question)}
                </p>
            </div>
            <div className="mt-2.5 flex flex-wrap gap-1.5">
                {choose ? (
                    <>
                        {action.options.map((o) => (
                            <button
                                key={o.id}
                                type="button"
                                className={cn(
                                    'flex items-center gap-1.5 rounded-lg py-1 pr-3 text-[13px] font-medium transition',
                                    action.plain ? 'pl-3' : 'pl-1',
                                    sub
                                )}
                                onClick={() => submitMafiaAction(room.id, o.id)}
                            >
                                {!action.plain && (
                                    <Face
                                        room={room}
                                        id={o.id}
                                        className="size-6 rounded-md text-xs"
                                    />
                                )}
                                {o.name}
                            </button>
                        ))}
                        {action.abstain && (
                            <button
                                type="button"
                                className={cn(
                                    'rounded-lg px-3 py-1 text-[13px] transition',
                                    dark
                                        ? 'text-indigo-100/70 hover:bg-white/10'
                                        : 'text-neutral-500 hover:bg-black/5'
                                )}
                                onClick={() => submitMafiaAction(room.id, null)}
                            >
                                기권
                            </button>
                        )}
                    </>
                ) : (
                    <button
                        type="button"
                        className={cn(
                            'rounded-lg px-3 py-1 text-[13px] transition',
                            sub
                        )}
                        onClick={() => submitMafiaAction(room.id, null)}
                    >
                        {action.kind === 'introduction'
                            ? '소개 건너뛰기'
                            : '할 말 없음'}
                    </button>
                )}
            </div>
        </div>
    );
};

/**
 * 마피아 방의 게임 상황판. 단계, 참가자(내가 아는 역할), 내가 할 행동, 진행 버튼을 보여준다.
 * 역할 표시는 knownRole을 따르므로 플레이어로 참가하면 내 역할로 알 수 있는 것만 보인다.
 */
const MafiaBar = ({ room }: { room: Room }) => {
    const [open, setOpen] = useState(true);
    const [guideOpen, setGuideOpen] = useState(false);
    if (room.mode !== 'mafia') return null;
    const game = gameOf(room);
    const live = liveGame(room);
    const setup = room.mafia ?? defaultMafiaSetup(room.agents.length);
    const problem = setupProblem(setup, room.agents);
    const me = game && playerOf(game, 'me');
    const counts =
        game?.phase === 'vote' ||
        game?.phase === 'lastWords' ||
        game?.phase === 'verdict'
            ? voteCounts(game.votes)
            : {};
    const seatRole = live?.userRole ?? setup.userRole;
    const seat = USER_ROLE_LABELS[seatRole];
    const SeatIcon = SEAT_ICON[seatRole];
    const theme = phaseTheme(game);
    const PhaseIcon = theme.icon;
    const showMine = me && game?.phase !== 'introduction';
    const alive = game?.players.filter((p) => p.alive).length ?? 0;

    const start = async () => {
        if (live && !confirm('진행 중인 게임을 끝내고 새 게임을 시작할까요?'))
            return;
        try {
            await startMafiaGame(room.id);
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : '게임을 시작하지 못했어요'
            );
        }
    };

    const quiet = cn(
        'inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium transition',
        theme.dark
            ? 'text-indigo-100/80 hover:bg-white/10 hover:text-white'
            : 'text-neutral-600 hover:bg-black/5 hover:text-neutral-900'
    );
    const pill = cn(
        'inline-flex h-6 shrink-0 items-center gap-1 rounded-full px-2 text-[11.5px] font-medium whitespace-nowrap',
        theme.dark ? 'bg-white/10' : 'bg-neutral-100'
    );

    return (
        <section
            aria-label="마피아 게임"
            className={cn(
                '@container mx-3 mt-2 mb-1 overflow-hidden rounded-2xl shadow-[0_1px_2px_rgb(0_0_0/0.06),0_4px_16px_rgb(0_0_0/0.06)] transition-colors duration-500',
                theme.surface
            )}
        >
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5">
                <div className="flex min-w-40 flex-1 items-center gap-2.5">
                    <span
                        className={cn(
                            'grid size-9 shrink-0 place-items-center rounded-xl',
                            theme.badge
                        )}
                    >
                        <PhaseIcon className="size-[18px]" strokeWidth={2.25} />
                    </span>
                    <div className="min-w-0 leading-tight">
                        <div className="flex min-w-0 items-baseline gap-1.5 whitespace-nowrap">
                            <strong className="text-[15px] font-bold tracking-tight">
                                {theme.title}
                            </strong>
                            <span
                                className={cn('truncate text-xs', theme.muted)}
                            >
                                {theme.caption}
                            </span>
                        </div>
                        <div
                            className={cn(
                                'mt-1 flex flex-wrap items-center gap-1',
                                theme.muted
                            )}
                        >
                            <span className={pill} title={seat.hint}>
                                <SeatIcon className="size-3" />
                                {seat.label}
                            </span>
                            {showMine && (
                                <span
                                    className={cn(pill, 'pl-0.5')}
                                    aria-label={`내 역할 ${ROLE_LABELS[me.role]}`}
                                >
                                    <RoleGlyph
                                        role={me.role}
                                        className="size-5"
                                    />
                                    <span
                                        className={
                                            theme.dark
                                                ? 'text-white'
                                                : 'text-neutral-900'
                                        }
                                    >
                                        {ROLE_LABELS[me.role]}
                                    </span>
                                </span>
                            )}
                            {me && !me.alive && (
                                <span className={pill}>
                                    <Skull className="size-3" />
                                    관전 중
                                </span>
                            )}
                            {game && game.phase !== 'ended' && (
                                <span className="px-1 text-[11.5px] whitespace-nowrap tabular-nums">
                                    생존 {alive}/{game.players.length}
                                </span>
                            )}
                        </div>
                    </div>
                </div>
                <div className="ml-auto flex shrink-0 items-center gap-1">
                    <button
                        type="button"
                        className={quiet}
                        title="역할별 설명과 이번 판의 역할 구성"
                        aria-label="역할 설명"
                        onClick={() => setGuideOpen(true)}
                    >
                        <BookOpen className="size-3.5" />
                        <span className="hidden @[36rem]:inline">
                            역할 설명
                        </span>
                    </button>
                    {live?.phase === 'epilogue' ? (
                        <button
                            type="button"
                            className={quiet}
                            title="남은 엔딩 장면을 건너뛰고 게임을 끝내요"
                            aria-label="엔딩 건너뛰기"
                            onClick={() => stopMafiaGame(room.id)}
                        >
                            <SkipForward className="size-3.5" />
                            <span className="hidden @[36rem]:inline">
                                엔딩 건너뛰기
                            </span>
                        </button>
                    ) : (
                        live && (
                            <button
                                type="button"
                                className={quiet}
                                title="게임을 중단하고 역할을 공개해요"
                                aria-label="중단"
                                onClick={() => {
                                    if (
                                        !confirm(
                                            '게임을 중단하고 역할을 공개할까요?'
                                        )
                                    )
                                        return;
                                    stopMafiaGame(room.id);
                                }}
                            >
                                <Square
                                    className="size-3"
                                    fill="currentColor"
                                />
                                <span className="hidden @[36rem]:inline">
                                    중단
                                </span>
                            </button>
                        )
                    )}
                    {live?.phase === 'day' && live.userRole !== 'observer' && (
                        <button
                            type="button"
                            className={cn(
                                'inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold transition',
                                'bg-neutral-900 text-white hover:bg-neutral-700'
                            )}
                            title="토론을 끝내고 투표로 넘어가요"
                            onClick={() => void startMafiaVote(room.id)}
                        >
                            <Vote className="size-3.5" />
                            투표 시작
                        </button>
                    )}
                    <button
                        type="button"
                        className="bg-kakao text-kakao-brown inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-bold transition hover:brightness-95 disabled:opacity-40"
                        disabled={!!problem}
                        title={problem ?? undefined}
                        aria-label={game ? '새 게임' : '게임 시작'}
                        onClick={start}
                    >
                        {game ? (
                            <RotateCcw className="size-3.5" strokeWidth={2.5} />
                        ) : (
                            <Play
                                className="size-3.5"
                                fill="currentColor"
                                strokeWidth={2.5}
                            />
                        )}
                        <span className={cn(game && 'hidden @[30rem]:inline')}>
                            {game ? '새 게임' : '게임 시작'}
                        </span>
                    </button>
                    {game && (
                        <button
                            type="button"
                            className={cn(quiet, 'w-8 justify-center px-0')}
                            aria-expanded={open}
                            aria-label={open ? '참가자 접기' : '참가자 펼치기'}
                            onClick={() => setOpen((v) => !v)}
                        >
                            <ChevronDown
                                className={cn(
                                    'size-4 transition-transform',
                                    open && 'rotate-180'
                                )}
                            />
                        </button>
                    )}
                </div>
            </div>
            {problem && (
                <p
                    className={cn(
                        'mx-3 mb-2.5 flex items-start gap-1.5 rounded-lg px-2.5 py-1.5 text-xs',
                        theme.dark
                            ? 'bg-rose-500/15 text-rose-200'
                            : 'bg-rose-50 text-rose-600'
                    )}
                >
                    <TriangleAlert className="mt-px size-3.5 shrink-0" />
                    <span>
                        {game ? '새 게임 설정: ' : ''}
                        {problem} · 방 설정(☰)에서 참가자와 역할 배분을 확인해
                        주세요
                    </span>
                </p>
            )}
            {open && game && (
                <ul
                    aria-label="참가자"
                    className={cn(
                        'flex flex-wrap gap-x-1 gap-y-2.5 border-t px-3 pt-3 pb-2.5',
                        theme.dark ? 'border-white/10' : 'border-neutral-100'
                    )}
                >
                    {game.players.map((p) => (
                        <Seat
                            key={p.id}
                            room={room}
                            game={game}
                            player={p}
                            votes={counts[p.id]}
                            dark={theme.dark}
                        />
                    ))}
                </ul>
            )}
            <ActionPanel room={room} dark={theme.dark} />
            <MafiaRolesModal
                room={room}
                open={guideOpen}
                onClose={() => setGuideOpen(false)}
            />
        </section>
    );
};

export default MafiaBar;
