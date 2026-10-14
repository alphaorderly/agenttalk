import { describe, expect, it } from 'vitest';
import type { Room } from '@/types/chat';
import { endingRequest, resolveBeats } from './ending';
import type { MafiaGame } from './types';

const game = {
    players: [
        { id: 'a', name: '철수', role: 'mafia', alive: true },
        {
            id: 'b',
            name: '영희',
            role: 'citizen',
            alive: false,
            death: { day: 1, cause: 'killed' },
        },
        { id: 'me', name: '나', role: 'police', alive: true },
    ],
    winner: 'mafia',
} as MafiaGame;

describe('resolveBeats', () => {
    it('maps names and groups to participant ids and drops unknown people', () => {
        expect(
            resolveBeats(game, [
                { type: 'narration', text: '총이 주어진다' },
                { type: 'line', speaker: '철수', direction: '총을 들었다' },
                { type: 'line', speaker: '유령', direction: '?' },
                { type: 'talk', speakers: 'alive', turns: 4, direction: '' },
                { type: 'talk', speakers: 'dead', turns: 4, direction: '' },
                {
                    type: 'talk',
                    speakers: ['영희', '유령', '영희'],
                    turns: 2,
                    direction: '',
                },
                { type: 'talk', speakers: ['유령'], turns: 2, direction: '' },
            ])
        ).toEqual([
            { type: 'narration', text: '총이 주어진다' },
            { type: 'line', speaker: 'a', direction: '총을 들었다' },
            { type: 'talk', speakers: ['a', 'me'], turns: 4, direction: '' },
            { type: 'talk', speakers: ['b'], turns: 4, direction: '' },
            { type: 'talk', speakers: ['b'], turns: 2, direction: '' },
        ]);
    });
});

describe('endingRequest', () => {
    const room = (shareIntroductions: boolean): Room =>
        ({
            id: 'r',
            name: '시설',
            topic: '데스게임',
            mode: 'mafia',
            shareIntroductions,
            agents: [
                {
                    id: 'a',
                    name: '철수',
                    persona: '전직 형사',
                    secret: '영희의 옛 연인',
                    relations: '영희를 안다',
                },
                { id: 'b', name: '영희', persona: '간호사' },
            ],
            messages: [
                { id: '0', sender: 'a', text: '지난 판', ts: 0 },
                {
                    id: '1',
                    sender: 'system',
                    text: '🎲 마피아 게임을 시작해요',
                    ts: 1,
                },
                {
                    id: '2',
                    sender: 'a',
                    senderName: '철수',
                    text: '오늘 밤은 영희',
                    to: ['me'],
                    ts: 2,
                },
            ],
        }) as unknown as Room;

    it('sends this game only, never secrets, and personas only when shared', () => {
        const target = { profileId: null, model: '', reasoning: null };
        const hidden = endingRequest(room(false), game, target, '나');
        expect(hidden.transcript).toEqual([
            { speaker: '진행', text: '🎲 마피아 게임을 시작해요' },
            { speaker: '철수', text: '오늘 밤은 영희', to: ['나'] },
        ]);
        expect(hidden.players.map((p) => p.persona)).toEqual([
            undefined,
            undefined,
            undefined,
        ]);
        expect(JSON.stringify(hidden)).not.toContain('옛 연인');
        expect(JSON.stringify(hidden)).not.toContain('영희를 안다');
        expect(hidden.players[1]).toMatchObject({
            role: '시민',
            alive: false,
            death: '1번째 밤에 마피아에게 당함',
        });
        expect(hidden.players[2]).toMatchObject({ human: true });

        const shared = endingRequest(room(true), game, target, '나');
        expect(shared.players[0].persona).toBe('전직 형사');
    });
});
