// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
    generateAgentsSchema,
    type GenerateAgentsRequest,
} from '../../shared/providers';
import {
    DETAIL_INSTRUCTIONS,
    PLAN_INSTRUCTIONS,
    detailPrompt,
    planPrompt,
} from './prompts';
import type { CastingSlot } from './normalize';

const request = (
    overrides: Partial<GenerateAgentsRequest> = {}
): GenerateAgentsRequest =>
    generateAgentsSchema.parse({
        profileId: null,
        model: '',
        reasoning: null,
        roomName: '팀방',
        topic: '워크숍 장소',
        count: 2,
        existing: [],
        ...overrides,
    });

const slots: CastingSlot[] = [
    { name: '도윤', emoji: '🧑‍🍳', concept: '빵집 사장', talk: 'chatty' },
    { name: '하린', emoji: '📚', concept: '사서', talk: 'quiet' },
];

describe('planPrompt', () => {
    it('includes the topic, existing members and the count', () => {
        const p = planPrompt(
            request({
                existing: [
                    {
                        name: '철수',
                        persona: '개발자',
                        style: '',
                        talk: 'normal',
                        secret: '',
                        relations: '',
                    },
                ],
            })
        );
        expect(p).toContain('대화 주제/상황: 워크숍 장소');
        expect(p).toContain('- 철수 (보통): 개발자');
        expect(p).toContain('새로 만들 멤버 수: 2명');
        expect(p).not.toContain('말투:');
        expect(p).not.toContain('생성 규칙');
        expect(p).not.toContain('비밀');
    });

    it('adds user casting rules and existing secrets so assignments add up', () => {
        const p = planPrompt(
            request({
                topic: '7인 마피아',
                castingRules: '마피아 2명, 의사 1명, 시민 4명',
                count: 5,
                existing: [
                    {
                        name: '철수',
                        persona: '개발자',
                        style: '반말, 짧게',
                        talk: 'chatty',
                        secret: '마피아',
                        relations: '영희와 입사 동기',
                    },
                ],
            })
        );
        expect(p).toContain(
            '생성 규칙(반드시 따른다):\n마피아 2명, 의사 1명, 시민 4명'
        );
        expect(p).toContain('- 철수 (말 많음): 개발자\n  (말투: 반말, 짧게)');
        expect(p).toContain('(관계·요즘: 영희와 입사 동기)');
        expect(p).toContain('(비밀: 마피아)');
    });

    it('gives mode rules priority over user rules and marks introductions private', () => {
        const modeContext = '게임 역할은 프로그램이 무작위로 배정한다.';
        const p = planPrompt(
            request({
                castingRules: '마피아 2명을 배정한다',
                modeContext,
                shareIntroductions: false,
            })
        );
        expect(p).toContain(
            `모드 생성 지침(사용자 생성 규칙보다 우선):\n${modeContext}`
        );
        expect(p).toContain(
            '생성 규칙(모드 지침과 충돌하지 않는 범위에서 따른다):\n마피아 2명을 배정한다'
        );
        expect(p).toContain('소개 공유: 비공개.');
        for (const instructions of [PLAN_INSTRUCTIONS, DETAIL_INSTRUCTIONS])
            expect(instructions).toContain(
                '모드 생성 지침이 있으면 사용자 생성 규칙보다 먼저 따른다'
            );
    });

    it('treats introductions as public unless explicitly private', () => {
        expect(planPrompt(request())).toContain('소개 공유: 공개.');
        expect(planPrompt(request({ shareIntroductions: true }))).toContain(
            '소개 공유: 공개.'
        );
        expect(planPrompt(request())).not.toContain('모드 생성 지침');
    });
});

describe('detailPrompt', () => {
    it('shares the room context, the whole new roster and the target member', () => {
        const p = detailPrompt(
            request({ modeContext: '역할을 암시하지 않는다.' }),
            slots,
            1
        );
        expect(p).toContain('대화 주제/상황: 워크숍 장소');
        expect(p).toContain('역할을 암시하지 않는다.');
        expect(p).toContain(
            '새 멤버 명단:\n- 🧑‍🍳 도윤 (말 많음): 빵집 사장\n- 📚 하린 (말수 적음): 사서'
        );
        expect(p).toContain(
            '이번에 자세히 쓸 멤버:\n- 📚 하린 (말수 적음): 사서'
        );
        expect(p).not.toContain('새로 만들 멤버 수');
    });
});

describe('generateAgentsSchema', () => {
    it('limits the request to the room capacity in one go', () => {
        const existing = Array.from({ length: 25 }, (_, i) => ({
            name: `멤버${i}`,
            persona: '소개',
        }));
        expect(
            generateAgentsSchema.safeParse({ ...request(), existing, count: 5 })
                .success
        ).toBe(true);
        expect(
            generateAgentsSchema.safeParse({ ...request(), existing, count: 6 })
                .success
        ).toBe(false);
    });

    it('trims and bounds optional mode context', () => {
        expect(
            request({ modeContext: ' 자기소개 후 첫 밤 ' }).modeContext
        ).toBe('자기소개 후 첫 밤');
        expect(
            generateAgentsSchema.safeParse({
                ...request(),
                modeContext: 'x'.repeat(2001),
            }).success
        ).toBe(false);
    });
});
