// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { ChatDatabase, PresetNotFoundError } from './db.ts';

const room = (id: string, name = '방') => ({
    id,
    name,
    agents: [{ id: 'a', name: '철수' }],
    updatedAt: 1,
});
const msg = (id: string, text = id) => ({ id, sender: 'me', text, ts: 1 });

describe('ChatDatabase rooms', () => {
    it('stores rooms with ordered messages and applies upserts/removals', () => {
        const db = ChatDatabase.memory();
        db.syncRoom('r1', {
            room: room('r1'),
            upsert: [
                { seq: 0, message: msg('m1') },
                { seq: 1, message: msg('m2') },
                { seq: 2, message: msg('m3') },
            ],
            remove: [],
        });
        db.syncRoom('r2', { room: room('r2', '둘째'), upsert: [], remove: [] });
        db.syncRoom('r1', {
            room: room('r1', '이름 변경'),
            upsert: [
                { seq: 1, message: { ...msg('m3'), face: 'f' } },
                { seq: 2, message: msg('m4') },
            ],
            remove: ['m2'],
        });
        const [r1, r2] = db.listRooms();
        expect(r1.name).toBe('이름 변경');
        expect(r1.messages.map((m: { id: string }) => m.id)).toEqual([
            'm1',
            'm3',
            'm4',
        ]);
        expect(r1.messages[1]).toMatchObject({ face: 'f' });
        expect(r2).toMatchObject({ id: 'r2', messages: [] });
        expect(db.countRooms()).toBe(2);
    });

    it('replaces all messages when asked and cascades deletes to messages and memos', () => {
        const db = ChatDatabase.memory();
        db.syncRoom('r', {
            room: room('r'),
            upsert: [{ seq: 0, message: msg('old') }],
            remove: [],
        });
        db.syncRoom('r', {
            room: room('r'),
            upsert: [{ seq: 0, message: msg('new') }],
            remove: [],
            replace: true,
        });
        expect(db.listRooms()[0].messages).toEqual([msg('new')]);

        expect(db.setOwnerStatus('missing', { updatedAt: 1 })).toBe(false);
        expect(db.setOwnerStatus('r', { updatedAt: 2, summary: 'x' })).toBe(
            true
        );
        expect(db.listOwnerStatuses()).toEqual({
            r: { updatedAt: 2, summary: 'x' },
        });
        db.deleteRoom('r');
        expect(db.listRooms()).toEqual([]);
        expect(db.listOwnerStatuses()).toEqual({});
    });

    it('rejects a payload for another room and rolls back on failure', () => {
        const db = ChatDatabase.memory();
        expect(() =>
            db.syncRoom('r', { room: room('x'), upsert: [], remove: [] })
        ).toThrow();
        expect(db.countRooms()).toBe(0);
    });
});

describe('ChatDatabase presets', () => {
    it('creates, lists newest first, renames and deletes presets', () => {
        const db = ChatDatabase.memory();
        const a = db.createPreset('마피아', { name: '마피아 방', agents: [] });
        const b = db.createPreset('회의', { name: '회의 방', agents: [] });
        expect(db.listPresets().map((p) => p.id)).toEqual([b.id, a.id]);
        expect(db.renamePreset(a.id, '마피아 7인').name).toBe('마피아 7인');
        expect(db.listPresets()[1].room).toEqual({
            name: '마피아 방',
            agents: [],
        });
        db.deletePreset(b.id);
        expect(db.listPresets()).toHaveLength(1);
        expect(() => db.deletePreset(b.id)).toThrow(PresetNotFoundError);
        expect(() => db.renamePreset('none', 'x')).toThrow(PresetNotFoundError);
    });
});
