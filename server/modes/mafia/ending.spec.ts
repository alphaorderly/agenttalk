// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
    ENDING_MAX_TURNS,
    ENDING_NARRATION_MAX,
    mafiaEndingRequestSchema,
    type MafiaEndingRequest,
} from '../../../shared/modes/mafia-ending.ts';
import {
    MAFIA_ENDING_INSTRUCTIONS,
    mafiaEndingPrompt,
    parseMafiaEnding,
} from './ending.ts';

const request = (): MafiaEndingRequest => ({
    profileId: null,
    model: '',
    reasoning: null,
    topic: '폐쇄 시설의 데스게임. 마피아가 이기면 권총을 받는다.',
    userName: '나',
    winner: 'mafia',
    decisionsLeft: 5,
    players: [
        {
            name: '철수',
            role: '마피아',
            team: 'mafia',
            alive: true,
            human: false,
        },
        {
            name: '영희',
            role: '시민',
            team: 'citizen',
            alive: false,
            death: '1번째 밤에 마피아에게 당함',
            human: false,
        },
    ],
    transcript: [{ speaker: '진행', text: '🏁 마피아 팀 승리!' }],
});

describe('mafia ending', () => {
    it('accepts a request and hands the setting and result to the director', () => {
        expect(mafiaEndingRequestSchema.safeParse(request()).success).toBe(
            true
        );
        const prompt = JSON.parse(mafiaEndingPrompt(request()));
        expect(prompt.topic).toContain('권총');
        expect(prompt.winner).toBe('마피아 팀');
        expect(prompt.players).toHaveLength(2);
        expect(prompt.decisionsLeft).toBe(5);
    });

    it('leaves a character’s action to a decision instead of pre-writing its outcome', () => {
        expect(MAFIA_ENDING_INSTRUCTIONS).toContain('decision');
        expect(MAFIA_ENDING_INSTRUCTIONS).toContain(
            '결과를 미리 정해 narration으로 쓰지 않는다'
        );
        expect(MAFIA_ENDING_INSTRUCTIONS).not.toContain('그대로 실행');
    });

    it('parses fenced JSON, drops malformed beats and clamps lengths', () => {
        const text = `\`\`\`json
{"beats":[
  {"type":"narration","text":"${'가'.repeat(ENDING_NARRATION_MAX + 50)}"},
  {"type":"line","speaker":"철수","direction":"총을 받았다"},
  {"type":"talk","speakers":"all","turns":99,"direction":"뒷얘기"},
  {"type":"dance"},
  {"type":"line","direction":"누가?"}
]}
\`\`\``;
        const { beats } = parseMafiaEnding(text);
        expect(beats.map((b) => b.type)).toEqual(['narration', 'line', 'talk']);
        expect(beats[0]).toMatchObject({
            text: '가'.repeat(ENDING_NARRATION_MAX),
        });
        expect(beats[2]).toMatchObject({ turns: ENDING_MAX_TURNS });
    });

    it('allows an empty ending but rejects a non-JSON reply', () => {
        expect(parseMafiaEnding('{"beats":[]}')).toEqual({ beats: [] });
        expect(() => parseMafiaEnding('엔딩 없음')).toThrow();
        expect(() => parseMafiaEnding('{"scenes":[]}')).toThrow();
    });

    it('stops at the first decision, keeps who left and the after-game rule', () => {
        const plan = parseMafiaEnding(
            JSON.stringify({
                after: 'alive',
                beats: [
                    { type: 'narration', text: '문이 열린다', gone: ['영희'] },
                    {
                        type: 'decision',
                        speaker: '철수',
                        direction: '앞에 놓인 것을 어떻게 할지',
                        options: ['받는다', '거절한다'],
                    },
                    { type: 'narration', text: '미리 쓴 결과' },
                ],
            })
        );
        expect(plan.after).toBe('alive');
        expect(plan.beats.map((b) => b.type)).toEqual([
            'narration',
            'decision',
        ]);
        expect(plan.beats[0]).toMatchObject({ gone: ['영희'] });
    });

    it('drops a decision with fewer than two options and ignores an unknown after', () => {
        const plan = parseMafiaEnding(
            JSON.stringify({
                after: 'maybe',
                beats: [
                    {
                        type: 'decision',
                        speaker: '철수',
                        direction: '',
                        options: ['하나뿐'],
                    },
                    { type: 'narration', text: '끝' },
                ],
            })
        );
        expect(plan).toEqual({ beats: [{ type: 'narration', text: '끝' }] });
    });
});
