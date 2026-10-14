import { describe, expect, it } from 'vitest';
import type { Agent, Message, Room } from '@/types/chat';
import type { MafiaGame, MafiaRole, MafiaSetup } from './types';
import { buildPrompt, moderatorTranscript } from '@utils/prompt/prompt';
import {
    knownRole,
    holdLabel,
    newGame,
    phaseLabel,
    roleCounts,
    setupProblem,
    speakingAgents,
    tally,
    userAction,
    userCanSee,
    userComposer,
    userSeesAll,
    userSeesPending,
    verdictResult,
    winnerOf,
} from './rules';

const agent = (id: string, name: string): Agent => ({
    id,
    name,
    emoji: '🙂',
    color: '#fff',
    persona: '',
    profileId: null,
    model: '',
});

const AGENTS = [
    agent('a', '철수'),
    agent('b', '영희'),
    agent('c', '지수'),
    agent('d', '민수'),
];

function game(
    roles: Record<string, MafiaRole>,
    patch: Partial<MafiaGame> = {}
): MafiaGame {
    return {
        userRole: 'observer',
        reveal: false,
        dayTalk: 12,
        phase: 'day',
        day: 1,
        players: Object.entries(roles).map(([id, role]) => ({
            id,
            name: id === 'me' ? '나' : AGENTS.find((a) => a.id === id)!.name,
            role,
            alive: true,
        })),
        night: { step: 'chat', chatted: [], picks: {} },
        votes: {},
        talk: 0,
        hold: false,
        checks: [],
        ...patch,
    };
}

const room = (g?: MafiaGame, messages: Message[] = []): Room => ({
    id: 'r',
    name: '마을',
    topic: '산골 마을',
    profileId: null,
    mode: 'mafia',
    modeState: { mafia: g },
    agents: AGENTS,
    messages,
    updatedAt: 0,
});

const ctx = { userName: '나', now: '지금', location: '', note: '' };

describe('setup', () => {
    const setup = {
        userRole: 'observer' as const,
        mafia: 1,
        doctor: 1,
        police: 1,
        reveal: false,
        dayTalk: 12,
    };

    it('needs enough players and fewer mafia than half', () => {
        expect(setupProblem(setup, 3)).toContain('4명 이상');
        expect(setupProblem(setup, 4)).toBeNull();
        expect(setupProblem({ ...setup, mafia: 2 }, 4)).toContain('절반');
        // 플레이어로 참가하면 나도 한 자리
        expect(setupProblem({ ...setup, userRole: 'player' }, 3)).toBeNull();
    });

    it('deals every role once and seats me only as a player', () => {
        const dealt = newGame(
            room(),
            { ...setup, userRole: 'player', mafia: 2 },
            '나',
            () => 0.3
        );
        expect(dealt.players.map((p) => p.id).sort()).toEqual([
            'a',
            'b',
            'c',
            'd',
            'me',
        ]);
        const roles = dealt.players.map((p) => p.role).sort();
        expect(roles).toEqual([
            'citizen',
            'doctor',
            'mafia',
            'mafia',
            'police',
        ]);
        expect(dealt.phase).toBe('introduction');
        expect(dealt.day).toBe(1);
        expect(dealt.introduced).toEqual([]);
        expect(dealt.hold).toBe(false);
        expect(newGame(room(), { ...setup, userRole: 'host' }, '나').hold).toBe(
            true
        );
    });

    it('deals several doctors and police and checks their counts', () => {
        const big = { ...setup, mafia: 1, doctor: 2, police: 2 };
        expect(setupProblem(big, 4)).toContain('역할 수가 참가자보다');
        expect(setupProblem(big, 5)).toBeNull();
        expect(setupProblem({ ...setup, doctor: -1 }, 5)).toContain(
            '의사 수는'
        );
        expect(setupProblem({ ...setup, police: 6 }, 9)).toContain('경찰 수는');
        const dealt = newGame(
            room(),
            { ...big, userRole: 'player' },
            '나',
            () => 0.3
        );
        expect(dealt.players.map((p) => p.role).sort()).toEqual([
            'doctor',
            'doctor',
            'mafia',
            'police',
            'police',
        ]);
    });

    it('still reads setups saved with on/off doctor and police', () => {
        const legacy = {
            ...setup,
            doctor: true,
            police: false,
        } as unknown as MafiaSetup;
        expect(setupProblem(legacy, 4)).toBeNull();
        expect(
            newGame(room(), legacy, '나', () => 0.3)
                .players.map((p) => p.role)
                .sort()
        ).toEqual(['citizen', 'citizen', 'doctor', 'mafia']);
    });

    it('counts roles from the game, or from the setup before it starts', () => {
        // 설정만 있으면: 에이전트 4 + 나 = 5명 → 마피아 2, 의사 0, 경찰 1, 시민 2
        expect(
            roleCounts({
                ...room(),
                mafia: {
                    ...setup,
                    userRole: 'player',
                    mafia: 2,
                    doctor: 0,
                },
            })
        ).toEqual({ mafia: 2, doctor: 0, police: 1, citizen: 2 });
        const dealt = newGame(room(), setup, '나', () => 0.3);
        expect(roleCounts(room(dealt))).toEqual({
            mafia: 1,
            doctor: 1,
            police: 1,
            citizen: 1,
        });
    });
});

describe('manual role assignment', () => {
    const setup: MafiaSetup = {
        userRole: 'observer',
        roleAssignment: 'manual',
        mafia: 1,
        doctor: 1,
        police: 1,
        reveal: false,
        dayTalk: 12,
        assignedRoles: { a: 'mafia', b: 'doctor', c: 'police', d: 'citizen' },
    };

    it('uses the specified roles without consulting randomness, including duplicate names', () => {
        const sameNames = {
            ...room(),
            agents: AGENTS.map((a) => ({ ...a, name: '동명이인' })),
        };
        const random = () => {
            throw new Error('must not shuffle manual assignments');
        };
        const g = newGame(sameNames, setup, '나', random);
        expect(
            Object.fromEntries(g.players.map((p) => [p.id, p.role]))
        ).toEqual(setup.assignedRoles);
        expect(g.phase).toBe('introduction');
        expect(g.introduced).toEqual([]);
    });

    it('includes my assignment only when I am a player and ignores removed IDs', () => {
        const withMe: MafiaSetup = {
            ...setup,
            userRole: 'player',
            assignedRoles: {
                ...setup.assignedRoles,
                me: 'citizen',
                removed: 'mafia',
            },
        };
        expect(setupProblem(withMe, AGENTS)).toBeNull();
        expect(newGame(room(), withMe, '나').players.at(-1)).toMatchObject({
            id: 'me',
            role: 'citizen',
        });
        expect(
            setupProblem({ ...withMe, userRole: 'host' }, AGENTS)
        ).toBeNull();
        expect(
            newGame(room(), { ...withMe, userRole: 'host' }, '나').players
        ).toHaveLength(4);
    });

    it.each<{ assignedRoles: Record<string, MafiaRole>; expected: string }>([
        {
            assignedRoles: { b: 'doctor', c: 'police', d: 'citizen' },
            expected: '철수의 역할',
        },
        {
            assignedRoles: {
                a: 'citizen',
                b: 'doctor',
                c: 'police',
                d: 'citizen',
            },
            expected: '마피아 1명',
        },
        {
            assignedRoles: {
                a: 'mafia',
                b: 'doctor',
                c: 'doctor',
                d: 'citizen',
            },
            expected: '의사 1명',
        },
        {
            assignedRoles: {
                a: 'mafia',
                b: 'doctor',
                c: 'citizen',
                d: 'citizen',
            },
            expected: '경찰 1명',
        },
    ])(
        'refuses an incomplete or inconsistent roster ($expected)',
        ({ assignedRoles, expected }) => {
            const invalid = { ...setup, assignedRoles };
            expect(setupProblem(invalid, AGENTS)).toContain(expected);
            expect(() => newGame(room(), invalid, '나')).toThrow(expected);
        }
    );

    it('requires assignments for new agents and for a newly enabled player', () => {
        const added = [...AGENTS, agent('new', '새 멤버')];
        expect(setupProblem(setup, added)).toContain('새 멤버의 역할');
        expect(
            setupProblem({ ...setup, userRole: 'player' }, AGENTS)
        ).toContain('나의 역할');
    });

    it.each(['random', undefined] as const)(
        'retains automatic dealing for %s even if stale manual roles exist',
        (roleAssignment) => {
            const auto = {
                ...setup,
                roleAssignment,
                assignedRoles: { a: 'mafia' as const },
            };
            expect(setupProblem(auto, AGENTS)).toBeNull();
            expect(
                newGame(room(), auto, '나', () => 0.3)
                    .players.map((p) => p.role)
                    .sort()
            ).toEqual(['citizen', 'doctor', 'mafia', 'police']);
        }
    );
});

describe('rules', () => {
    it('counts votes and ignores ties and abstentions', () => {
        expect(tally({ a: 'b', c: 'b', b: 'a' })).toBe('b');
        expect(tally({ a: 'b', b: 'a' })).toBeNull();
        expect(tally({ a: null, b: null })).toBeNull();
    });

    it('executes only when guilty votes outnumber the rest, counting a missing pick as spare', () => {
        const v = (guilty: boolean | null) => ({ guilty, note: '' });
        expect(verdictResult({ a: v(true), b: v(true), c: v(false) })).toEqual({
            guilty: 2,
            spare: 1,
            execute: true,
        });
        expect(verdictResult({ a: v(true), b: v(false) }).execute).toBe(false);
        expect(verdictResult({ a: v(true), b: v(null) }).execute).toBe(false);
        expect(verdictResult({}).execute).toBe(false);
    });

    it('lets only the living who stayed in the story talk after an ending that says the dead cannot', () => {
        const ended = (after?: 'all' | 'alive') =>
            game(
                { a: 'mafia', b: 'citizen', c: 'citizen', d: 'doctor' },
                {
                    phase: 'ended',
                    winner: 'mafia',
                    epilogue: { at: 0, talk: 0, gone: ['c'], after },
                }
            );
        const names = (g: MafiaGame) =>
            speakingAgents(room(g)).map((a) => a.name);
        const g = ended('alive');
        g.players[1].alive = false;
        expect(names(g)).toEqual(['철수', '민수']);
        // 정하지 않았으면(이전에 저장된 게임) 예전처럼 모두 말할 수 있다
        expect(names(ended())).toEqual(['철수', '영희', '지수', '민수']);
    });

    it('ends when mafia are gone or reach parity', () => {
        const g = game({ a: 'mafia', b: 'citizen', c: 'citizen', d: 'doctor' });
        expect(winnerOf(g, room(g))).toBeNull();
        g.players[1].alive = false;
        g.players[2].alive = false;
        expect(winnerOf(g, room(g))).toBe('mafia');
        g.players[0].alive = false;
        expect(winnerOf(g, room(g))).toBe('citizen');
    });
});

describe('what a player can see', () => {
    const roles = {
        a: 'mafia',
        b: 'doctor',
        c: 'citizen',
        d: 'citizen',
        me: 'police',
    } as const;

    it('hides other roles and private messages until the player dies', () => {
        const g = game(roles, { userRole: 'player' });
        const r = room(g);
        expect(userSeesAll(r)).toBe(false);
        expect(knownRole(r, 'me', 'a')).toBeUndefined();
        expect(knownRole(r, 'me', 'me')).toBe('police');
        const mafiaChat: Message = {
            id: 'm',
            sender: 'a',
            text: '민수 잡자',
            ts: 0,
            to: ['x'],
        };
        expect(userCanSee(r, mafiaChat)).toBe(false);
        expect(userCanSee(r, { ...mafiaChat, to: ['me'] })).toBe(true);
        expect(userSeesPending(r, { silent: true })).toBe(false);
        expect(userSeesPending(r, { to: ['b'] })).toBe(false);
        expect(userSeesPending(r, {})).toBe(true);

        g.checks.push({ day: 1, target: 'b', mafia: false });
        expect(knownRole(r, 'me', 'b')).toBe('notMafia');
        // 다른 경찰의 조사 결과는 모른다
        g.checks.push({ day: 1, target: 'a', mafia: true, by: 'c' });
        expect(knownRole(r, 'me', 'a')).toBeUndefined();

        g.players.find((p) => p.id === 'me')!.alive = false;
        expect(userSeesAll(r)).toBe(true);
        expect(knownRole(r, 'me', 'a')).toBe('mafia');
    });

    it('lets mafia players see each other and chat only with the team at night', () => {
        const g = game(
            {
                a: 'mafia',
                b: 'doctor',
                c: 'citizen',
                d: 'citizen',
                me: 'mafia',
            },
            { userRole: 'player', phase: 'night' }
        );
        const r = room(g);
        expect(knownRole(r, 'me', 'a')).toBe('mafia');
        expect(userComposer(r)).toMatchObject({ allowed: true, to: ['a'] });
        expect(userAction(r)).toMatchObject({ kind: 'kill' });
        const options =
            userAction(r)!.kind === 'kill'
                ? (userAction(r) as { options: { id: string }[] }).options
                : [];
        expect(options.map((o) => o.id)).toEqual(['b', 'c', 'd']);
    });

    it('silences citizens at night and observers always', () => {
        const night = game(roles, { userRole: 'player', phase: 'night' });
        expect(userComposer(room(night))).toMatchObject({ allowed: false });
        const watch = game(roles, { userRole: 'observer' });
        expect(userComposer(room(watch))).toMatchObject({ allowed: false });
        expect(userAction(room(watch))).toBeNull();
    });

    it('asks a living player to vote and to give last words', () => {
        const g = game(roles, { userRole: 'player', phase: 'vote' });
        expect(userAction(room(g))).toMatchObject({
            kind: 'vote',
            abstain: true,
        });
        g.votes.me = null;
        expect(userAction(room(g))).toBeNull();
        const accused = game(roles, {
            userRole: 'player',
            phase: 'lastWords',
            accused: 'me',
            lastSaid: false,
        });
        expect(userAction(room(accused))).toMatchObject({ kind: 'lastWords' });
    });

    it.each(['observer', 'host', 'player'] as const)(
        'hides every assigned role during introductions from a %s',
        (userRole) => {
            const g = game(roles, { userRole, phase: 'introduction' });
            const r = room(g);
            for (const viewer of ['me', ...AGENTS.map((a) => a.id)])
                for (const player of g.players)
                    expect(knownRole(r, viewer, player.id)).toBeUndefined();
            expect(phaseLabel(g)).toContain('자기소개');
            expect(holdLabel(g)).toContain('자기소개');
        }
    );

    it('allows a player to introduce themselves only at their own turn', () => {
        const g = game(roles, {
            userRole: 'player',
            phase: 'introduction',
            introduced: [],
        });
        const r = room(g);
        expect(userComposer(r)).toMatchObject({ allowed: false });
        expect(userAction(r)).toBeNull();

        g.introduced = AGENTS.map((a) => a.id);
        expect(userComposer(r)).toMatchObject({ allowed: true, tools: false });
        expect(userAction(r)).toMatchObject({ kind: 'introduction' });

        g.introduced.push('me');
        expect(userAction(r)).toBeNull();
    });
});

describe('prompts', () => {
    const g = game({ a: 'mafia', b: 'mafia', c: 'police', d: 'citizen' });
    const chat: Message = {
        id: 'n1',
        sender: 'a',
        text: '오늘은 민수',
        ts: 1,
        to: ['b'],
    };
    const check: Message = {
        id: 'n2',
        sender: 'system',
        text: '🔍 조사 결과: 철수님은 마피아예요',
        ts: 2,
        notice: true,
        to: ['c'],
    };
    const morning: Message = {
        id: 'n3',
        sender: 'system',
        text: '☀️ 아침이 밝았어요',
        ts: 3,
        notice: true,
    };
    const r = room(g, [chat, check, morning]);

    it('tells mafia their team and keeps others in the dark', () => {
        const mafia = buildPrompt(r, AGENTS[0], ctx);
        expect(mafia.instructions).toContain('너의 역할: 마피아');
        expect(mafia.instructions).toContain('같은 마피아: 영희');
        expect(mafia.instructions).toContain('귓속말("@@")이 없다');
        expect(mafia.instructions).not.toContain('@@영희');
        expect(mafia.messages[0].content).toContain(
            '철수 (마피아끼리): 오늘은 민수'
        );
        expect(mafia.messages[0].content).not.toContain('조사 결과');

        const police = buildPrompt(r, AGENTS[2], ctx);
        expect(police.instructions).toContain('너의 역할: 경찰');
        expect(police.instructions).not.toContain('같은 마피아');
        const log = police.messages[0].content as string;
        expect(log).not.toContain('오늘은 민수');
        expect(log).toContain('📢 진행 (너만 봄): 🔍 조사 결과');
        expect(log).toContain('📢 진행: ☀️ 아침이 밝았어요');

        const citizen = buildPrompt(r, AGENTS[3], ctx);
        expect(citizen.messages[0].content).not.toContain('조사 결과');
    });

    it('keeps private game messages away from the moderator', () => {
        const transcript = moderatorTranscript(r, '나');
        expect(transcript).toEqual([
            { speaker: '진행', text: '☀️ 아침이 밝았어요' },
        ]);
    });

    it('asks for a public self-introduction before revealing roles or teammates', () => {
        const introductionRoom = room({
            ...g,
            phase: 'introduction',
            introduced: [],
            checks: [{ day: 1, target: 'a', mafia: true }],
        });
        introductionRoom.agents = AGENTS.map((a, i) => ({
            ...a,
            persona: `공개할 배경 ${i}. 취미를 소개할 수 있다.`,
            secret: `숨긴 사정 ${i}`,
        }));
        for (const self of introductionRoom.agents) {
            const prompt = buildPrompt(introductionRoom, self, ctx);
            expect(prompt.instructions).not.toContain('너의 역할:');
            expect(prompt.instructions).not.toContain('같은 마피아:');
            expect(prompt.instructions).toContain(self.persona);
            for (const other of introductionRoom.agents.filter(
                (a) => a.id !== self.id
            ))
                expect(prompt.instructions).not.toContain(other.persona);
            const content = prompt.messages[0].content as string;
            expect(content).toContain('자기소개');
            expect(content).not.toContain('네 조사 결과:');
        }
    });
});
