import type { Agent, Message, Room } from '@/types/chat';
import type { ComposerPolicy } from '../core';
import type {
    MafiaEndingBeat,
    MafiaGame,
    MafiaPlayer,
    MafiaRole,
    MafiaSetup,
    MafiaUserRole,
} from './types';

/**
 * 마피아 게임 규칙. 역할 배정, 생존·승패 판정, 누가 무엇을 볼 수 있는지처럼
 * LLM에 맡기면 틀리기 쉬운 부분을 프로그램이 정한다. 상태를 바꾸지 않는 순수 함수만 둔다.
 */

export const ROLE_LABELS: Record<MafiaRole, string> = {
    mafia: '마피아',
    doctor: '의사',
    police: '경찰',
    citizen: '시민',
};

export const ROLE_ORDER = ['mafia', 'doctor', 'police', 'citizen'] as const;

export const ROLE_EMOJI: Record<MafiaRole, string> = {
    mafia: '🔪',
    doctor: '🩺',
    police: '🔍',
    citizen: '🙂',
};

export const USER_ROLES = [
    'observer',
    'host',
    'player',
] as const satisfies readonly MafiaUserRole[];

export const USER_ROLE_LABELS: Record<
    MafiaUserRole,
    { label: string; emoji: string; hint: string }
> = {
    observer: {
        emoji: '👀',
        label: '관전',
        hint: '에이전트끼리 게임을 처음부터 끝까지 자동으로 진행해요. 모든 역할과 밤 대화가 보여요.',
    },
    host: {
        emoji: '🎙️',
        label: '사회',
        hint: '내가 사회자예요. 단계마다 ▶로 넘기고 진행 멘트를 할 수 있어요. 모든 역할이 보여요.',
    },
    player: {
        emoji: '🙋',
        label: '플레이어',
        hint: '나도 역할을 받고 참가해요. 내 역할로 알 수 있는 것만 보이고, 밤 행동과 투표를 직접 해요.',
    },
};

/** 게임에 필요한 최소 인원 (나를 포함한 참가자) */
export const MIN_PLAYERS = 4;
export const DAY_TALK_OPTIONS = [6, 12, 20] as const;
/** 역할별 최대 인원 */
export const MAX_MAFIA = 10;
export const MAX_HELPERS = 5;

/** 참가자 수에 맞는 기본 마피아 수 */
export function defaultMafiaCount(players: number) {
    if (players >= 9) return 3;
    if (players >= 6) return 2;
    return 1;
}

export function defaultMafiaSetup(agentCount = 5): MafiaSetup {
    return {
        userRole: 'observer',
        roleAssignment: 'random',
        assignedRoles: {},
        mafia: defaultMafiaCount(agentCount),
        doctor: 1,
        police: 1,
        reveal: false,
        dayTalk: 12,
        verdict: true,
    };
}

/** 나를 포함한 참가자 수 */
export const playerCount = (setup: MafiaSetup, agentCount: number) =>
    agentCount + (setup.userRole === 'player' ? 1 : 0);

/** 게임에 참가할 자리. 이름이 같아도 역할은 ID로 구분한다 */
export const gameSeats = (
    setup: MafiaSetup,
    agents: readonly Pick<Agent, 'id' | 'name'>[],
    userName = '나'
) => [
    ...agents.map((a) => ({ id: a.id, name: a.name })),
    ...(setup.userRole === 'player' ? [{ id: 'me', name: userName }] : []),
];

/** 이 설정으로 게임을 시작할 수 없으면 이유 */
export function setupProblem(
    setup: MafiaSetup,
    agents: number | readonly Pick<Agent, 'id' | 'name'>[]
) {
    const agentCount = typeof agents === 'number' ? agents : agents.length;
    const n = playerCount(setup, agentCount);
    if (n < MIN_PLAYERS)
        return `참가자가 ${MIN_PLAYERS}명 이상 필요해요 (지금 ${n}명)`;
    if (
        !Number.isInteger(setup.mafia) ||
        setup.mafia < 1 ||
        setup.mafia > MAX_MAFIA
    )
        return `마피아 수는 1~${MAX_MAFIA}명으로 정해 주세요`;
    for (const role of ['doctor', 'police'] as const) {
        const count = +setup[role];
        if (!Number.isInteger(count) || count < 0 || count > MAX_HELPERS)
            return `${ROLE_LABELS[role]} 수는 0~${MAX_HELPERS}명으로 정해 주세요`;
    }
    if (setup.mafia * 2 >= n)
        return `마피아는 참가자의 절반보다 적어야 해요 (${n}명이면 최대 ${Math.ceil(n / 2) - 1}명)`;
    const specials = setup.mafia + +setup.doctor + +setup.police;
    if (specials > n) return '역할 수가 참가자보다 많아요';
    if (
        setup.roleAssignment !== undefined &&
        setup.roleAssignment !== 'random' &&
        setup.roleAssignment !== 'manual'
    )
        return '역할 배분 방식을 선택해 주세요';
    if (setup.roleAssignment === 'manual') {
        if (typeof agents === 'number')
            return '수동 배분에는 참가자별 역할 지정이 필요해요';
        const seats = gameSeats(setup, agents);
        const counts: Record<MafiaRole, number> = {
            mafia: 0,
            doctor: 0,
            police: 0,
            citizen: 0,
        };
        for (const seat of seats) {
            const role = setup.assignedRoles?.[seat.id];
            if (!role || !(ROLE_ORDER as readonly string[]).includes(role))
                return `${seat.name}의 역할을 지정해 주세요`;
            counts[role]++;
        }
        const expected: Record<MafiaRole, number> = {
            mafia: setup.mafia,
            doctor: +setup.doctor,
            police: +setup.police,
            citizen: n - specials,
        };
        for (const role of ROLE_ORDER)
            if (counts[role] !== expected[role])
                return `${ROLE_LABELS[role]} ${expected[role]}명을 지정해야 해요 (지금 ${counts[role]}명)`;
    }
    return null;
}

function shuffle<T>(items: T[], rand: () => number) {
    const a = [...items];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

/** 자동이면 무작위, 수동이면 지정한 역할을 보관하고 자기소개부터 시작한다 */
export function newGame(
    room: Room,
    setup: MafiaSetup,
    userName: string,
    rand: () => number = Math.random
): MafiaGame {
    const problem = setupProblem(setup, room.agents);
    if (problem) throw new Error(problem);
    const seats = gameSeats(setup, room.agents, userName);
    const roles: MafiaRole[] = [
        ...Array<MafiaRole>(setup.mafia).fill('mafia'),
        ...Array<MafiaRole>(+setup.doctor).fill('doctor'),
        ...Array<MafiaRole>(+setup.police).fill('police'),
    ];
    while (roles.length < seats.length) roles.push('citizen');
    const dealt =
        setup.roleAssignment === 'manual'
            ? seats.map((seat) => setup.assignedRoles![seat.id])
            : shuffle(roles, rand);
    return {
        userRole: setup.userRole,
        reveal: setup.reveal,
        dayTalk: setup.dayTalk,
        verdict: setup.verdict !== false,
        phase: 'introduction',
        day: 1,
        players: seats.map((s, i) => ({ ...s, role: dealt[i], alive: true })),
        introduced: [],
        night: emptyNight(),
        votes: {},
        talk: 0,
        hold: setup.userRole === 'host',
        startedAt: Date.now(),
        checks: [],
    };
}

export const emptyNight = (): MafiaGame['night'] => ({
    step: 'chat',
    chatted: [],
    picks: {},
});

/**
 * 마피아 모드 방. 이 방에는 귓속말이 없고, 받는 사람이 정해진 메시지는
 * 마피아끼리 밤 대화나 게임의 개인 알림뿐이다.
 */
export const isMafiaRoom = (room: Room) => room.mode === 'mafia';

/** 마피아 모드의 게임 (끝난 게임 포함). 일반 대화 방이면 undefined */
export function gameOf(room: Room): MafiaGame | undefined {
    return room.mode === 'mafia' ? room.modeState?.mafia : undefined;
}

/** 새 판의 시작 알림 */
export const GAME_START = '🎲 마피아 게임을 시작해요';

/**
 * 이번 판을 시작한 시각. 에이전트·진행 모델은 이 뒤의 메시지만 본다 (이전 판의 일을 기억하지 않는다).
 * startedAt이 없는 이전에 저장된 게임은 마지막 시작 알림으로 찾는다.
 */
export function gameStartedAt(room: Room, game = gameOf(room)): number {
    if (!game) return 0;
    if (game.startedAt) return game.startedAt;
    for (let i = room.messages.length - 1; i >= 0; i--) {
        const m = room.messages[i];
        if (m.sender === 'system' && m.text.startsWith(GAME_START)) return m.ts;
    }
    return 0;
}

/** 진행 중인 게임. 없거나 끝났으면 undefined */
export function liveGame(room: Room): MafiaGame | undefined {
    const game = gameOf(room);
    return game && game.phase !== 'ended' ? game : undefined;
}

export const playerOf = (game: MafiaGame, id: string) =>
    game.players.find((p) => p.id === id);

/** 이번 밤에 이 의사·경찰이 행동을 마쳤는지 (이전 버전의 한 명짜리 기록도 본다) */
export function nightActed(
    night: MafiaGame['night'],
    role: 'doctor' | 'police',
    id: string
) {
    return role === 'doctor'
        ? id in (night.saves ?? {}) || night.save !== undefined
        : id in (night.inspections ?? {}) || night.check !== undefined;
}

/** 이번 밤 의사들이 지킨 사람 */
export const savedIds = (night: MafiaGame['night']) => [
    ...Object.values(night.saves ?? {}),
    ...(night.save ? [night.save] : []),
];

/** 이 경찰이 알고 있는 조사 결과 (경찰이 여럿이면 각자 자기 결과만 안다) */
export const checksBy = (game: MafiaGame, police: string) =>
    game.checks.filter((c) => c.by === undefined || c.by === police);

/** 살아 있고 아직 방에 있는 참가자 (게임 중에 지운 에이전트는 빠진다) */
export function alivePlayers(game: MafiaGame, room: Room): MafiaPlayer[] {
    return game.players.filter(
        (p) =>
            p.alive && (p.id === 'me' || room.agents.some((a) => a.id === p.id))
    );
}

export const isAlive = (game: MafiaGame, room: Room, id: string) =>
    alivePlayers(game, room).some((p) => p.id === id);

/** 엔딩에서 지금 진행할 장면. 엔딩이 아니거나 아직 장면을 짜지 않았으면 undefined */
export function currentBeat(game: MafiaGame): MafiaEndingBeat | undefined {
    if (game.phase !== 'epilogue') return undefined;
    return game.epilogue?.beats?.[game.epilogue.at];
}

/** 엔딩 서술로 이야기에서 빠진 사람인지 (게임 결과의 생존과는 따로 센다) */
export const isGone = (game: MafiaGame, id: string) =>
    !!game.epilogue?.gone?.includes(id);

/** 엔딩 자유 대화에 참여하는 에이전트 (방에서 나갔거나 엔딩에서 빠진 사람은 빠진다) */
export function talkAgents(room: Room, beat: MafiaEndingBeat | undefined) {
    const game = gameOf(room);
    if (beat?.type !== 'talk') return [];
    return room.agents.filter(
        (a) => beat.speakers.includes(a.id) && !(game && isGone(game, a.id))
    );
}

/**
 * 지금 말할 수 있는 에이전트. 진행 중이면 생존자(엔딩이면 그 장면의 사람)만,
 * 끝난 게임은 연출 모델이 상황 설정을 보고 정한 범위(죽은 사람도 말하는지)를 따른다.
 */
export function speakingAgents(room: Room): Agent[] {
    const game = gameOf(room);
    if (!game) return room.agents;
    if (game.phase === 'ended') {
        if (game.epilogue?.after !== 'alive') return room.agents;
        return room.agents.filter((a) => {
            const player = playerOf(game, a.id);
            return !player || (player.alive && !isGone(game, a.id));
        });
    }
    if (game.phase === 'epilogue') return talkAgents(room, currentBeat(game));
    return room.agents.filter((a) => isAlive(game, room, a.id));
}

/** 살아 있는 마피아 (나 포함) */
export const aliveMafia = (game: MafiaGame, room: Room) =>
    alivePlayers(game, room).filter((p) => p.role === 'mafia');

/** 아직 자기소개하지 않은 참가자 중 다음 사람. 게임 시작 때의 자리 순서를 따른다 */
export const nextIntroductionPlayer = (game: MafiaGame, room: Room) =>
    alivePlayers(game, room).find((p) => !game.introduced?.includes(p.id));

/** 마피아가 모두 죽으면 시민, 마피아 수가 나머지 이상이면 마피아가 이긴다 */
export function winnerOf(game: MafiaGame, room: Room) {
    const alive = alivePlayers(game, room);
    const mafia = alive.filter((p) => p.role === 'mafia').length;
    if (mafia === 0) return 'citizen' as const;
    if (mafia >= alive.length - mafia) return 'mafia' as const;
    return null;
}

/**
 * 표를 센다. 가장 많은 표를 받은 사람이 한 명이면 그 사람, 동표거나 모두 기권이면 null.
 */
export function tally(votes: Record<string, string | null>) {
    const counts = new Map<string, number>();
    for (const target of Object.values(votes))
        if (target) counts.set(target, (counts.get(target) ?? 0) + 1);
    const ranked = [...counts].sort((a, b) => b[1] - a[1]);
    if (!ranked.length || ranked[1]?.[1] === ranked[0][1]) return null;
    return ranked[0][0];
}

/** 가장 많이 고른 대상. 동표면 그중 무작위 (마피아 에이전트들의 밤 지목) */
export function plurality(
    picks: string[],
    rand: () => number = Math.random
): string | undefined {
    const counts = new Map<string, number>();
    for (const p of picks) counts.set(p, (counts.get(p) ?? 0) + 1);
    const best = Math.max(0, ...counts.values());
    const top = [...counts].filter(([, n]) => n === best).map(([id]) => id);
    return top.length ? top[Math.floor(rand() * top.length)] : undefined;
}

/** 처형 찬반 결과. 찬성이 반대보다 많아야 처형한다 (고르지 않은 표는 반대로 센다) */
export function verdictResult(verdicts: MafiaGame['verdicts']) {
    const all = Object.values(verdicts ?? {});
    const guilty = all.filter((v) => v.guilty === true).length;
    const spare = all.length - guilty;
    return { guilty, spare, execute: guilty > spare };
}

/** 표 현황 (대상 id → 표 수) */
export function voteCounts(votes: Record<string, string | null>) {
    const counts: Record<string, number> = {};
    for (const target of Object.values(votes))
        if (target) counts[target] = (counts[target] ?? 0) + 1;
    return counts;
}

/* ---------------- 누가 무엇을 보는지 ---------------- */

/**
 * 사람(나)이 모든 역할과 비밀 대화를 볼 수 있는지.
 * 플레이어로 참가해 살아 있는 동안만 자기 역할로 알 수 있는 것만 보고, 죽거나 게임이 끝나면 다 본다.
 */
export function userSeesAll(room: Room) {
    const game = liveGame(room);
    if (!game || game.userRole !== 'player' || game.phase === 'epilogue')
        return true;
    return !playerOf(game, 'me')?.alive;
}

/** 사람(나)이 이 메시지를 볼 수 있는지 */
export function userCanSee(room: Room, m: Message) {
    return (
        userSeesAll(room) ||
        !m.to?.length ||
        m.sender === 'me' ||
        m.to.includes('me')
    );
}

/** 에이전트가 쓰고 있는 말풍선을 사람(나)에게 보여도 되는지 (밤 행동을 하는 사람이 드러나지 않게) */
export function userSeesPending(
    room: Room,
    pending: { to?: string[]; silent?: boolean }
) {
    if (userSeesAll(room)) return true;
    if (pending.silent) return false;
    return !pending.to || pending.to.includes('me');
}

/**
 * viewer('me' | agent.id)가 target의 역할을 아는지. 알면 역할, 모르면 undefined.
 * 자기 역할, 같은 마피아, 경찰 조사 결과, 공개된 죽음을 반영한다.
 */
export function knownRole(
    room: Room,
    viewer: string,
    target: string
): MafiaRole | 'notMafia' | undefined {
    const game = gameOf(room);
    const player = game && playerOf(game, target);
    if (!game || !player) return undefined;
    if (game.phase === 'introduction') return undefined;
    if (game.phase === 'ended' || game.phase === 'epilogue') return player.role;
    if (viewer === 'me' && userSeesAll(room)) return player.role;
    if (viewer === target) return player.role;
    const self = playerOf(game, viewer);
    if (self?.role === 'mafia' && player.role === 'mafia') return 'mafia';
    if (!player.alive && game.reveal) return player.role;
    if (self?.role === 'police') {
        const check = checksBy(game, viewer).find((c) => c.target === target);
        if (check) return check.mafia ? 'mafia' : 'notMafia';
    }
    return undefined;
}

/* ---------------- 사람(나)이 해야 할 일 ---------------- */

export type UserAction =
    | {
          kind: 'kill' | 'save' | 'check' | 'vote' | 'verdict' | 'decision';
          question: string;
          options: { id: string; name: string }[];
          /** 기권할 수 있으면 true */
          abstain: boolean;
          /** 선택지가 사람이 아니라 말(찬반, 엔딩 속 결정)이면 true */
          plain?: boolean;
      }
    | { kind: 'introduction'; question: string }
    | { kind: 'lastWords'; question: string };

/** 처형 찬반 투표의 선택지 (0번이 처형) */
export const VERDICT_OPTIONS = ['처형한다', '살려 둔다'] as const;

/** 플레이어로 참가 중인 내가 지금 할 수 있는(또는 해야 하는) 게임 행동 */
export function userAction(room: Room): UserAction | null {
    const game = liveGame(room);
    if (!game || game.userRole !== 'player') return null;
    const beat = currentBeat(game);
    if (beat?.type === 'decision' && beat.speaker === 'me')
        return {
            kind: 'decision',
            question: `🎬 ${beat.direction || '엔딩 속 내 결정 차례예요'}`,
            options: beat.options.map((o, i) => ({ id: String(i), name: o })),
            abstain: false,
            plain: true,
        };
    const me = playerOf(game, 'me');
    if (!me?.alive) return null;
    const alive = alivePlayers(game, room);
    const others = alive.filter((p) => p.id !== 'me');
    const pick = (list: MafiaPlayer[]) =>
        list.map((p) => ({ id: p.id, name: p.name }));
    if (
        game.phase === 'introduction' &&
        nextIntroductionPlayer(game, room)?.id === 'me'
    )
        return {
            kind: 'introduction',
            question:
                '🙋 자기소개 차례예요. 입력창에 이름과 취향 등을 짧게 소개해 주세요.',
        };
    const night = game.night;
    if (game.phase === 'night' && night.step !== 'done') {
        if (me.role === 'mafia' && night.kill === undefined)
            return {
                kind: 'kill',
                question: '🔪 오늘 밤 누구를 노릴까요?',
                options: pick(others.filter((p) => p.role !== 'mafia')),
                abstain: false,
            };
        if (me.role === 'doctor' && !nightActed(night, 'doctor', 'me'))
            return {
                kind: 'save',
                question: '🩺 오늘 밤 누구를 지킬까요?',
                options: pick(alive),
                abstain: false,
            };
        if (me.role === 'police' && !nightActed(night, 'police', 'me'))
            return {
                kind: 'check',
                question: '🔍 오늘 밤 누구를 조사할까요?',
                options: pick(others),
                abstain: false,
            };
    }
    if (game.phase === 'vote' && !game.hold && !('me' in game.votes))
        return {
            kind: 'vote',
            question: '🗳️ 누구를 처형할까요?',
            options: pick(others),
            abstain: true,
        };
    if (
        game.phase === 'verdict' &&
        game.accused !== 'me' &&
        !('me' in (game.verdicts ?? {}))
    )
        return {
            kind: 'verdict',
            question: `⚖️ ${playerOf(game, game.accused ?? '')?.name ?? ''}님을 처형할까요?`,
            options: VERDICT_OPTIONS.map((name, i) => ({
                id: String(i),
                name,
            })),
            abstain: false,
            plain: true,
        };
    if (game.phase === 'lastWords' && game.accused === 'me' && !game.lastSaid)
        return {
            kind: 'lastWords',
            question:
                '⚖️ 가장 많은 표를 받았어요. 입력창에 최후의 한마디를 남기세요.',
        };
    return null;
}

/** 사람(나)이 지금 채팅을 칠 수 있는지와, 칠 수 있다면 받는 사람 (마피아끼리 밤 대화) */
export function userComposer(room: Room): ComposerPolicy {
    const game = liveGame(room);
    const placeholder = '메시지를 입력하세요 (@이름 부르기)';
    // 게임 중에는 투표 만들기·자동 반응 전환을 숨긴다
    if (!game) return { allowed: true, placeholder, tools: true };
    if (game.phase === 'epilogue') {
        const beat = currentBeat(game);
        if (beat?.type === 'line' && beat.speaker === 'me')
            return {
                allowed: true,
                placeholder: '엔딩 속 내 한마디',
                tools: false,
            };
        if (beat?.type === 'decision' && beat.speaker === 'me')
            return { allowed: false, reason: '🎬 엔딩 속 내 결정 차례예요' };
        // 게임이 끝났으니 자유 대화에는 관전자·사회자도 낄 수 있다
        if (
            beat?.type === 'talk' &&
            (game.userRole !== 'player' || beat.speakers.includes('me'))
        )
            return { allowed: true, placeholder, tools: false };
        return { allowed: false, reason: '🎬 엔딩 장면이 진행 중이에요' };
    }
    if (game.userRole === 'observer')
        return {
            allowed: false,
            reason: '관전 중이에요 · 게임이 끝나면 대화할 수 있어요',
        };
    if (game.userRole === 'host')
        return {
            allowed: true,
            placeholder: '사회자로 말하기 (@이름 부르기)',
            tools: false,
        };
    const me = playerOf(game, 'me');
    if (!me?.alive)
        return { allowed: false, reason: '💀 죽은 사람은 말할 수 없어요' };
    if (game.phase === 'introduction')
        return nextIntroductionPlayer(game, room)?.id === 'me'
            ? {
                  allowed: true,
                  placeholder: '이름과 취향 등으로 자기소개하기',
                  tools: false,
              }
            : {
                  allowed: false,
                  reason: '🙋 다른 참가자의 자기소개를 듣는 중이에요 · 내 차례에 소개할 수 있어요',
              };
    if (game.phase === 'night') {
        if (me.role !== 'mafia')
            return { allowed: false, reason: '🌙 밤에는 말할 수 없어요' };
        const team = aliveMafia(game, room)
            .filter((p) => p.id !== 'me')
            .map((p) => p.id);
        if (!team.length)
            return { allowed: false, reason: '🌙 같이 대화할 마피아가 없어요' };
        return {
            allowed: true,
            to: team,
            toLabel: '🔪 마피아끼리만 보는 밤 대화',
            placeholder,
            tools: false,
        };
    }
    return { allowed: true, placeholder, tools: false };
}

/* ---------------- 표시 ---------------- */

export function phaseLabel(game: MafiaGame) {
    switch (game.phase) {
        case 'introduction':
            return '🙋 자기소개';
        case 'night':
            return `🌙 ${game.day}번째 밤`;
        case 'day':
            return `☀️ ${game.day}번째 낮 · 토론`;
        case 'vote':
            return `🗳️ ${game.day}번째 낮 · 투표`;
        case 'lastWords':
            return `⚖️ ${game.day}번째 낮 · 최후의 한마디`;
        case 'verdict':
            return `⚖️ ${game.day}번째 낮 · 처형 찬반`;
        case 'epilogue':
            return '🎬 엔딩';
        case 'ended':
            return game.winner === 'mafia' ? '🏁 마피아 승리' : '🏁 시민 승리';
    }
}

/** 사회자가 ▶로 넘길 다음 단계 */
export function holdLabel(game: MafiaGame) {
    if (game.phase === 'introduction') return '자기소개 시작';
    return game.phase === 'night' ? '밤 진행' : '낮 토론 시작';
}

/** 역할 구성 한 줄 (예: "마피아 2 · 의사 1 · 경찰 1 · 시민 3") */
export function roleSummary(game: MafiaGame) {
    const count = (role: MafiaRole) =>
        game.players.filter((p) => p.role === role).length;
    return (['mafia', 'doctor', 'police', 'citizen'] as const)
        .filter((r) => count(r))
        .map((r) => `${ROLE_LABELS[r]} ${count(r)}`)
        .join(' · ');
}

/** 사람에게 보여주는 역할 설명 (역할 설명 창) */
export const ROLE_GUIDE: Record<
    MafiaRole,
    { team: 'mafia' | 'citizen'; ability: string; tip: string }
> = {
    mafia: {
        team: 'mafia',
        ability:
            '밤마다 마피아끼리만 보는 대화로 상의하고, 함께 한 명을 골라 제거해요.',
        tip: '낮에는 시민인 척 의심을 피하세요. 마피아 수가 나머지와 같아지면 이겨요.',
    },
    doctor: {
        team: 'citizen',
        ability:
            '밤마다 한 명을 지켜요(자기 자신도 돼요). 마피아가 그 사람을 노렸다면 살아나요.',
        tip: '누가 노려질지 예측해 보세요. 의사라는 게 들키면 마피아의 표적이 돼요.',
    },
    police: {
        team: 'citizen',
        ability:
            '밤마다 한 명을 조사해 마피아인지 아닌지 알아내요. 결과는 경찰만 알아요.',
        tip: '조사 결과를 언제, 어떻게 밝힐지가 중요해요. 너무 일찍 밝히면 노려질 수 있어요.',
    },
    citizen: {
        team: 'citizen',
        ability: '특별한 능력은 없어요. 낮 토론과 투표가 유일한 무기예요.',
        tip: '발언, 투표, 죽음의 흐름을 보고 마피아를 찾아내세요.',
    },
};

/**
 * 역할별 인원. 게임이 있으면 그 게임의 구성, 없으면 방 설정으로 시작할 때의 구성.
 * 누가 어떤 역할인지는 담지 않으므로 누구에게 보여도 된다.
 */
export function roleCounts(room: Room): Record<MafiaRole, number> {
    const game = gameOf(room);
    if (game)
        return Object.fromEntries(
            ROLE_ORDER.map((r) => [
                r,
                game.players.filter((p) => p.role === r).length,
            ])
        ) as Record<MafiaRole, number>;
    const setup = room.mafia ?? defaultMafiaSetup(room.agents.length);
    const players = playerCount(setup, room.agents.length);
    const doctor = +setup.doctor;
    const police = +setup.police;
    return {
        mafia: setup.mafia,
        doctor,
        police,
        citizen: Math.max(0, players - setup.mafia - doctor - police),
    };
}

/* ---------------- 프롬프트 ---------------- */

const ROLE_GOALS: Record<MafiaRole, string> = {
    mafia: '마피아 팀이다. 시민인 척 의심을 피하고, 밤마다 한 명씩 제거해 마피아 수가 나머지와 같아지면 이긴다.',
    doctor: '시민 팀이다. 밤마다 한 명을 지킨다(자기 자신도 된다). 마피아가 그 사람을 노렸으면 살아난다.',
    police: '시민 팀이다. 밤마다 한 명을 조사해 마피아인지 알아낸다. 결과는 너만 안다.',
    citizen:
        '시민 팀이다. 특별한 능력은 없다. 토론과 투표로 마피아를 찾아낸다.',
};

export const deathLabel = (p: MafiaPlayer) =>
    p.death
        ? p.death.cause === 'killed'
            ? `${p.death.day}번째 밤에 마피아에게 당함`
            : `${p.death.day}번째 낮 투표로 처형됨`
        : '나감';

/** 에이전트 instructions에 넣는 게임 규칙과 자기 역할. 게임 중에는 바뀌지 않아 캐시할 수 있다 */
export function mafiaInstructions(
    room: Room,
    agent: Agent,
    userName: string
): string | null {
    const game = gameOf(room);
    if (!game) return null;
    const me = playerOf(game, agent.id);
    if (!me)
        return `[마피아 게임]\n이 방에서 마피아 게임이 열렸지만 너는 이번 판의 참가자가 아니다. 게임에 끼어들지 않는다.`;
    if (game.phase === 'introduction')
        return `[마피아 게임 · 자기소개]
첫 밤 전에 참가자들이 한 명씩 돌아가며 인사하는 시간이다. 순서는 프로그램이 정한다.
- 상황 설정 속 지금 이 순간, 처음 모인 사람들 앞에서 실제 사람이 하듯 짧게 말한다. 한두 문장, 길어도 세 문장을 넘기지 않는다.
- 캐릭터 소개 글을 요약해 읽지 않는다. 성격, 가치관, 장점을 스스로 설명하는 말("책임감 있는 편이에요", "끝까지 해내려고 했어요" 같은)은 하지 않는다. 그런 면은 말투, 작은 디테일, 이 자리를 대하는 태도로 드러낸다.
- 지금의 자신을 현재형으로 말한다. 지나간 일을 돌아보듯 과거형으로 정리하지 않는다.
- 무엇을 밝힐지는 네가 정한다. 이름만 말해도 되고, 하는 일이나 지금 기분 하나만 곁들여도 된다. 숨기거나 경계해도 된다.
- 이 자리나 게임에 대한 한마디(긴장된다, 일단 들어 보겠다, 앞사람 말에 대한 짧은 반응 등)를 섞으면 자연스럽다. 다만 이번 차례의 중심은 너 자신을 밝히는 것이다.
- 게임 역할은 아직 전달받지 않았다. 이전 판의 역할이나 캐릭터의 배경을 이번 판의 역할로 여기지 않는다.
- 게임 역할, 같은 편, 비밀 정보는 밝히지 않는다. 아직 누구를 마피아로 몰지 않는다.`;
    if (game.phase === 'epilogue' || game.phase === 'ended')
        return endingInstructions(game, me);
    const team = game.players
        .filter((p) => p.role === 'mafia' && p.id !== agent.id)
        .map((p) => p.name);
    const user =
        game.userRole === 'player'
            ? `- ${userName}(사람)도 참가자다. 다른 참가자와 똑같이 의심하고 대한다. 방장이라고 특별히 대하지 않는다.`
            : game.userRole === 'host'
              ? `- ${userName}(사람)은 사회자다. 게임에 참가하지 않고 진행 멘트를 한다. 사회자의 진행에 따른다.`
              : `- ${userName}(사람)은 지켜보는 방장이다. 게임에 참가하지 않는다.`;
    return [
        '[마피아 게임]',
        '이 방에서는 상황 설정 속 사람들이 마피아 게임 규칙에 따라 서로를 가려내고 있다. 단계 진행과 결과 발표(로그의 📢 진행)는 프로그램이 한다.',
        '- 처형, 밤의 죽음, 승패가 이 사람들에게 어떤 의미인지(놀이인지, 목숨이 걸린 일인지 등)는 상황 설정이 정한다. 그 무게대로 두려워하고, 분노하고, 슬퍼하고, 안도한다.',
        `- 참가자: ${game.players.map((p) => p.name).join(', ')} (역할 구성: ${roleSummary(game)})`,
        user,
        '- 밤: 마피아는 자기들끼리만 대화하고 한 명을 노린다. 의사는 한 명을 지키고, 경찰은 한 명이 마피아인지 조사한다. 의사·경찰이 여럿이면 서로 누군지 모른 채 각자 따로 행동하고, 조사 결과는 조사한 경찰만 안다.',
        game.verdict
            ? '- 낮: 살아 있는 사람이 모두 보는 곳에서 토론하고 투표한다. 기권한 표는 세지 않고 가장 많은 표를 받은 한 명이 최후의 한마디를 한다(동표면 아무도 지목되지 않는다). 그 뒤 나머지 생존자가 그 사람을 처형할지 찬반 투표를 하고, 찬성이 반대보다 많을 때만 처형한다.'
            : '- 낮: 살아 있는 사람이 모두 보는 곳에서 토론하고, 투표로 가장 많은 표를 받은 한 명을 처형한다. 기권한 표는 세지 않는다. 동표면 아무도 처형하지 않는다.',
        '- 마피아가 모두 죽으면 시민 팀이, 마피아 수가 나머지와 같아지면 마피아 팀이 이긴다.',
        `- 죽은 사람은 말할 수 없다. 귓속말은 없다. ${game.reveal ? '죽으면 역할이 공개된다.' : '죽어도 역할은 공개되지 않는다.'}`,
        '',
        `너의 역할: ${ROLE_LABELS[me.role]}. ${ROLE_GOALS[me.role]}`,
        me.role === 'mafia'
            ? team.length
                ? `같은 마피아: ${team.join(', ')}. 이들만 너의 정체를 안다.`
                : '마피아는 너 혼자다.'
            : null,
        '- 네 게임 역할은 위의 하나뿐이다. 캐릭터 설명이나 비밀 정보에 다른 게임 역할이 적혀 있어도 이것을 따른다.',
        '- 역할을 밝힐지, 숨길지, 다른 역할이라고 주장할지는 네 전략이다. 마피아는 들키지 않게 시민인 척한다.',
        '- 발언, 투표, 죽음을 보고 의심하고 변호한다. 무엇을 근거로 삼고 어떻게 반응할지는 캐릭터의 성격과 상황 설정 속 처지·관계·감정이 정한다.',
    ]
        .filter((l) => l !== null)
        .join('\n');
}

const teamLabel = (game: MafiaGame) =>
    game.winner === 'mafia' ? '마피아' : '시민';

/** 엔딩에서 이 사람의 처지 (게임 결과와 엔딩 서술로 빠졌는지) */
function fateLine(game: MafiaGame, me: MafiaPlayer) {
    const result = me.alive
        ? '게임에서 살아남았다'
        : `게임 중에 죽었다(${deathLabel(me)})`;
    return isGone(game, me.id)
        ? `너는 ${result}. 그 뒤 엔딩 서술(🎬)에 따라 이야기에서 빠졌다.`
        : `너는 ${result}.`;
}

/** 승패가 난 뒤: 엔딩의 내용은 상황 설정과 엔딩 장면이 정하므로 여기서는 결과와 태도만 알린다 */
function endingInstructions(game: MafiaGame, me: MafiaPlayer) {
    return [
        '[마피아 게임 · 엔딩]',
        game.winner
            ? `마피아 게임이 끝났다. ${teamLabel(game)} 팀이 이겼다.`
            : '마피아 게임이 중단됐다.',
        `모든 역할이 공개됐다: ${game.players.map((p) => `${p.name} ${ROLE_LABELS[p.role]}${p.alive ? '' : `(${deathLabel(p)})`}`).join(', ')}`,
        `너의 역할은 ${ROLE_LABELS[me.role]}였다. ${fateLine(game, me)}`,
        '- 이 결과가 상황 설정 속에서 갖는 의미(보상, 처벌, 귀환, 그저 놀이의 끝 등)대로 받아들이고 반응한다.',
        '- 로그의 진행 서술(📢)과 엔딩 서술(🎬)에 나온 일은 이미 일어난 일이다. 그 상황 안에서 말하고 행동하고, 서술보다 앞서 나가 아직 서술되지 않은 일을 해 버리지 않는다.',
        '- 엔딩 속 너의 결정 차례가 오면 무엇을 할지는 네가 정한다. 그 결과는 다음 서술이 이어 받는다.',
        '- 역할은 더 숨길 필요가 없다. 게임 중에 있었던 실제 발언, 의심, 투표, 죽음을 기억하고 이야기한다. 없었던 일을 지어내지 않는다.',
        '- 숨겨 왔던 관계나 비밀을 이제 털어놓을지는 네가 정한다.',
        '- 다른 사람의 말이나 행동을 대신 정하지 않는다. 네 말과 행동만 한다.',
    ].join('\n');
}

/** 채팅 로그 아래에 붙는 지금 게임 상황 (매 차례 바뀐다) */
export function mafiaTurnContext(room: Room, agent: Agent): string[] {
    const game = gameOf(room);
    const me = game && playerOf(game, agent.id);
    if (!game || !me) return [];
    if (game.phase === 'introduction')
        return [
            '게임 상황: 자기소개. 지금은 네 차례다. 처음 만난 사람들 앞에서 하듯 네 말투로 한두 문장 짧게 인사한다. 소개 글을 읽거나 자기 성격을 설명하지 말고, 지금 이 자리에서 할 법한 말을 현재형으로 한다.',
            '게임 역할·같은 편·비밀 정보는 밝히지 않는다.',
        ];
    if (game.phase === 'epilogue') {
        const beat = currentBeat(game);
        return [
            `게임 상황: 엔딩 (${teamLabel(game)} 팀 승리). ${fateLine(game, me)}`,
            beat?.type === 'line' && beat.speaker === agent.id
                ? `지금은 엔딩 장면 속 너의 차례다. 상황: ${beat.direction || '게임이 끝났다.'}\n이 상황에서 네 성격, 기억, 감정, 관계에 따라 직접 말하고 행동한다.`
                : null,
            beat?.type === 'decision' && beat.speaker === agent.id
                ? `지금은 엔딩 장면 속 너의 결정 차례다. 상황: ${beat.direction || '게임이 끝났다.'}\n무엇을 할지는 네 성격, 기억, 감정, 관계에 따라 네가 정한다.`
                : null,
            beat?.type === 'talk'
                ? `엔딩 대화 중이다. ${beat.direction}`.trim()
                : null,
        ].filter((l) => l !== null);
    }
    if (game.phase === 'ended')
        return [
            `마피아 게임이 끝났다 (${game.winner === 'mafia' ? '마피아' : '시민'} 팀 승리). 모든 역할이 공개됐다. 역할은 더 숨길 필요가 없다. 이 결과가 상황 설정 속에서 갖는 의미대로 반응하고 이야기한다.`,
        ];
    const alive = alivePlayers(game, room);
    const dead = game.players.filter((p) => !p.alive);
    const lines = [
        `게임 상황: ${phaseLabel(game).replace(/^\S+\s/, '')}`,
        `살아 있는 사람: ${alive.map((p) => p.name).join(', ')}`,
        dead.length
            ? `죽은 사람: ${dead
                  .map((p) => {
                      const role = knownRole(room, agent.id, p.id);
                      return `${p.name}(${deathLabel(p)}${role && role !== 'notMafia' ? ` · ${ROLE_LABELS[role]}` : ''})`;
                  })
                  .join(', ')}`
            : null,
    ];
    const myChecks = checksBy(game, agent.id);
    if (me.role === 'police' && myChecks.length)
        lines.push(
            `네 조사 결과: ${myChecks
                .map(
                    (c) =>
                        `${playerOf(game, c.target)?.name ?? '?'} → ${c.mafia ? '마피아' : '마피아 아님'}`
                )
                .join(', ')}`
        );
    if (game.phase === 'night' && me.role === 'mafia' && me.alive) {
        const team = aliveMafia(game, room)
            .filter((p) => p.id !== agent.id)
            .map((p) => p.name);
        if (game.night.step === 'chat')
            lines.push(
                `지금은 밤이다. 네 말은 같은 마피아(${team.join(', ')})만 본다. 오늘 밤 누구를 노릴지, 낮에 어떻게 행동할지 상의한다.`
            );
    }
    if (game.phase === 'lastWords' && game.accused === agent.id)
        lines.push(
            game.verdict
                ? '너는 투표에서 가장 많은 표를 받았다. 지금은 너의 최후의 한마디 차례다. 이 말을 들은 뒤 나머지 생존자가 너를 처형할지 찬반 투표를 한다.'
                : '너는 투표에서 가장 많은 표를 받아 곧 처형된다. 지금은 너의 최후의 한마디 차례다.'
        );
    if (game.phase === 'verdict') {
        const accused = game.accused && playerOf(game, game.accused);
        if (accused)
            lines.push(
                accused.id === agent.id
                    ? '지금 나머지 생존자가 너를 처형할지 찬반 투표를 하고 있다.'
                    : `지금은 ${accused.name}을 처형할지 정하는 찬반 투표다. 다른 사람의 선택은 모두 투표한 뒤에 공개된다.`
            );
    }
    return lines.filter((l) => l !== null);
}

/** 진행 모델에 넘기는 주제: 역할은 넣지 않고 지금 단계만 알린다 */
export function moderatorTopic(room: Room) {
    const game = liveGame(room);
    if (!game) return room.topic;
    if (game.phase === 'epilogue') {
        const beat = currentBeat(game);
        return `${room.topic.slice(0, 1400)}

[마피아 게임 종료 · 엔딩 대화]
${beat?.type === 'talk' ? beat.direction : ''}
멤버 목록의 사람만 이 대화에 참여한다. 대화가 충분히 오갔거나 같은 말이 반복되면 멈춘다.`;
    }
    const dead = game.players.filter((p) => !p.alive).map((p) => p.name);
    return `${room.topic.slice(0, 1400)}

[마피아 게임 진행 중 · ${game.day}번째 낮 토론]
멤버 목록에는 지금 말할 수 있는 생존자만 있다.${dead.length ? ` 죽은 사람(${dead.join(', ')})은 말할 수 없다.` : ''}
생존자들이 누가 마피아인지 의심하고 변호하는 토론이다. 밤 행동과 투표는 프로그램이 따로 진행한다.
토론이 충분히 오갔거나 같은 말이 반복되면 멈춘다.`;
}
