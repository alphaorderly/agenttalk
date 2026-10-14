// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { PERSONA_MAX } from '../../shared/providers';
import { firstEmoji, normalizePlan, toAgent } from './normalize';

const member = (name: string, extra: Partial<{ emoji: string }> = {}) => ({
    name,
    emoji: '🧑‍🍳',
    concept: '동네 빵집 사장. 새 메뉴에 회의적이다.',
    talk: 'normal' as const,
    ...extra,
});

describe('normalizePlan', () => {
    it('numbers names that clash with existing members or each other', () => {
        const slots = normalizePlan(
            { members: [member('도윤'), member(' 도윤 '), member('하린')] },
            ['도윤'],
            5
        );
        expect(slots.map((s) => s.name)).toEqual(['도윤2', '도윤3', '하린']);
    });

    it('drops members without a name or concept and stops at the requested count', () => {
        const slots = normalizePlan(
            {
                members: [
                    member(' '),
                    { ...member('빈콘셉트'), concept: ' ' },
                    member('가'),
                    member('나'),
                    member('다'),
                ],
            },
            [],
            2
        );
        expect(slots.map((s) => s.name)).toEqual(['가', '나']);
    });
});

describe('firstEmoji', () => {
    it('keeps one grapheme emoji and falls back for text', () => {
        expect(firstEmoji(' 🧑‍🍳🍞')).toBe('🧑‍🍳');
        expect(firstEmoji('chef')).toBe('🙂');
        expect(firstEmoji('')).toBe('🙂');
    });
});

describe('toAgent', () => {
    const [slot] = normalizePlan({ members: [member('도윤')] }, [], 1);

    it('merges the planned slot with trimmed, bounded details', () => {
        expect(
            toAgent(slot, {
                persona: ` ${'가'.repeat(PERSONA_MAX + 10)} `,
                style: ' 존댓말 ',
                relations: ' 하린과 동기 ',
                secret: '',
            })
        ).toEqual({
            name: '도윤',
            emoji: '🧑‍🍳',
            persona: '가'.repeat(PERSONA_MAX),
            style: '존댓말',
            talk: 'normal',
            secret: '',
            relations: '하린과 동기',
        });
    });

    it('rejects an empty persona', () => {
        expect(
            toAgent(slot, {
                persona: ' ',
                style: '',
                relations: '',
                secret: '',
            })
        ).toBeNull();
    });
});
