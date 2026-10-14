import { describe, expect, it } from 'vitest';
import type { Room } from '@/types/chat';
import { modeStateOf, upgradeRoom, withoutModeState } from './index';
import type { MafiaGame } from './mafia/types';

/** 내용은 상관없고 같은 객체인지만 본다 */
const stubGame = () => ({ phase: 'night', day: 1 }) as MafiaGame;

const baseRoom = (): Room => ({
    id: 'r',
    name: '방',
    topic: '',
    profileId: null,
    mode: 'mafia',
    agents: [
        { id: 'a', name: '철수' },
        { id: 'b', name: '영희' },
        { id: 'c', name: '지수' },
    ] as Room['agents'],
    messages: [{ id: 'm', sender: 'me', text: '안녕', ts: 1 }],
    updatedAt: 0,
});

describe('upgradeRoom', () => {
    it('returns the same room when nothing needs upgrading', () => {
        const room = baseRoom();
        expect(upgradeRoom(room)).toBe(room);
    });

    it('moves a legacy room.game into modeState.mafia', () => {
        const room = baseRoom();
        const game = stubGame();
        const legacy = { ...room, game } as Room;
        const next = upgradeRoom(legacy);
        expect(next).not.toHaveProperty('game');
        expect(next.modeState?.mafia).toBe(game);
        expect(next.messages).toBe(legacy.messages);
    });

    it('drops an empty legacy room.game', () => {
        const next = upgradeRoom({ ...baseRoom(), game: undefined } as Room);
        expect(next).not.toHaveProperty('game');
        expect(next.modeState).toBeUndefined();
    });

    it('renames the legacy message.game flag to notice', () => {
        const room = baseRoom();
        room.messages.push({
            id: 'n',
            sender: 'system',
            text: '🌙 1번째 밤',
            ts: 2,
            game: true,
        } as Room['messages'][number]);
        const next = upgradeRoom(room);
        expect(next.messages[0]).toBe(room.messages[0]);
        expect(next.messages[1]).toEqual({
            id: 'n',
            sender: 'system',
            text: '🌙 1번째 밤',
            ts: 2,
            notice: true,
        });
    });
});

describe('mode state helpers', () => {
    it('keeps and strips modeState', () => {
        const room = baseRoom();
        expect(modeStateOf(room)).toEqual({});
        const game = stubGame();
        const live = { ...room, modeState: { mafia: game } };
        expect(modeStateOf(live)).toEqual({ modeState: { mafia: game } });
        expect(withoutModeState(live)).not.toHaveProperty('modeState');
    });
});
