import { describe, expect, it } from 'vitest';
import type { Agent } from '@/types/chat';
import { MEMORY_LIMIT, applyMind, extractMind, mindContext } from './mind';

const agent = (patch: Partial<Agent> = {}): Agent => ({
    id: 'a',
    name: '철수',
    emoji: '🙂',
    color: '#fff',
    persona: '',
    profileId: null,
    model: '',
    ...patch,
});

describe('extractMind', () => {
    it('removes the tags and keeps the last feeling and the first two memories', () => {
        const mind = extractMind(
            '[감정: 불안]\n수빈 씨 말이 걸려요\n[기억: 수빈이 나를 의심함]\n(기억：영희는 기권함)\n[기억: 세 번째]\n[감정: 초조함]'
        );
        expect(mind.text.trim()).toBe('수빈 씨 말이 걸려요');
        expect(mind.feeling).toBe('초조함');
        expect(mind.memories).toEqual(['수빈이 나를 의심함', '영희는 기권함']);
    });

    it('leaves text without tags alone', () => {
        expect(extractMind('그냥 말')).toEqual({
            text: '그냥 말',
            feeling: null,
            memories: [],
        });
    });
});

describe('applyMind', () => {
    it('updates the feeling, skips repeated memories and forgets the oldest past the limit', () => {
        const full = agent({
            memories: Array.from({ length: MEMORY_LIMIT }, (_, i) => `m${i}`),
        });
        const next = applyMind(full, {
            feeling: '분노',
            memories: ['m5', '새 기억'],
        });
        expect(next.feeling).toBe('분노');
        expect(next.memories).toHaveLength(MEMORY_LIMIT);
        expect(next.memories?.at(-1)).toBe('새 기억');
        expect(next.memories?.[0]).toBe('m1');
    });

    it('returns the same agent when nothing changed', () => {
        const a = agent({ feeling: '평온', memories: ['x'] });
        expect(applyMind(a, { feeling: '평온', memories: ['x'] })).toBe(a);
        expect(applyMind(a, { feeling: null, memories: [] })).toBe(a);
    });
});

describe('mindContext', () => {
    it('shows only this agent its own feeling and memories', () => {
        expect(mindContext(agent())).toEqual([]);
        expect(
            mindContext(agent({ feeling: '불안', memories: ['a', 'b'] }))
        ).toEqual([
            '[철수의 지금 감정] 불안',
            '[철수만 아는 기억] (오래된 것부터)\n- a\n- b',
        ]);
    });
});
