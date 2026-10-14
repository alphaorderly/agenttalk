// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { modeActionOf } from './index.ts';
import { mafiaActions } from './mafia/index.ts';

describe('modeActionOf', () => {
    it('finds a registered mode action', () => {
        expect(modeActionOf('mafia', 'ending')).toBe(mafiaActions.ending);
    });

    it('rejects unknown modes, actions, and prototype keys', () => {
        expect(modeActionOf('chat', 'ending')).toBeUndefined();
        expect(modeActionOf('mafia', 'nope')).toBeUndefined();
        expect(modeActionOf('constructor', 'name')).toBeUndefined();
        expect(modeActionOf('mafia', 'toString')).toBeUndefined();
    });
});
