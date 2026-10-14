import toast from 'react-hot-toast';
import type { RoomSync } from '@shared/rooms';
import type { Message, Room } from '@/types/chat';
import { upgradeRoom } from '@/modes';
import {
    ownerStatusesAtom,
    roomsAtom,
    roomsLoadAtom,
    sampleRoom,
    store,
    type OwnerRoomStatus,
} from '@stores/chat';
import {
    apiErrorMessage,
    deleteOwnerStatus,
    deleteRoomOnServer,
    fetchRooms,
    saveOwnerStatus,
    syncRoom,
} from './api';

/** 이전 버전이 localStorage에 저장하던 키. 서버로 옮긴 뒤 백업 키로 바꿔 둔다 */
const LEGACY_ROOMS = 'agenttalk.rooms';
const LEGACY_STATUSES = 'agenttalk.ownerStatuses';
const BACKUP_SUFFIX = '.migrated-backup';

const DEBOUNCE_MS = 400;
/** 처음 저장(이전)할 때 한 요청에 담는 최대 메시지 수 */
const CHUNK = 1000;
/** keepalive 요청의 본문 한도(64KB)보다 넉넉히 작게 */
const KEEPALIVE_LIMIT = 48 * 1024;

interface SyncedRoom {
    /** 메시지를 뺀 방 정보의 JSON */
    meta: string;
    /** 마지막으로 저장한 메시지 객체와 순서. 메시지는 불변 객체라 참조로 변경을 감지한다 */
    messages: Map<string, { message: Message; seq: number }>;
}

const metaOf = (room: Room) => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { messages, ...rest } = room;
    return rest;
};

function snapshot(room: Room): SyncedRoom {
    return {
        meta: JSON.stringify(metaOf(room)),
        messages: new Map(
            room.messages.map((message, seq) => [message.id, { message, seq }])
        ),
    };
}

/** 마지막 저장 이후 바뀐 부분. 바뀐 게 없으면 null */
export function roomChanges(
    room: Room,
    prev: SyncedRoom | undefined
): RoomSync | null {
    const meta = metaOf(room) as unknown as RoomSync['room'];
    if (!prev)
        return {
            room: meta,
            upsert: room.messages.map((message, seq) => ({
                seq,
                message:
                    message as unknown as RoomSync['upsert'][number]['message'],
            })),
            remove: [],
            replace: true,
        };
    const upsert: RoomSync['upsert'] = [];
    const ids = new Set<string>();
    room.messages.forEach((message, seq) => {
        ids.add(message.id);
        const old = prev.messages.get(message.id);
        if (old?.message !== message || old.seq !== seq)
            upsert.push({
                seq,
                message:
                    message as unknown as RoomSync['upsert'][number]['message'],
            });
    });
    const remove = [...prev.messages.keys()].filter((id) => !ids.has(id));
    if (!upsert.length && !remove.length && JSON.stringify(meta) === prev.meta)
        return null;
    return { room: meta, upsert, remove };
}

function readLegacy<T>(key: string): T | null {
    try {
        const raw = localStorage.getItem(key);
        return raw ? (JSON.parse(raw) as T) : null;
    } catch {
        return null;
    }
}

function backupLegacy() {
    try {
        for (const key of [LEGACY_ROOMS, LEGACY_STATUSES]) {
            const raw = localStorage.getItem(key);
            if (raw === null) continue;
            localStorage.setItem(key + BACKUP_SUFFIX, raw);
            localStorage.removeItem(key);
        }
    } catch {
        /* 저장소를 쓸 수 없으면 그대로 둔다 */
    }
}

let dispose: (() => void) | null = null;

/**
 * 서버에서 방을 불러오고, 이후 roomsAtom/ownerStatusesAtom의 변경을 서버 SQLite에 저장한다.
 * 서버가 비어 있으면 이전 버전의 localStorage 기록을 옮기고, 그것도 없으면 예시 방을 만든다.
 */
export function startPersistence() {
    dispose?.();
    let disposed = false;
    let synced = new Map<string, SyncedRoom>();
    let syncedStatuses: Record<string, OwnerRoomStatus> = {};
    let migrating = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let running = false;
    let dirty = false;
    let failures = 0;
    let unsubscribe: (() => void)[] = [];

    async function load() {
        store.set(roomsLoadAtom, { state: 'loading' });
        try {
            const data = await fetchRooms();
            if (disposed) return;
            const stored = data.rooms as Room[];
            let rooms = stored.map(upgradeRoom);
            let statuses = data.ownerStatuses as Record<
                string,
                OwnerRoomStatus
            >;
            if (rooms.length) {
                // 이전 형식에서 고친 방은 저장된 원본과 비교해 다시 저장되게 한다
                synced = new Map(stored.map((r) => [r.id, snapshot(r)]));
                syncedStatuses = statuses;
            } else {
                const legacy = readLegacy<Room[]>(LEGACY_ROOMS);
                if (Array.isArray(legacy) && legacy.length) {
                    rooms = legacy.map(upgradeRoom);
                    statuses =
                        readLegacy<Record<string, OwnerRoomStatus>>(
                            LEGACY_STATUSES
                        ) ?? {};
                    migrating = true;
                } else rooms = [sampleRoom()];
            }
            store.set(roomsAtom, rooms);
            store.set(ownerStatusesAtom, statuses);
            store.set(roomsLoadAtom, { state: 'ready' });
            unsubscribe = [
                store.sub(roomsAtom, () => schedule()),
                store.sub(ownerStatusesAtom, () => schedule()),
            ];
            // 새로 만든 예시 방, 옮겨 온 기록, 이전 형식에서 고친 방을 바로 저장한다
            if (
                rooms.length !== synced.size ||
                rooms.some((r, i) => r !== stored[i])
            )
                schedule(0);
        } catch (err) {
            if (disposed) return;
            store.set(roomsLoadAtom, {
                state: 'error',
                error: await apiErrorMessage(err),
            });
        }
    }

    function schedule(delay = DEBOUNCE_MS) {
        if (disposed) return;
        dirty = true;
        if (running) return;
        clearTimeout(timer);
        timer = setTimeout(() => void flush(), delay);
    }

    async function syncAll(keepalive = false) {
        const rooms = store.get(roomsAtom);
        for (const room of rooms) {
            const change = roomChanges(room, synced.get(room.id));
            if (!change) continue;
            if (keepalive) {
                if (JSON.stringify(change).length <= KEEPALIVE_LIMIT)
                    void syncRoom(room.id, change, true).catch(() => {});
                continue;
            }
            // 처음 저장하는 긴 기록은 나눠 보낸다
            for (let i = 0; i === 0 || i < change.upsert.length; i += CHUNK)
                await syncRoom(room.id, {
                    ...change,
                    upsert: change.upsert.slice(i, i + CHUNK),
                    replace: i === 0 && change.replace,
                });
            synced.set(room.id, snapshot(room));
        }
        if (keepalive) return;
        const ids = new Set(rooms.map((r) => r.id));
        for (const id of [...synced.keys()].filter((id) => !ids.has(id))) {
            await deleteRoomOnServer(id);
            synced.delete(id);
            delete syncedStatuses[id];
        }

        const statuses = store.get(ownerStatusesAtom);
        for (const [roomId, status] of Object.entries(statuses)) {
            if (syncedStatuses[roomId] === status || !synced.has(roomId))
                continue;
            await saveOwnerStatus(roomId, status);
            syncedStatuses[roomId] = status;
        }
        for (const roomId of Object.keys(syncedStatuses)) {
            if (roomId in statuses) continue;
            await deleteOwnerStatus(roomId);
            delete syncedStatuses[roomId];
        }
    }

    async function flush() {
        if (disposed) return;
        running = true;
        dirty = false;
        try {
            await syncAll();
            if (failures) toast.success('대화 기록을 다시 저장했어요.');
            failures = 0;
            if (migrating) {
                migrating = false;
                backupLegacy();
            }
        } catch (err) {
            failures++;
            if (failures === 1)
                toast.error(
                    `대화 기록을 서버에 저장하지 못했어요: ${await apiErrorMessage(err)}`
                );
            dirty = true;
        } finally {
            running = false;
            if (dirty && !disposed)
                schedule(failures ? Math.min(30_000, 1000 * 2 ** failures) : 0);
        }
    }

    // 창을 닫기 직전의 작은 변경도 놓치지 않게 한다
    const onHide = () => {
        if (store.get(roomsLoadAtom).state === 'ready')
            void syncAll(true).catch(() => {});
    };
    window.addEventListener('pagehide', onHide);

    void load();

    const instance = () => {
        disposed = true;
        clearTimeout(timer);
        unsubscribe.forEach((fn) => fn());
        window.removeEventListener('pagehide', onHide);
        if (dispose === instance) dispose = null;
    };
    dispose = instance;
    return {
        dispose: instance,
        retry: () => void load(),
    };
}
