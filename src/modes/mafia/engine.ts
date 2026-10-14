import type { Agent, Room } from '@/types/chat';
import type { ModeEngine, ModeIO } from '../core';
import type { MafiaEndingBeat, MafiaGame, MafiaPlayer } from './types';
import type { MafiaEndingPlan } from '@shared/modes/mafia-ending';
import {
    announce as announceNotice,
    appendMessage,
    assistantModel,
    getRoom,
    runModeAction,
    setState,
    updateRoom,
    userName as currentUserName,
    withState,
} from '../runtime';
import { endingRequest, fallbackBeats, resolveBeats } from './ending';
import {
    GAME_START,
    ROLE_LABELS,
    VERDICT_OPTIONS,
    alivePlayers,
    aliveMafia,
    currentBeat,
    defaultMafiaSetup,
    gameOf,
    emptyNight,
    holdLabel,
    isGone,
    liveGame,
    newGame,
    nextIntroductionPlayer,
    nightActed,
    playerOf,
    plurality,
    roleSummary,
    savedIds,
    talkAgents,
    tally,
    userAction,
    verdictResult,
    voteCounts,
    winnerOf,
} from './rules';

/**
 * 마피아 게임 진행. 밤 행동, 투표, 처형, 승패는 프로그램이 정하고,
 * 에이전트는 자기 차례에 말하거나 대상을 고르기만 한다. 낮 토론은 대화 엔진(진행 모델)이 맡는다.
 * 대화 엔진과 순환 참조하지 않도록 발언 함수 등은 ModeIO로 받는다.
 */

/** 관전 모드에서 단계 사이에 읽을 틈을 준다 */
const STEP_PAUSE = 900;

export function updateGame(roomId: string, fn: (game: MafiaGame) => MafiaGame) {
    setState(roomId, 'mafia', (game) => game && fn(game));
}

/** 진행 알림. to가 있으면 그 사람만 본다 ('gm'은 다 보는 사람만) */
const announce = (roomId: string, text: string, to?: string[]) =>
    announceNotice(roomId, text, to);

const nameOf = (game: MafiaGame, id: string | null | undefined) =>
    id ? (playerOf(game, id)?.name ?? '(나간 멤버)') : '기권';

const roleTag = (game: MafiaGame, p: MafiaPlayer) =>
    game.reveal ? ` (${ROLE_LABELS[p.role]})` : '';

/** 새 게임을 시작한다. 역할은 보관해 두고 먼저 공개 자기소개를 진행한다 */
export function startNewGame(roomId: string) {
    const room = getRoom(roomId);
    if (!room) return;
    const userName = currentUserName();
    const setup = room.mafia ?? defaultMafiaSetup(room.agents.length);
    const game = newGame(room, setup, userName);
    // 감정과 기억은 한 판 안에서만 쓴다. 이전 판의 일이 새 판으로 이어지지 않게 비운다
    updateRoom(roomId, (r) => ({
        ...withState(r, 'mafia', game),
        agents: r.agents.map((a) => ({
            ...a,
            feeling: undefined,
            memories: [],
        })),
    }));
    announce(
        roomId,
        `${GAME_START} · 참가자 ${game.players.length}명 · ${roleSummary(game)}`
    );
    announce(
        roomId,
        '🙋 먼저 참가자 순서대로 한 명씩 자기소개해요. 모두 마치면 역할을 안내한 뒤 첫 밤을 시작해요.'
    );
}

/** 자기소개를 모두 마친 뒤에만 게임 역할을 전달한다 */
function announceRoles(roomId: string, game: MafiaGame) {
    announce(
        roomId,
        `🎭 역할: ${game.players.map((p) => `${p.name} ${ROLE_LABELS[p.role]}`).join(', ')}`,
        ['gm']
    );
    const me = playerOf(game, 'me');
    if (me) {
        const team = game.players
            .filter((p) => p.role === 'mafia' && p.id !== 'me')
            .map((p) => p.name);
        announce(
            roomId,
            `🎭 내 역할은 ${ROLE_LABELS[me.role]}이에요${
                me.role === 'mafia'
                    ? team.length
                        ? ` · 같은 마피아: ${team.join(', ')}`
                        : ' · 마피아는 나 혼자예요'
                    : ''
            }`,
            ['me']
        );
    }
}

/** 게임을 중간에 끝낸다 (결과 없이) */
export function abandonGame(roomId: string) {
    const room = getRoom(roomId);
    const game = room && liveGame(room);
    if (!game) return;
    if (game.phase === 'epilogue') {
        endEpilogue(roomId);
        announce(roomId, '🎬 엔딩을 건너뛰었어요');
        return;
    }
    updateGame(roomId, (g) => ({ ...g, phase: 'ended', hold: false }));
    announce(
        roomId,
        `🛑 게임을 중단했어요 · ${game.players.map((p) => `${p.name} ${ROLE_LABELS[p.role]}`).join(', ')}`
    );
}

function announceNight(roomId: string, day: number) {
    announce(
        roomId,
        `🌙 ${day}번째 밤이 됐어요. 마피아는 노릴 사람을, 의사는 지킬 사람을, 경찰은 조사할 사람을 골라요.`
    );
}

function toNight(roomId: string, first = false) {
    const room = getRoom(roomId);
    const game = room && liveGame(room);
    if (!game) return;
    const day = first ? 1 : game.day + 1;
    updateGame(roomId, (g) => ({
        ...g,
        phase: 'night',
        day,
        night: emptyNight(),
        votes: {},
        accused: undefined,
        lastSaid: undefined,
        verdicts: undefined,
        hold: g.userRole === 'host',
    }));
    if (first) announceRoles(roomId, game);
    announceNight(roomId, day);
}

/** 소개 완료는 저장해 두어 중단하거나 다시 열어도 이미 소개한 사람은 반복하지 않는다 */
function markIntroduced(roomId: string, id: string) {
    updateGame(roomId, (g) =>
        g.phase === 'introduction'
            ? { ...g, introduced: [...new Set([...(g.introduced ?? []), id])] }
            : g
    );
}

/** 낮 토론을 끝내고 투표를 시작한다 */
export function startVote(roomId: string) {
    const room = getRoom(roomId);
    const game = room && liveGame(room);
    if (!game || game.phase !== 'day') return;
    updateGame(roomId, (g) => ({
        ...g,
        phase: 'vote',
        votes: {},
        hold: false,
    }));
    announce(
        roomId,
        `🗳️ 토론을 마치고 투표해요. 처형할 사람을 한 명씩 골라요 (동표면 아무도 처형하지 않아요).`
    );
}

/** 승패가 나면 엔딩으로 넘어간다. 끝났으면 true */
function checkWinner(roomId: string) {
    const room = getRoom(roomId);
    const game = room && liveGame(room);
    if (!room || !game) return true;
    const winner = winnerOf(game, room);
    if (!winner) return false;
    updateGame(roomId, (g) => ({
        ...g,
        phase: 'epilogue',
        winner,
        hold: false,
        epilogue: { at: 0, talk: 0 },
    }));
    announce(
        roomId,
        winner === 'mafia'
            ? '🏁 마피아 수가 시민과 같아졌어요. 마피아 팀 승리!'
            : '🏁 마피아가 모두 사라졌어요. 시민 팀 승리!'
    );
    announce(
        roomId,
        `🎭 역할 공개: ${game.players.map((p) => `${p.name} ${ROLE_LABELS[p.role]}`).join(', ')}`
    );
    return true;
}

function kill(roomId: string, id: string, cause: 'killed' | 'executed') {
    updateGame(roomId, (g) => ({
        ...g,
        players: g.players.map((p) =>
            p.id === id
                ? { ...p, alive: false, death: { day: g.day, cause } }
                : p
        ),
    }));
}

/** 경찰 조사 결과를 기록하고 경찰에게만 알린다 */
function recordCheck(roomId: string, police: string, target: string) {
    const room = getRoom(roomId);
    const game = room && liveGame(room);
    const player = game && playerOf(game, target);
    if (!game || !player) return;
    const mafia = player.role === 'mafia';
    updateGame(roomId, (g) => ({
        ...g,
        night: {
            ...g.night,
            inspections: { ...g.night.inspections, [police]: target },
        },
        checks: [...g.checks, { day: g.day, target, mafia, by: police }],
    }));
    announce(
        roomId,
        `🔍 조사 결과: ${player.name}님은 ${mafia ? '마피아예요' : '마피아가 아니에요'}`,
        [police]
    );
}

/**
 * 사람(나)이 게임 행동을 한다 (소개 건너뛰기, 밤 행동, 투표, 최후의 한마디).
 * 기록만 하고, 진행은 부른 쪽이 이어간다. 기록했으면 true.
 */
export function submitUserAction(roomId: string, target: string | null) {
    const room = getRoom(roomId);
    const action = room && userAction(room);
    if (!room || !action) return false;
    switch (action.kind) {
        case 'introduction':
            markIntroduced(roomId, 'me');
            announce(
                roomId,
                `🙋 ${nameOf(gameOf(room)!, 'me')}님이 자기소개를 건너뛰었어요.`
            );
            return true;
        case 'kill':
        case 'save':
        case 'check': {
            if (!target || !action.options.some((o) => o.id === target))
                return false;
            if (action.kind === 'check') recordCheck(roomId, 'me', target);
            else if (action.kind === 'save')
                updateGame(roomId, (g) => ({
                    ...g,
                    night: {
                        ...g.night,
                        saves: { ...g.night.saves, me: target },
                    },
                }));
            else
                updateGame(roomId, (g) => ({
                    ...g,
                    night: { ...g.night, kill: target },
                }));
            return true;
        }
        case 'vote': {
            if (target && !action.options.some((o) => o.id === target))
                return false;
            updateGame(roomId, (g) => ({
                ...g,
                votes: { ...g.votes, me: target },
            }));
            const game = liveGame(getRoom(roomId)!)!;
            announce(
                roomId,
                `🗳️ ${nameOf(game, 'me')} → ${nameOf(game, target)}`
            );
            return true;
        }
        case 'verdict': {
            const index = Number(target);
            if (!target || !VERDICT_OPTIONS[index]) return false;
            // 다른 사람의 선택은 모두 투표한 뒤에 한꺼번에 공개한다
            updateGame(roomId, (g) => ({
                ...g,
                verdicts: {
                    ...g.verdicts,
                    me: { guilty: index === 0, note: '' },
                },
            }));
            return true;
        }
        case 'decision': {
            const beat = currentBeat(gameOf(room)!);
            const index = Number(target);
            if (beat?.type !== 'decision' || !target || !beat.options[index])
                return false;
            settleDecision(roomId, gameOf(room)!.epilogue!.at, 'me', index);
            return true;
        }
        case 'lastWords':
            updateGame(roomId, (g) => ({ ...g, lastSaid: true }));
            return true;
    }
}

/**
 * 게임 중 사람(나)이 메시지를 보냈을 때 상태를 고친다.
 * 에이전트가 반응해야 하면 true (소개 완료, 낮 토론, 마피아끼리 밤 대화, 내 최후의 한마디).
 */
function noteUserMessage(roomId: string) {
    const room = getRoom(roomId);
    const game = room && liveGame(room);
    if (!room || !game) return false;
    if (game.phase === 'epilogue') return noteEpilogueMessage(roomId, game);
    if (game.userRole === 'observer') return false;
    const me = playerOf(game, 'me');
    if (game.phase === 'introduction') {
        if (game.userRole === 'host') {
            updateGame(roomId, (g) => ({ ...g, hold: false }));
            return true;
        }
        if (nextIntroductionPlayer(game, room)?.id === 'me') {
            markIntroduced(roomId, 'me');
            return true;
        }
        return false;
    }
    if (game.phase === 'day') {
        // 내가 말하면 토론을 다시 센다 (사회자의 진행 멘트면 대기도 푼다)
        updateGame(roomId, (g) => ({ ...g, talk: 0, hold: false }));
        return true;
    }
    if (
        game.phase === 'night' &&
        me?.alive &&
        me.role === 'mafia' &&
        (game.night.step === 'chat' || game.night.step === 'kill')
    ) {
        // 같은 마피아 에이전트들이 내 말에 답할 수 있게 밤 대화를 다시 연다
        updateGame(roomId, (g) => ({
            ...g,
            night: { ...g.night, step: 'chat', chatted: [] },
        }));
        return aliveMafia(game, room).some((p) => p.id !== 'me');
    }
    if (game.phase === 'lastWords' && game.accused === 'me' && !game.lastSaid) {
        updateGame(roomId, (g) => ({ ...g, lastSaid: true }));
        return true;
    }
    return false;
}

/** ▶로 직접 이어갈 때: 사회자 대기를 풀고, 낮이면 토론을 다시 센다 */
function resumeGame(roomId: string) {
    const room = getRoom(roomId);
    const game = room && liveGame(room);
    if (!game) return;
    // 엔딩에서 내 한마디를 기다리고 있었으면 넘긴다
    const beat = currentBeat(game);
    if (beat?.type === 'line' && beat.speaker === 'me')
        nextBeat(roomId, game.epilogue!.at);
    if (beat?.type === 'decision' && beat.speaker === 'me')
        settleDecision(roomId, game.epilogue!.at, 'me', null);
    updateGame(roomId, (g) => ({
        ...g,
        hold: false,
        talk: g.phase === 'day' ? 0 : g.talk,
    }));
}

/**
 * 낮 토론이 잦아들었을 때. 관전 모드면 바로 투표로 넘어가고,
 * 사회·플레이어 모드면 더 얘기할 수 있게 멈춘다.
 */
function dayOver(roomId: string, io: ModeIO): 'next' | 'stop' {
    const room = getRoom(roomId);
    const game = room && liveGame(room);
    if (!game) return 'stop';
    if (game.userRole === 'observer') {
        startVote(roomId);
        io.resetBudget();
        return 'next';
    }
    io.idle(
        game.userRole === 'host'
            ? '토론이 잦아들었어요 · 진행 멘트를 하거나 [투표 시작]'
            : '토론이 잦아들었어요 · 더 얘기하거나 [투표 시작]'
    );
    return 'stop';
}

/** 낮 토론이나 엔딩 자유 대화에서 에이전트가 한 번 말했다 */
function countTalk(roomId: string) {
    updateGame(roomId, (g) =>
        g.phase === 'epilogue' && g.epilogue
            ? { ...g, epilogue: { ...g.epilogue, talk: g.epilogue.talk + 1 } }
            : { ...g, talk: g.talk + 1 }
    );
}

/** 플레이어 모드에서 살아 있는 동안 밤 행동을 하는 사람이 드러나지 않게 진행 상황을 가린다 */
function secretStatus(game: MafiaGame, text: string) {
    return game.userRole === 'player' && playerOf(game, 'me')?.alive
        ? `${game.day}번째 밤이 깊었어요…`
        : text;
}

const agentOf = (room: Room, id: string) =>
    room.agents.find((a) => a.id === id);

/**
 * 낮 토론을 뺀 게임 한 단계(자기소개, 한 명의 행동 또는 단계 전환)를 진행한다.
 * 사람(나)의 행동이나 사회자의 ▶를 기다려야 하면 'stop'.
 */
async function gameStep(
    room: Room,
    signal: AbortSignal,
    io: ModeIO
): Promise<'next' | 'stop'> {
    const game = liveGame(room);
    if (!game) return 'stop';
    if (game.hold) {
        io.idle(`사회자 차례예요 · ▶ ${holdLabel(game)}`);
        return 'stop';
    }
    switch (game.phase) {
        case 'introduction':
            return introductionStep(room, game, signal, io);
        case 'night':
            return nightStep(room, game, signal, io);
        case 'vote':
            return voteStep(room, game, signal, io);
        case 'lastWords':
            return lastWordsStep(room, game, signal, io);
        case 'verdict':
            return verdictStep(room, game, signal, io);
        default:
            return 'stop';
    }
}

/** 참가자 순서대로 공개 소개를 한 번씩 한다. 진행 모델의 화자 선택과 낮 토론 횟수는 쓰지 않는다 */
async function introductionStep(
    room: Room,
    game: MafiaGame,
    signal: AbortSignal,
    io: ModeIO
): Promise<'next' | 'stop'> {
    const next = nextIntroductionPlayer(game, room);
    if (!next) {
        if (signal.aborted) return 'next';
        toNight(room.id, true);
        io.resetBudget();
        return 'next';
    }
    if (next.id === 'me') {
        io.idle('🙋 자기소개 차례예요 · 입력창에서 소개하거나 [소개 건너뛰기]');
        return 'stop';
    }
    const agent = agentOf(room, next.id);
    if (!agent) return 'next';
    io.status(`🙋 자기소개 · ${agent.name}`);
    await io.sleep(500, signal);
    if (signal.aborted) return 'next';
    let published = false;
    const result = await io.speak(
        room,
        agent,
        {
            note: '',
            canPass: false,
            onMessage: (message) => {
                if (!published && !message.to?.length && message.text.trim()) {
                    // 첫 말풍선과 함께 완료를 기록해 새로고침·중단 뒤에도 소개를 반복하지 않는다.
                    published = true;
                    markIntroduced(room.id, agent.id);
                }
            },
        },
        signal
    );
    if (signal.aborted) return 'next';
    if (published) return 'next';
    if (result !== 'failed')
        io.idle(`🙋 ${agent.name}님의 자기소개가 비어 있어요 · ▶로 다시 시도`);
    return 'stop';
}

/** 고른 번호를 대상 id로. 고르지 않았으면 무작위로 정하고 다 보는 사람에게만 알린다 */
function pickOrRandom(
    roomId: string,
    agent: Agent,
    options: MafiaPlayer[],
    index: number | null
) {
    if (index !== null && options[index]) return options[index].id;
    const fallback = options[Math.floor(Math.random() * options.length)];
    announce(
        roomId,
        `⚠️ ${agent.name}님이 대상을 고르지 않아 ${fallback.name}님으로 정했어요`,
        ['gm']
    );
    return fallback.id;
}

/** 혼자 하는 밤 행동에서 선택 표시 다음 줄에 쓰게 하는 이유 */
const REASON_AFTER =
    '그다음 줄에 고른 이유를 한두 문장으로 짧게 쓴다. 이 이유는 사회자와 관전자만 보고, 다른 참가자는 아무도 보지 못한다.';

const NIGHT_ACT = {
    mafia: { emoji: '🔪', verb: '노림' },
    doctor: { emoji: '🩺', verb: '지킴' },
    police: { emoji: '🔍', verb: '조사' },
} as const;

/** 밤 행동의 선택과 이유를 다 보는 사람(사회자·관전자)에게만 알린다 */
function announceReason(
    roomId: string,
    game: MafiaGame,
    agent: Agent,
    role: keyof typeof NIGHT_ACT,
    target: string,
    reason: string
) {
    const act = NIGHT_ACT[role];
    const why = reason.replace(/\s+/g, ' ').trim().slice(0, 300);
    announce(
        roomId,
        `${act.emoji} ${ROLE_LABELS[role]} ${agent.name} → ${nameOf(game, target)} ${act.verb}${why ? ` · ${why}` : ''}`,
        ['gm']
    );
}

async function nightStep(
    room: Room,
    game: MafiaGame,
    signal: AbortSignal,
    io: ModeIO
): Promise<'next' | 'stop'> {
    const roomId = room.id;
    const night = game.night;
    const alive = alivePlayers(game, room);
    const team = aliveMafia(game, room);
    const setNight = (patch: Partial<MafiaGame['night']>) =>
        updateGame(roomId, (g) => ({ ...g, night: { ...g.night, ...patch } }));

    if (night.step === 'chat') {
        const next =
            team.length >= 2
                ? team.find(
                      (p) => p.id !== 'me' && !night.chatted.includes(p.id)
                  )
                : undefined;
        const agent = next && agentOf(room, next.id);
        if (!agent) {
            setNight({ step: 'kill' });
            return 'next';
        }
        io.status(secretStatus(game, `🔪 마피아끼리 대화 중 · ${agent.name}`));
        await io.sleep(700, signal);
        if (signal.aborted) return 'next';
        const result = await io.speak(
            room,
            agent,
            {
                note: '',
                // 첫 사람은 말을 꺼내고, 다음 사람은 덧붙일 말이 없으면 넘긴다
                canPass: night.chatted.length > 0,
                forceTo: team.filter((p) => p.id !== agent.id).map((p) => p.id),
            },
            signal
        );
        if (signal.aborted) return 'next';
        if (result === 'failed') return 'stop';
        setNight({ chatted: [...night.chatted, agent.id] });
        return 'next';
    }

    if (night.step === 'kill') {
        const targets = alive.filter((p) => p.role !== 'mafia');
        const next =
            night.kill === undefined
                ? team.find((p) => p.id !== 'me' && !(p.id in night.picks))
                : undefined;
        const agent = next && agentOf(room, next.id);
        if (agent) {
            const mates = team
                .filter((p) => p.id !== agent.id)
                .map((p) => p.id);
            io.status(
                secretStatus(game, `🔪 ${agent.name} 노릴 사람 고르는 중`)
            );
            await io.sleep(500, signal);
            if (signal.aborted) return 'next';
            let picked: number | null = null;
            let reason = '';
            const result = await io.speak(
                room,
                agent,
                {
                    note: '',
                    canPass: false,
                    // 같은 마피아가 없으면 아무에게도 보내지 않는다 (받는 사람이 비면 공개 메시지가 된다)
                    ...(mates.length ? { forceTo: mates } : { silent: true }),
                    choice: {
                        question: '오늘 밤 마피아가 노릴 사람을 고른다.',
                        options: targets.map((p) => p.name),
                        after: mates.length
                            ? '그다음 줄부터 쓰는 말은 같은 마피아만 본다. 고른 이유를 짧게 써도 되고 번호만 써도 된다.'
                            : REASON_AFTER,
                        onPick: (i, note) => {
                            picked = i;
                            reason = note;
                        },
                    },
                },
                signal
            );
            if (signal.aborted) return 'next';
            if (result === 'failed') return 'stop';
            const target = pickOrRandom(roomId, agent, targets, picked);
            // 같은 마피아가 있으면 이유는 이미 밤 대화로 남았다
            if (!mates.length)
                announceReason(roomId, game, agent, 'mafia', target, reason);
            setNight({ picks: { ...night.picks, [agent.id]: target } });
            return 'next';
        }
        const me = playerOf(game, 'me');
        if (
            night.kill === undefined &&
            game.userRole === 'player' &&
            me?.alive &&
            me.role === 'mafia'
        ) {
            io.idle('🔪 노릴 사람을 골라 주세요');
            return 'stop';
        }
        setNight({
            step: 'save',
            kill: night.kill ?? plurality(Object.values(night.picks)),
        });
        return 'next';
    }

    if (night.step === 'save' || night.step === 'check') {
        const role = night.step === 'save' ? 'doctor' : 'police';
        // 의사·경찰이 여럿이면 각자 따로 고른다. 에이전트가 먼저 고르고 나는 마지막에 고른다
        const waiting = alive.filter(
            (p) => p.role === role && !nightActed(night, role, p.id)
        );
        const actor = waiting.find((p) => p.id !== 'me') ?? waiting[0];
        const nextStep = night.step === 'save' ? 'check' : 'done';
        if (!actor) {
            setNight({ step: nextStep });
            return 'next';
        }
        if (actor.id === 'me') {
            io.idle(
                role === 'doctor'
                    ? '🩺 지킬 사람을 골라 주세요'
                    : '🔍 조사할 사람을 골라 주세요'
            );
            return 'stop';
        }
        const agent = agentOf(room, actor.id);
        if (!agent) {
            // 방에서 나간 에이전트는 건너뛴다 (alivePlayers가 거르지만 혹시 모를 때)
            setNight(
                role === 'doctor'
                    ? { saves: { ...night.saves, [actor.id]: '' } }
                    : { inspections: { ...night.inspections, [actor.id]: '' } }
            );
            return 'next';
        }
        const options =
            role === 'doctor' ? alive : alive.filter((p) => p.id !== actor.id);
        io.status(
            secretStatus(
                game,
                role === 'doctor'
                    ? `🩺 ${agent.name} 지킬 사람 고르는 중`
                    : `🔍 ${agent.name} 조사할 사람 고르는 중`
            )
        );
        await io.sleep(500, signal);
        if (signal.aborted) return 'next';
        let picked: number | null = null;
        let reason = '';
        const result = await io.speak(
            room,
            agent,
            {
                note: '',
                canPass: false,
                silent: true,
                choice: {
                    question:
                        role === 'doctor'
                            ? '오늘 밤 지킬 사람을 고른다. 마피아가 노릴 것 같은 사람을 지킨다(너 자신도 된다).'
                            : '오늘 밤 마피아인지 조사할 사람을 고른다.',
                    options: options.map((p) => p.name),
                    after: REASON_AFTER,
                    onPick: (i, note) => {
                        picked = i;
                        reason = note;
                    },
                },
            },
            signal
        );
        if (signal.aborted) return 'next';
        if (result === 'failed') return 'stop';
        const target = pickOrRandom(roomId, agent, options, picked);
        announceReason(roomId, game, agent, role, target, reason);
        if (role === 'doctor')
            setNight({ saves: { ...night.saves, [agent.id]: target } });
        else recordCheck(roomId, agent.id, target);
        return 'next';
    }

    // 밤 결과: 의사 중 한 명이라도 지켰으면 산다
    const victim =
        night.kill && !savedIds(night).includes(night.kill)
            ? night.kill
            : undefined;
    const record = (
        label: string,
        picks: Record<string, string> | undefined,
        legacy: string | undefined
    ) => {
        const targets = [
            ...Object.values(picks ?? {}).filter(Boolean),
            ...(legacy ? [legacy] : []),
        ];
        return targets.length
            ? ` · ${label} → ${targets.map((t) => nameOf(game, t)).join(', ')}`
            : '';
    };
    announce(
        roomId,
        `📝 ${game.day}번째 밤 기록: 마피아 → ${nameOf(game, night.kill)}${record(
            '의사',
            night.saves,
            night.save
        )}${record('경찰', night.inspections, night.check)}`,
        ['gm']
    );
    await io.sleep(game.userRole === 'observer' ? STEP_PAUSE : 300, signal);
    if (signal.aborted) return 'next';
    const dead = victim ? playerOf(game, victim) : undefined;
    if (dead) kill(roomId, dead.id, 'killed');
    announce(
        roomId,
        dead
            ? `☀️ ${game.day}번째 아침이 밝았어요. 밤사이 ${dead.name}님이 마피아에게 당했어요${roleTag(game, dead)}.`
            : `☀️ ${game.day}번째 아침이 밝았어요. 밤사이 아무도 죽지 않았어요.`
    );
    if (checkWinner(roomId)) {
        io.resetBudget();
        return 'next';
    }
    updateGame(roomId, (g) => ({
        ...g,
        phase: 'day',
        talk: 0,
        hold: g.userRole === 'host',
    }));
    io.resetBudget();
    return 'next';
}

async function voteStep(
    room: Room,
    game: MafiaGame,
    signal: AbortSignal,
    io: ModeIO
): Promise<'next' | 'stop'> {
    const roomId = room.id;
    const alive = alivePlayers(game, room);
    const next = alive.find((p) => p.id !== 'me' && !(p.id in game.votes));
    const agent = next && agentOf(room, next.id);
    if (agent) {
        const options = alive.filter((p) => p.id !== agent.id);
        io.status(`🗳️ ${agent.name} 투표 중`);
        await io.sleep(600, signal);
        if (signal.aborted) return 'next';
        let picked: number | null = null;
        const result = await io.speak(
            room,
            agent,
            {
                note: '',
                canPass: false,
                choice: {
                    question: game.verdict
                        ? '처형 후보로 지목할 사람에게 투표한다. 가장 많은 표를 받은 사람은 최후의 한마디 뒤 처형 찬반 투표에 오른다. 지금까지의 토론과 다른 사람의 투표를 보고 정한다. 기권도 고를 수 있다.'
                        : '처형할 사람에게 투표한다. 지금까지의 토론과 다른 사람의 투표를 보고 정한다. 기권도 고를 수 있다.',
                    options: [...options.map((p) => p.name), '기권'],
                    after: '그다음 줄부터 쓰는 말은 모두가 본다. 투표 이유나 한마디를 네 말투로 써도 되고 번호만 써도 된다.',
                    onPick: (i) => (picked = i),
                },
            },
            signal
        );
        if (signal.aborted) return 'next';
        if (result === 'failed') return 'stop';
        const target =
            picked !== null && options[picked] ? options[picked].id : null;
        // 번호를 쓰지 않은 표는 기권으로 세지만, 고른 기권과 구분되게 다 보는 사람에게 알린다
        if (picked === null)
            announce(
                roomId,
                `⚠️ ${agent.name}님이 투표 번호를 쓰지 않아 기권으로 셌어요`,
                ['gm']
            );
        updateGame(roomId, (g) => ({
            ...g,
            votes: { ...g.votes, [agent.id]: target },
        }));
        announce(roomId, `🗳️ ${agent.name} → ${nameOf(game, target)}`);
        return 'next';
    }
    if (game.userRole === 'player' && playerOf(game, 'me')?.alive) {
        if (!('me' in game.votes)) {
            io.idle('🗳️ 투표해 주세요');
            return 'stop';
        }
    }
    const counts = voteCounts(game.votes);
    const abstain = Object.values(game.votes).filter((v) => !v).length;
    const summary = Object.entries(counts)
        .sort((a, b) => b[1] - a[1])
        .map(([id, n]) => `${nameOf(game, id)} ${n}표`)
        .concat(abstain ? [`기권 ${abstain}`] : [])
        .join(', ');
    const accused = tally(game.votes);
    if (!accused) {
        announce(
            roomId,
            summary && Object.keys(counts).length
                ? `🗳️ 투표 결과: ${summary} · 동표라 아무도 처형하지 않아요.`
                : `🗳️ 투표 결과: 모두 기권 · 아무도 처형하지 않아요.`
        );
        await io.sleep(game.userRole === 'observer' ? STEP_PAUSE : 300, signal);
        toNight(roomId);
        io.resetBudget();
        return 'next';
    }
    announce(
        roomId,
        `🗳️ 투표 결과: ${summary} · ${nameOf(game, accused)}님의 최후의 한마디를 들어요.${game.verdict ? ' 그 뒤 처형할지 찬반 투표를 해요.' : ''}`
    );
    updateGame(roomId, (g) => ({
        ...g,
        phase: 'lastWords',
        accused,
        lastSaid: false,
    }));
    return 'next';
}

async function lastWordsStep(
    room: Room,
    game: MafiaGame,
    signal: AbortSignal,
    io: ModeIO
): Promise<'next' | 'stop'> {
    const roomId = room.id;
    const accused = game.accused ? playerOf(game, game.accused) : undefined;
    if (!accused) {
        toNight(roomId);
        return 'next';
    }
    if (!game.lastSaid) {
        if (accused.id === 'me') {
            io.idle('⚖️ 최후의 한마디를 남겨 주세요');
            return 'stop';
        }
        const agent = agentOf(room, accused.id);
        if (agent) {
            io.status(`⚖️ ${agent.name} 최후의 한마디`);
            await io.sleep(600, signal);
            if (signal.aborted) return 'next';
            const result = await io.speak(
                room,
                agent,
                { note: '', canPass: false },
                signal
            );
            if (signal.aborted) return 'next';
            if (result === 'failed') return 'stop';
        }
        updateGame(roomId, (g) => ({ ...g, lastSaid: true }));
        return 'next';
    }
    await io.sleep(game.userRole === 'observer' ? STEP_PAUSE : 300, signal);
    if (signal.aborted) return 'next';
    if (game.verdict) {
        updateGame(roomId, (g) => ({ ...g, phase: 'verdict', verdicts: {} }));
        announce(
            roomId,
            `⚖️ ${accused.name}님을 처형할지 찬반 투표해요. 찬성이 반대보다 많아야 처형하고, 같으면 살려 둬요.`
        );
        io.resetBudget();
        return 'next';
    }
    return execute(roomId, game, accused, io);
}

/** 지목된 사람을 처형하고 승패를 본다. 승패가 안 났으면 밤으로 */
function execute(
    roomId: string,
    game: MafiaGame,
    accused: MafiaPlayer,
    io: ModeIO
): 'next' {
    kill(roomId, accused.id, 'executed');
    announce(
        roomId,
        `⚖️ ${accused.name}님이 처형됐어요${roleTag(game, accused)}.`
    );
    if (!checkWinner(roomId)) toNight(roomId);
    io.resetBudget();
    return 'next';
}

/**
 * 처형 찬반 투표. 지목된 사람을 뺀 생존자가 서로의 선택을 모른 채 한 명씩 고르고,
 * 모두 고르면 각자의 한마디와 결과를 한꺼번에 공개한다.
 */
async function verdictStep(
    room: Room,
    game: MafiaGame,
    signal: AbortSignal,
    io: ModeIO
): Promise<'next' | 'stop'> {
    const roomId = room.id;
    const accused = game.accused ? playerOf(game, game.accused) : undefined;
    if (!accused) {
        toNight(roomId);
        io.resetBudget();
        return 'next';
    }
    const verdicts = game.verdicts ?? {};
    const voters = alivePlayers(game, room).filter((p) => p.id !== accused.id);
    const next = voters.find((p) => p.id !== 'me' && !(p.id in verdicts));
    const agent = next && agentOf(room, next.id);
    if (agent) {
        io.status(`⚖️ ${agent.name} 찬반 투표 중`);
        await io.sleep(600, signal);
        if (signal.aborted) return 'next';
        let picked: number | null = null;
        let note = '';
        const result = await io.speak(
            room,
            agent,
            {
                note: '',
                canPass: false,
                // 다른 사람이 앞사람의 선택을 보고 따라 고르지 않게 결과를 공개할 때까지 숨긴다
                silent: true,
                choice: {
                    question: `${accused.name}을 처형할지 정한다. 다른 사람의 선택은 모두 투표한 뒤에 공개된다.`,
                    options: [...VERDICT_OPTIONS],
                    after: '그다음 줄에 이유나 한마디를 네 말투로 짧게 써도 된다. 이 말은 모두가 투표를 마친 뒤 결과와 함께 공개된다.',
                    onPick: (i, text) => {
                        picked = i;
                        note = text;
                    },
                },
            },
            signal
        );
        if (signal.aborted) return 'next';
        if (result === 'failed') return 'stop';
        if (picked === null)
            announce(
                roomId,
                `⚠️ ${agent.name}님이 찬반을 고르지 않아 반대로 셌어요`,
                ['gm']
            );
        const guilty: boolean | null = picked === null ? null : picked === 0;
        updateGame(roomId, (g) => ({
            ...g,
            verdicts: {
                ...g.verdicts,
                [agent.id]: {
                    guilty,
                    note: note.replace(/\s+/g, ' ').trim().slice(0, 300),
                },
            },
        }));
        return 'next';
    }
    const me = playerOf(game, 'me');
    if (
        game.userRole === 'player' &&
        me?.alive &&
        me.id !== accused.id &&
        !('me' in verdicts)
    ) {
        io.idle('⚖️ 처형할지 골라 주세요');
        return 'stop';
    }
    await io.sleep(game.userRole === 'observer' ? STEP_PAUSE : 300, signal);
    if (signal.aborted) return 'next';
    // 각자의 한마디를 투표 순서대로 공개한 뒤 결과를 알린다
    for (const voter of voters) {
        const text = verdicts[voter.id]?.note;
        if (text && voter.id !== 'me')
            appendMessage(roomId, {
                sender: voter.id,
                senderName: voter.name,
                text,
            });
    }
    const { guilty, spare, execute: executed } = verdictResult(verdicts);
    const names = (want: boolean) =>
        voters
            .filter((p) => (verdicts[p.id]?.guilty === true) === want)
            .map((p) => p.name)
            .join(', ') || '없음';
    announce(
        roomId,
        `⚖️ 찬반 결과: 처형 ${guilty} · 살려 둠 ${spare} (처형: ${names(true)} / 살려 둠: ${names(false)})`
    );
    if (executed) return execute(roomId, game, accused, io);
    announce(roomId, `⚖️ ${accused.name}님은 살아남았어요.`);
    toNight(roomId);
    io.resetBudget();
    return 'next';
}

/* ---------------- 엔딩 ---------------- */

/** 엔딩 장면 at을 마쳤다. 이미 넘어갔으면 그대로 둔다 (같은 장면을 두 번 넘기지 않게) */
function nextBeat(roomId: string, at: number) {
    updateGame(roomId, (g) =>
        g.phase === 'epilogue' && g.epilogue?.at === at
            ? { ...g, epilogue: { ...g.epilogue, at: at + 1, talk: 0 } }
            : g
    );
}

function endEpilogue(roomId: string) {
    updateGame(roomId, (g) => ({ ...g, phase: 'ended', hold: false }));
}

/** 엔딩 중 사람(나)이 말했을 때. 내 한마디 차례면 장면을 넘기고, 자유 대화면 반응한다 */
function noteEpilogueMessage(roomId: string, game: MafiaGame) {
    const beat = currentBeat(game);
    if (beat?.type === 'line' && beat.speaker === 'me') {
        nextBeat(roomId, game.epilogue!.at);
        return true;
    }
    return beat?.type === 'talk';
}

/**
 * 연출 모델에게 엔딩 장면을 받는다. 인물의 결정이 나올 때마다 그 결정이 담긴 기록으로 이어서 다시 받는다.
 * 실패하면 범용 엔딩(모두의 자유 대화)을 쓴다.
 */
async function planEpilogue(room: Room, game: MafiaGame, signal: AbortSignal) {
    let beats: MafiaEndingBeat[];
    let after = game.epilogue?.after;
    try {
        const res = await runModeAction<MafiaEndingPlan>(
            'mafia',
            'ending',
            endingRequest(room, game, assistantModel(), currentUserName()),
            signal
        );
        if (signal.aborted) return;
        if (!res.ok) throw new Error(res.error);
        beats = resolveBeats(game, res.beats);
        after = res.after ?? after;
    } catch (err) {
        if (signal.aborted) return;
        announce(
            room.id,
            `⚠️ 엔딩 연출을 만들지 못해 모두의 이야기로 마무리해요: ${err instanceof Error ? err.message : String(err)}`,
            ['gm']
        );
        beats = fallbackBeats(game);
    }
    updateGame(room.id, (g) =>
        g.phase === 'epilogue'
            ? {
                  ...g,
                  epilogue: {
                      ...g.epilogue,
                      beats,
                      at: 0,
                      talk: 0,
                      rounds: (g.epilogue?.rounds ?? 0) + 1,
                      ...(after && { after }),
                  },
              }
            : g
    );
}

/** 서술로 이야기에서 빠진 사람을 기록한다. 게임 결과(players)는 바꾸지 않는다 */
function markGone(roomId: string, ids: string[] | undefined) {
    if (!ids?.length) return;
    updateGame(roomId, (g) =>
        g.epilogue
            ? {
                  ...g,
                  epilogue: {
                      ...g.epilogue,
                      gone: [...new Set([...(g.epilogue.gone ?? []), ...ids])],
                  },
              }
            : g
    );
}

/**
 * 엔딩 장면 at의 결정을 마쳤다. 고른 것을 기록에 남기고, 그 뒤 장면은 연출 모델이
 * 이 선택을 보고 다시 짜도록 비운다. 이미 넘어갔으면 그대로 둔다.
 */
function settleDecision(
    roomId: string,
    at: number,
    speaker: string,
    index: number | null,
    { quiet = false }: { quiet?: boolean } = {}
) {
    const room = getRoom(roomId);
    const game = room && gameOf(room);
    const beat = game && currentBeat(game);
    if (!game || beat?.type !== 'decision' || game.epilogue?.at !== at) return;
    const name = nameOf(game, speaker);
    if (!quiet)
        announce(
            roomId,
            index !== null && beat.options[index]
                ? `🎬 ${name}님의 선택: ${beat.options[index]}`
                : `🎬 ${name}님은 아무것도 고르지 않았어요`
        );
    updateGame(roomId, (g) =>
        g.phase === 'epilogue' && g.epilogue?.at === at
            ? {
                  ...g,
                  epilogue: { ...g.epilogue, beats: undefined, at: 0, talk: 0 },
              }
            : g
    );
}

/**
 * 엔딩을 한 단계 진행한다. 자유 대화 장면은 undefined를 돌려 진행 모델에게 맡긴다.
 * 장면을 다 마치면 게임을 끝낸다 (그 뒤는 일반 대화처럼 이어갈 수 있다).
 */
function epilogueStep(
    room: Room,
    game: MafiaGame,
    signal: AbortSignal,
    io: ModeIO
): Promise<'next' | 'stop'> | undefined {
    const epilogue = game.epilogue ?? { at: 0, talk: 0 };
    if (!epilogue.beats)
        return (async (): Promise<'next' | 'stop'> => {
            io.status('🎬 엔딩을 준비하는 중');
            await planEpilogue(room, game, signal);
            io.resetBudget();
            return 'next';
        })();
    const at = epilogue.at;
    const beat = epilogue.beats[at];
    if (!beat) {
        endEpilogue(room.id);
        io.idle('게임이 끝났어요 · ▶ 뒷얘기 · 🎲 새 게임');
        return Promise.resolve('stop');
    }
    if (beat.type === 'talk') {
        if (epilogue.talk < beat.turns && talkAgents(room, beat).length)
            return undefined;
        nextBeat(room.id, at);
        io.resetBudget();
        return Promise.resolve('next');
    }
    if (beat.type === 'narration')
        return (async (): Promise<'next' | 'stop'> => {
            io.status('🎬 엔딩');
            await io.sleep(
                game.userRole === 'observer' ? STEP_PAUSE : 600,
                signal
            );
            if (signal.aborted) return 'next';
            announce(room.id, `🎬 ${beat.text}`);
            markGone(room.id, beat.gone);
            nextBeat(room.id, at);
            return 'next';
        })();
    if (beat.type === 'decision') {
        // 이미 이야기에서 빠진 사람에게는 맡기지 않고, 그대로 이어서 다시 짠다
        if (isGone(game, beat.speaker)) {
            settleDecision(room.id, at, beat.speaker, null, { quiet: true });
            return Promise.resolve('next');
        }
        if (beat.speaker === 'me') {
            io.idle('🎬 엔딩 속 내 결정 차례예요 · 위에서 고르거나 ▶로 넘기기');
            return Promise.resolve('stop');
        }
        const agent = agentOf(room, beat.speaker);
        if (!agent) {
            settleDecision(room.id, at, beat.speaker, null, { quiet: true });
            return Promise.resolve('next');
        }
        return (async (): Promise<'next' | 'stop'> => {
            io.status(`🎬 ${agent.name}`);
            await io.sleep(600, signal);
            if (signal.aborted) return 'next';
            let picked: number | null = null;
            const result = await io.speak(
                room,
                agent,
                {
                    note: '',
                    canPass: false,
                    choice: {
                        question: `엔딩 속 너의 결정: ${beat.direction || '무엇을 할지 정한다.'}`,
                        options: beat.options,
                        after: '그다음 줄부터 이 순간 네가 하는 말을 네 말투로 쓴다. 모두가 본다.',
                        onPick: (i) => (picked = i),
                    },
                },
                signal
            );
            if (signal.aborted) return 'next';
            if (result === 'failed') return 'stop';
            settleDecision(room.id, at, agent.id, picked);
            io.resetBudget();
            return 'next';
        })();
    }
    // 엔딩 서술로 이미 이야기에서 빠진 사람의 차례는 건너뛴다
    if (isGone(game, beat.speaker)) {
        nextBeat(room.id, at);
        return Promise.resolve('next');
    }
    if (beat.speaker === 'me') {
        io.idle('🎬 엔딩 속 내 차례예요 · 입력창에 한마디하거나 ▶로 넘기기');
        return Promise.resolve('stop');
    }
    const agent = agentOf(room, beat.speaker);
    if (!agent) {
        nextBeat(room.id, at);
        return Promise.resolve('next');
    }
    return (async (): Promise<'next' | 'stop'> => {
        io.status(`🎬 ${agent.name}`);
        await io.sleep(600, signal);
        if (signal.aborted) return 'next';
        let published = false;
        const result = await io.speak(
            room,
            agent,
            {
                note: '',
                canPass: false,
                onMessage: () => {
                    // 첫 말풍선과 함께 장면을 넘겨 새로고침·중단 뒤에도 같은 장면을 반복하지 않는다
                    if (!published) nextBeat(room.id, at);
                    published = true;
                },
            },
            signal
        );
        if (signal.aborted) return 'next';
        if (result === 'failed' && !published) return 'stop';
        nextBeat(room.id, at);
        return 'next';
    })();
}

/**
 * 대화 엔진 훅. 낮 토론만 진행 모델이 맡고, 자기소개·밤 행동·투표·최후의 한마디는 게임이 진행한다.
 * 게임이 없거나 끝났으면 일반 대화처럼 동작한다.
 */
export const mafiaEngine: ModeEngine = {
    onUserMessage(roomId) {
        const room = getRoom(roomId);
        if (!room || !liveGame(room)) return undefined;
        // 단계에 따라 반응할지 정한다 (낮 토론, 마피아끼리 밤 대화, 내 최후의 한마디)
        return noteUserMessage(roomId) ? 'react' : 'ignore';
    },
    onResume: resumeGame,
    step(room, signal, io) {
        const game = liveGame(room);
        if (!game) return undefined;
        if (game.phase === 'epilogue')
            return epilogueStep(room, game, signal, io);
        if (game.phase !== 'day' || game.hold)
            return gameStep(room, signal, io);
        if (game.talk >= game.dayTalk)
            return Promise.resolve(dayOver(room.id, io));
        return undefined;
    },
    onTalk(roomId) {
        const room = getRoom(roomId);
        if (room && liveGame(room)) countTalk(roomId);
    },
    onQuiet(roomId, io) {
        const room = getRoom(roomId);
        const game = room && liveGame(room);
        if (!game) return undefined;
        if (game.phase === 'epilogue') {
            // 엔딩 자유 대화가 잦아들면 다음 장면으로
            nextBeat(roomId, game.epilogue?.at ?? 0);
            io.resetBudget();
            return 'next';
        }
        return dayOver(roomId, io);
    },
};
