import { describe, expect, it } from 'vitest';
import type { PresetRoom } from '@/types/chat';
import { newGame, setupProblem } from '@/modes/mafia/rules';
import { fromPreset, toPresetRoom } from './preset';

const preset = (): PresetRoom => ({
    name: '수동 배분',
    topic: '',
    profileId: null,
    mode: 'mafia',
    agents: ['가', '나', '다', '라'].map((name, i) => ({
        id: `a${i}`,
        name,
        emoji: '🙂',
        color: '#fff',
        persona: '',
        profileId: null,
        model: '',
    })),
    mafia: {
        userRole: 'player',
        roleAssignment: 'manual',
        mafia: 1,
        doctor: 1,
        police: 1,
        reveal: false,
        dayTalk: 12,
        assignedRoles: {
            a0: 'mafia',
            a1: 'doctor',
            a2: 'police',
            a3: 'citizen',
            me: 'citizen',
            removed: 'mafia',
        },
    },
});

describe('preset role assignments', () => {
    it.each(['mafia', 'chat'] as const)(
        'remaps each saved assignment to its new participant for %s presets',
        (mode) => {
            const original = preset();
            original.mode = mode;
            const saved = toPresetRoom(original);
            const loaded = fromPreset(saved);
            expect(loaded.agents.map((a) => a.id)).not.toEqual(
                original.agents.map((a) => a.id)
            );
            loaded.agents.forEach((a, i) => {
                expect(loaded.mafia?.assignedRoles?.[a.id]).toBe(
                    original.mafia?.assignedRoles?.[original.agents[i].id]
                );
            });
            expect(loaded.mafia?.assignedRoles?.me).toBe('citizen');
            expect(loaded.mafia?.assignedRoles).not.toHaveProperty('removed');
            expect(saved.mafia?.assignedRoles).toEqual(
                original.mafia?.assignedRoles
            );
            expect(setupProblem(loaded.mafia!, loaded.agents)).toBeNull();
            const playable = {
                ...loaded,
                mode: 'mafia' as const,
                id: 'room',
                messages: [],
                updatedAt: 0,
            };
            expect(
                newGame(playable, loaded.mafia!, '나').players.map(
                    (p) => p.role
                )
            ).toEqual(['mafia', 'doctor', 'police', 'citizen', 'citizen']);
        }
    );

    it('keeps ordinary legacy presets without adding game settings', () => {
        const legacy = preset();
        delete legacy.mafia;
        const loaded = fromPreset(legacy);
        expect(loaded.mafia).toBeUndefined();
        expect(loaded.agents).toHaveLength(4);
    });
});
