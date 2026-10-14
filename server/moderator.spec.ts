// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { moderateRequestSchema } from '../shared/providers';
import {
    moderatorInstructions,
    moderatorPrompt,
    parseDecision,
} from './moderator';

describe('parseDecision', () => {
    it('reads ranked candidates with factual notes', () => {
        expect(
            parseDecision(
                '{"speakers":[{"speaker":2,"note":"철수가 너에게 물었음"},{"speaker":1,"note":""}],"wait_seconds":1.5,"reason":"질문 받음"}',
                3
            )
        ).toEqual({
            candidates: [
                { speaker: 2, note: '철수가 너에게 물었음' },
                { speaker: 1, note: '' },
            ],
            waitMs: 1500,
            reason: '질문 받음',
        });
    });

    it('extracts JSON wrapped in code fences or prose and accepts bare numbers', () => {
        const text =
            '판단 결과:\n```json\n{"speakers":["1"],"wait_seconds":"3"}\n```';
        expect(parseDecision(text, 3)).toMatchObject({
            candidates: [{ speaker: 1, note: '' }],
            waitMs: 3000,
            reason: '',
        });
    });

    it('treats an empty list, 0 or the legacy {"speaker":0} as stop', () => {
        expect(
            parseDecision('{"speakers":[],"reason":"결론 남"}', 3)
        ).toMatchObject({ candidates: [], reason: '결론 남' });
        expect(
            parseDecision('{"speakers":[{"speaker":0}]}', 3).candidates
        ).toEqual([]);
        expect(parseDecision('{"speaker":0}', 3).candidates).toEqual([]);
        expect(parseDecision('{"speaker":2}', 3).candidates).toEqual([
            { speaker: 2, note: '' },
        ]);
    });

    it('keeps at most two unique candidates', () => {
        expect(
            parseDecision('{"speakers":[1,1,2,3]}', 3).candidates.map(
                (c) => c.speaker
            )
        ).toEqual([1, 2]);
    });

    it('clamps the wait to a human range and defaults it', () => {
        expect(
            parseDecision('{"speakers":[1],"wait_seconds":60}', 2).waitMs
        ).toBe(8000);
        expect(
            parseDecision('{"speakers":[1],"wait_seconds":0}', 2).waitMs
        ).toBe(300);
        expect(parseDecision('{"speakers":[1]}', 2).waitMs).toBe(1000);
    });

    it('rejects unknown members and non-JSON output', () => {
        expect(() => parseDecision('{"speakers":[4]}', 3)).toThrow(/없는 멤버/);
        expect(() => parseDecision('철수가 말하면 좋겠어요', 3)).toThrow(
            /JSON/
        );
        expect(() => parseDecision('{"who":1}', 3)).toThrow(/형식/);
    });
});

describe('moderatorPrompt', () => {
    const base = {
        profileId: null,
        model: '',
        reasoning: null,
        roomName: '점심',
        topic: '메뉴 정하기',
        userName: '하늘',
        members: [
            { name: '철수', persona: '수다쟁이' },
            { name: '영희', persona: '' },
        ],
        transcript: [{ speaker: '하늘', text: '영희는 뭐 먹고 싶어?' }],
        agentStreak: 0,
        nudge: false,
    };

    it('numbers members and includes the transcript', () => {
        const p = moderatorPrompt(base);
        expect(p).toContain('1. 철수 — 수다쟁이 [최근에 말한 적 없음]');
        expect(p).toContain('2. 영희 — (설명 없음)');
        expect(p).toContain('하늘: 영희는 뭐 먹고 싶어?');
        expect(p).not.toContain('직접 요청했다');
    });

    it('marks how long ago each member spoke', () => {
        const p = moderatorPrompt({
            ...base,
            transcript: [
                { speaker: '철수', text: 'ㅋㅋ' },
                { speaker: '하늘', text: '영희는?' },
            ],
        });
        expect(p).toContain('[1개 메시지 전에 말함]');
    });

    it('nudges naturally while allowing 0 when no one may speak', () => {
        expect(moderatorPrompt({ ...base, nudge: true })).toContain(
            '이유로 멈추지 말고'
        );
        expect(moderatorPrompt({ ...base, nudge: true })).toContain(
            '멈춰도 된다'
        );
    });

    it('includes the latest request and identity-based responders outside the recent transcript', () => {
        const req = {
            ...base,
            transcript: [{ speaker: '철수', text: '끝' }],
            latestUserRequest: {
                id: 'human-1',
                text: '탈락자도 이번에는 전원 소감을 말해줘',
                to: ['철수', '영희'],
            },
            respondedMembers: [{ id: 'a', name: '철수' }],
        };
        expect(moderateRequestSchema.parse(req)).toMatchObject({
            latestUserRequest: req.latestUserRequest,
            respondedMembers: req.respondedMembers,
        });
        const prompt = moderatorPrompt(req);
        expect(prompt).toContain('마지막 인간 요청(전체 기록에서 찾음)');
        expect(prompt).toContain(
            '하늘 → 철수, 영희 (🔒귓속말): 탈락자도 이번에는 전원 소감을 말해줘'
        );
        expect(prompt).toContain('철수 [a]');
        expect(
            moderatorPrompt({
                ...req,
                members: [{ id: 'a', name: '철수', persona: '' }],
            })
        ).toContain('[ID a, 방금 말함]');
    });
});

describe('moderatorPrompt whispers', () => {
    it('marks whispers with their recipients', () => {
        const prompt = moderatorPrompt({
            profileId: null,
            model: '',
            reasoning: null,
            roomName: '방',
            topic: '',
            userName: '나',
            members: [
                { name: '철수', persona: '' },
                { name: '영희', persona: '' },
            ],
            transcript: [{ speaker: '철수', text: '비밀', to: ['영희'] }],
            agentStreak: 1,
            nudge: false,
        });
        expect(prompt).toContain('철수 → 영희 (🔒귓속말): 비밀');
    });
});

describe('moderatorInstructions', () => {
    it('only hands over the turn and never directs form or length', () => {
        const instructions = moderatorInstructions('하늘');
        expect(instructions).toContain('마이크를 건네는');
        expect(instructions).toContain('지시가 아니라');
        expect(instructions).not.toMatch(/"mode"|react\||reply_to/);
        expect(instructions).toContain('"speakers"');
    });

    it('prioritizes unfinished all-member answers without enforcing a program queue', () => {
        const instructions = moderatorInstructions('하늘');
        expect(instructions).toContain('아직 답하지 않은 사람을 우선');
        expect(instructions).toContain('최근 로그 밖으로 밀려난 요청');
        expect(instructions).toContain(
            '대상과 발언 허용 여부의 최종 판단은 너가 한다'
        );
        expect(instructions).toContain('잡담이나 다른 질문');
    });

    it('distinguishes lasting bans, one last statement and explicit one-request exceptions', () => {
        const instructions = moderatorInstructions('하늘');
        expect(instructions).toContain('마지막 한마디');
        expect(instructions).toContain(
            '허용된 한 번의 발언 뒤에 기존 발언 금지'
        );
        expect(instructions).toContain('그 요청의 예외');
        expect(instructions).toContain(
            '일반적인 "다들"만으로 기존 발언 금지가 해제'
        );
    });

    it('keeps whisper all-member requests within actual recipients and allows repeated speakers', () => {
        const instructions = moderatorInstructions('하늘');
        expect(instructions).toContain('본문의 @다른이름은 수신자를 추가');
        expect(instructions).toContain('실제 수신자 범위 안');
        expect(instructions).toContain('같은 사람을 다시 골라도 된다');
    });
});
