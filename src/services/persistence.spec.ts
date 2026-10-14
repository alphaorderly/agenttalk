import { describe, expect, it } from 'vitest';
import type { Room } from '@/types/chat';
import { roomChanges } from './persistence';

const room = (messages: Room['messages'], name = '방'): Room => ({
    id: 'r',
    name,
    topic: '',
    profileId: null,
    agents: [],
    messages,
    updatedAt: 0,
});
const snapshot = (r: Room) => ({
    meta: JSON.stringify({ ...r, messages: undefined }),
    messages: new Map(
        r.messages.map((message, seq) => [message.id, { message, seq }])
    ),
});

describe('roomChanges', () => {
    const m1 = { id: 'm1', sender: 'me', text: '1', ts: 0 };
    const m2 = { id: 'm2', sender: 'a', text: '2', ts: 0 };

    it('sends everything with replace on the first save', () => {
        expect(roomChanges(room([m1, m2]), undefined)).toMatchObject({
            replace: true,
            upsert: [
                { seq: 0, message: m1 },
                { seq: 1, message: m2 },
            ],
            remove: [],
        });
    });

    it('sends only new, edited (by reference) and removed messages', () => {
        const base = room([m1, m2]);
        const prev = snapshot(base);
        expect(roomChanges(base, prev)).toBeNull();

        const edited = { ...m2, face: 'f' };
        const m3 = { id: 'm3', sender: 'a', text: '3', ts: 1 };
        expect(roomChanges(room([m1, edited, m3]), prev)).toEqual({
            room: expect.objectContaining({ id: 'r' }),
            upsert: [
                { seq: 1, message: edited },
                { seq: 2, message: m3 },
            ],
            remove: [],
        });
        expect(roomChanges(room([]), prev)).toMatchObject({
            upsert: [],
            remove: ['m1', 'm2'],
        });
    });

    it('detects settings changes without touching messages', () => {
        const base = room([m1]);
        const change = roomChanges(room([m1], '새 이름'), snapshot(base));
        expect(change).toMatchObject({ upsert: [], remove: [] });
        expect(change?.room).toMatchObject({ name: '새 이름' });
        expect(change?.room).not.toHaveProperty('messages');
    });
});
