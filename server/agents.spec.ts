// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { parsePersonaAndStyle } from './agents';

describe('parsePersonaAndStyle', () => {
    it('reads persona and style from fenced JSON', () => {
        expect(
            parsePersonaAndStyle(
                '```json\n{"persona":" 고양이 집사. ","style":"반말."}\n```'
            )
        ).toEqual({ persona: '고양이 집사.', style: '반말.' });
    });

    it('allows a missing style but not an empty persona', () => {
        expect(parsePersonaAndStyle('{"persona":"집사."}').style).toBe('');
        expect(() => parsePersonaAndStyle('{"persona":" "}')).toThrow();
        expect(() => parsePersonaAndStyle('그냥 글')).toThrow();
    });
});
