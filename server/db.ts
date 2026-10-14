import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { RoomSync, StoredPreset } from '../shared/rooms.ts';
import { ensurePrivateDir, tightenPermissions } from './secrets.ts';

export class PresetNotFoundError extends Error {}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS rooms (
    id TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
    room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    id TEXT NOT NULL,
    seq INTEGER NOT NULL,
    ts INTEGER NOT NULL,
    data TEXT NOT NULL,
    PRIMARY KEY (room_id, id)
);
CREATE INDEX IF NOT EXISTS messages_by_order ON messages (room_id, seq);
CREATE TABLE IF NOT EXISTS owner_statuses (
    room_id TEXT PRIMARY KEY REFERENCES rooms(id) ON DELETE CASCADE,
    data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS presets (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    data TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
`;

type Row = Record<string, unknown>;

/**
 * 채팅방·메시지·방장 메모·프리셋을 data/agenttalk.db(SQLite)에 저장한다.
 * 방과 메시지의 내용은 JSON으로 보관하고, 순서와 소속만 열로 관리한다.
 */
export class ChatDatabase {
    private constructor(private readonly db: DatabaseSync) {}

    static async open(dataDir: string) {
        await ensurePrivateDir(dataDir);
        const file = path.join(dataDir, 'agenttalk.db');
        const db = new DatabaseSync(file);
        db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
        db.exec(SCHEMA);
        await tightenPermissions(file);
        return new ChatDatabase(db);
    }

    /** 테스트용 */
    static memory() {
        const db = new DatabaseSync(':memory:');
        db.exec('PRAGMA foreign_keys = ON;');
        db.exec(SCHEMA);
        return new ChatDatabase(db);
    }

    close() {
        this.db.close();
    }

    private transaction<T>(fn: () => T): T {
        this.db.exec('BEGIN IMMEDIATE');
        try {
            const result = fn();
            this.db.exec('COMMIT');
            return result;
        } catch (err) {
            this.db.exec('ROLLBACK');
            throw err;
        }
    }

    /* ---------------- 방 · 메시지 ---------------- */

    listRooms() {
        const rooms = this.db
            .prepare('SELECT id, data FROM rooms ORDER BY created_at, rowid')
            .all() as Row[];
        const messages = this.db
            .prepare('SELECT room_id, data FROM messages ORDER BY room_id, seq')
            .all() as Row[];
        const byRoom = new Map<string, unknown[]>();
        for (const m of messages) {
            const list = byRoom.get(m.room_id as string) ?? [];
            list.push(JSON.parse(m.data as string));
            byRoom.set(m.room_id as string, list);
        }
        return rooms.map((r) => ({
            ...JSON.parse(r.data as string),
            messages: byRoom.get(r.id as string) ?? [],
        }));
    }

    countRooms() {
        return (this.db.prepare('SELECT COUNT(*) AS n FROM rooms').get() as Row)
            .n as number;
    }

    /** 방 정보를 저장하고 메시지 변경분을 한 트랜잭션으로 반영한다 */
    syncRoom(roomId: string, change: RoomSync) {
        if (change.room.id !== roomId)
            throw new Error('방 ID가 일치하지 않습니다.');
        const now = Date.now();
        this.transaction(() => {
            this.db
                .prepare(
                    `INSERT INTO rooms (id, data, created_at, updated_at) VALUES (?, ?, ?, ?)
                     ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`
                )
                .run(roomId, JSON.stringify(change.room), now, now);
            if (change.replace)
                this.db
                    .prepare('DELETE FROM messages WHERE room_id = ?')
                    .run(roomId);
            const remove = this.db.prepare(
                'DELETE FROM messages WHERE room_id = ? AND id = ?'
            );
            for (const id of change.remove) remove.run(roomId, id);
            const upsert = this.db.prepare(
                `INSERT INTO messages (room_id, id, seq, ts, data) VALUES (?, ?, ?, ?, ?)
                 ON CONFLICT(room_id, id) DO UPDATE SET seq = excluded.seq, ts = excluded.ts, data = excluded.data`
            );
            for (const { seq, message } of change.upsert)
                upsert.run(
                    roomId,
                    message.id,
                    seq,
                    message.ts,
                    JSON.stringify(message)
                );
        });
    }

    deleteRoom(roomId: string) {
        // 메시지와 메모는 외래 키 CASCADE로 함께 지워진다
        this.db.prepare('DELETE FROM rooms WHERE id = ?').run(roomId);
    }

    /* ---------------- 방장 전용 메모 ---------------- */

    listOwnerStatuses(): Record<string, unknown> {
        const rows = this.db
            .prepare('SELECT room_id, data FROM owner_statuses')
            .all() as Row[];
        return Object.fromEntries(
            rows.map((r) => [r.room_id, JSON.parse(r.data as string)])
        );
    }

    /** 방이 아직 저장되지 않았으면 false */
    setOwnerStatus(roomId: string, status: unknown): boolean {
        const exists = this.db
            .prepare('SELECT 1 FROM rooms WHERE id = ?')
            .get(roomId);
        if (!exists) return false;
        this.db
            .prepare(
                `INSERT INTO owner_statuses (room_id, data) VALUES (?, ?)
                 ON CONFLICT(room_id) DO UPDATE SET data = excluded.data`
            )
            .run(roomId, JSON.stringify(status));
        return true;
    }

    deleteOwnerStatus(roomId: string) {
        this.db
            .prepare('DELETE FROM owner_statuses WHERE room_id = ?')
            .run(roomId);
    }

    /* ---------------- 프리셋 ---------------- */

    private toPreset(row: Row): StoredPreset {
        return {
            id: row.id as string,
            name: row.name as string,
            room: JSON.parse(row.data as string),
            createdAt: row.created_at as number,
            updatedAt: row.updated_at as number,
        };
    }

    listPresets(): StoredPreset[] {
        return (
            this.db
                .prepare(
                    'SELECT * FROM presets ORDER BY created_at DESC, rowid DESC'
                )
                .all() as Row[]
        ).map((r) => this.toPreset(r));
    }

    createPreset(name: string, room: unknown): StoredPreset {
        const id = randomUUID();
        const now = Date.now();
        this.db
            .prepare(
                'INSERT INTO presets (id, name, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
            )
            .run(id, name, JSON.stringify(room), now, now);
        return { id, name, room, createdAt: now, updatedAt: now };
    }

    renamePreset(id: string, name: string): StoredPreset {
        const result = this.db
            .prepare('UPDATE presets SET name = ?, updated_at = ? WHERE id = ?')
            .run(name, Date.now(), id);
        if (!result.changes) throw new PresetNotFoundError(id);
        return this.toPreset(
            this.db.prepare('SELECT * FROM presets WHERE id = ?').get(id) as Row
        );
    }

    deletePreset(id: string) {
        const result = this.db
            .prepare('DELETE FROM presets WHERE id = ?')
            .run(id);
        if (!result.changes) throw new PresetNotFoundError(id);
    }
}
