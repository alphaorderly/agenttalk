import type { ProfilesResponse } from '@shared/providers';
import type { RoomStatusRequest } from '@shared/room-status';
import type { Room } from '@/types/chat';
import {
    currentRoomIdAtom,
    ownerStatusesAtom,
    roomStatusRuntimeAtom,
    roomStatusSettingsAtom,
    roomsAtom,
    store,
    userNameAtom,
    type OwnerRoomStatus,
} from '@stores/chat';
import { messageBody } from '@utils/prompt/prompt';
import { apiErrorMessage, queryClient, summarizeRoomStatus } from './api';
import { modeOf } from '@/modes';

const DEBOUNCE_MS = 800;
const MIN_INTERVAL_MS = 5_000;
const MAX_TEXT = 40_000;
const MAX_MESSAGES = 50;

type Transcript = RoomStatusRequest['transcript'];

/** 캐시 변경 감지용. 비밀 값 자체를 키에 저장하지 않는다. */
function signature(value: unknown) {
    const text = JSON.stringify(value) ?? 'undefined';
    let a = 0x811c9dc5;
    let b = 0x9e3779b9;
    for (let i = 0; i < text.length; i++) {
        const c = text.charCodeAt(i);
        a = Math.imul(a ^ c, 0x01000193);
        b = Math.imul(b ^ c, 0x85ebca6b);
    }
    return `${(a >>> 0).toString(16)}-${(b >>> 0).toString(16)}`;
}

/**
 * 오류와 빈 메시지는 제외하고, 긴 메시지도 버리지 않고 분할한다.
 * 진행 알림(sender 'system')은 프로그램이 기록한 사실(단계 전환, 결과 발표 등)이라 함께 넘긴다.
 */
export function roomStatusTranscript(room: Room): Transcript {
    return room.messages.flatMap((m) => {
        const body = messageBody(m);
        if (m.error || !body.trim()) return [];
        const chunks = Math.ceil(body.length / MAX_TEXT);
        return Array.from({ length: chunks }, (_, i) => ({
            id: chunks === 1 ? m.id : `${m.id}:part:${i + 1}`,
            sender: m.sender,
            senderName:
                m.sender === 'system'
                    ? '진행'
                    : (room.agents.find((a) => a.id === m.sender)?.name ??
                      m.senderName ??
                      (m.sender === 'me' ? 'me' : '(나간 멤버)')),
            text: body.slice(i * MAX_TEXT, (i + 1) * MAX_TEXT),
            ...(m.to?.length ? { to: [...m.to] } : {}),
            ...(i === chunks - 1 && m.sources?.length
                ? { sources: m.sources.map((s) => ({ ...s })) }
                : {}),
        }));
    });
}

export function roomStatusBatch(
    messages: Transcript,
    start: number
): Transcript {
    const result: Transcript = [];
    let length = 0;
    for (const message of messages.slice(start, start + MAX_MESSAGES)) {
        if (length + message.text.length > MAX_TEXT) break;
        result.push(message);
        length += message.text.length;
    }
    return result;
}

function removeCache(roomId: string) {
    if (!(roomId in store.get(ownerStatusesAtom))) return;
    store.set(ownerStatusesAtom, (prev) => {
        const next = { ...prev };
        delete next[roomId];
        return next;
    });
}

function runtime(roomId: string, loading: boolean, error?: string) {
    store.set(roomStatusRuntimeAtom, (prev) => ({
        ...prev,
        [roomId]: { loading, ...(error ? { error } : {}) },
    }));
}

function localInputKey(room: Room) {
    return signature({
        roomName: room.name,
        topic: room.topic,
        members: room.agents.map((a) => ({
            id: a.id,
            name: a.name,
            persona: a.persona,
            secret: a.secret ?? '',
        })),
        userName: store.get(userNameAtom),
        choice: store.get(roomStatusSettingsAtom),
    });
}

function inputKey(room: Room, profiles?: ProfilesResponse) {
    const choice = store.get(roomStatusSettingsAtom);
    const id = choice.profileId ?? profiles?.defaultProfileId;
    const profile = profiles?.profiles.find((p) => p.id === id);
    return signature({ local: localInputKey(room), profile });
}

/** 이전 버전의 칸 나눔 형식 캐시는 버리고 새로 정리한다. */
export function isMarkdownSummary(cache: OwnerRoomStatus | undefined) {
    return typeof cache?.summary?.markdown === 'string';
}

function historyMatches(
    cache: OwnerRoomStatus | undefined,
    messages: Transcript
) {
    return (
        !!cache &&
        Array.isArray(cache.messageIds) &&
        cache.messageIds.length <= messages.length &&
        cache.messageIds.every((id, i) => messages[i]?.id === id) &&
        cache.messageSignature ===
            signature(messages.slice(0, cache.messageIds.length))
    );
}

function usableCache(
    cache: OwnerRoomStatus | undefined,
    key: string,
    messages: Transcript
) {
    return (
        !!cache &&
        cache.inputKey === key &&
        isMarkdownSummary(cache) &&
        historyMatches(cache, messages)
    );
}

interface Observer {
    retry: (roomId: string) => void;
    dispose: () => void;
}
let observer: Observer | null = null;

/** 선택한 방만 관찰한다. UI의 접힘 상태와 무관하게 갱신한다. */
export function startRoomStatusObserver() {
    observer?.dispose();
    let disposed = false;
    let selected: string | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let generation = 0;
    let active:
        | {
              roomId: string;
              key: string;
              ctrl: AbortController;
              messages: Transcript;
              end: number;
              generation: number;
          }
        | undefined;
    const lastStarted = new Map<string, number>();
    const failures = new Map<string, string>();
    let desired = '';

    const clearTimer = () => {
        if (timer !== undefined) clearTimeout(timer);
        timer = undefined;
    };
    const cancel = () => {
        clearTimer();
        generation++;
        if (active) {
            active.ctrl.abort();
            if (store.get(roomsAtom).some((room) => room.id === active!.roomId))
                runtime(active.roomId, false);
            else
                store.set(roomStatusRuntimeAtom, (prev) => {
                    const next = { ...prev };
                    delete next[active!.roomId];
                    return next;
                });
        }
        active = undefined;
    };
    const current = () => {
        const id = store.get(currentRoomIdAtom);
        return store.get(roomsAtom).find((r) => r.id === id);
    };
    const profiles = () =>
        queryClient.getQueryData<ProfilesResponse>(['profiles']);
    const fingerprint = (key: string, messages: Transcript) =>
        `${key}:${signature(messages)}`;

    function schedule() {
        if (disposed) return;
        const rooms = store.get(roomsAtom);
        // 초기화·삭제한 방의 영구 캐시도 정리한다.
        for (const id of new Set([
            ...Object.keys(store.get(ownerStatusesAtom)),
            ...Object.keys(store.get(roomStatusRuntimeAtom)),
        ])) {
            const room = rooms.find((r) => r.id === id);
            if (!room) {
                removeCache(id);
                failures.delete(id);
                lastStarted.delete(id);
                store.set(roomStatusRuntimeAtom, (prev) => {
                    const next = { ...prev };
                    delete next[id];
                    return next;
                });
                continue;
            }
            const messages = roomStatusTranscript(room);
            // 선택하지 않은 방은 생성하지 않지만, 변경된 설정·기록의 캐시는 무효화한다.
            const cache = store.get(ownerStatusesAtom)[id];
            if (
                !historyMatches(cache, messages) ||
                !isMarkdownSummary(cache) ||
                (cache?.localInputKey !== undefined &&
                    cache.localInputKey !== localInputKey(room)) ||
                !messages.length ||
                (profiles() &&
                    !usableCache(cache, inputKey(room, profiles()), messages))
            )
                removeCache(id);
        }
        const room = current();
        const id = room?.id ?? null;
        if (selected !== id) {
            cancel();
            selected = id;
            desired = '';
        }
        if (!room) return;
        // 사람이 모든 비밀을 볼 수 없는 동안(예: 마피아 플레이어)은 비밀을 모두 읽는 방 메모를 만들지 않는다
        if (!modeOf(room).userSeesAll(room)) {
            cancel();
            desired = '';
            runtime(room.id, false);
            return;
        }
        const key = inputKey(room, profiles());
        const messages = roomStatusTranscript(room);
        if (
            active &&
            (active.key !== key ||
                !active.messages
                    .slice(0, active.end)
                    .every((m, i) => signature(m) === signature(messages[i])))
        ) {
            cancel();
            desired = '';
        }
        if (!messages.length || !room.agents.length) {
            cancel();
            desired = '';
            failures.delete(room.id);
            removeCache(room.id);
            runtime(room.id, false);
            return;
        }
        const cache = store.get(ownerStatusesAtom)[room.id];
        if (
            usableCache(cache, key, messages) &&
            cache.messageIds.length === messages.length
        ) {
            clearTimer();
            desired = '';
            runtime(room.id, false);
            return;
        }
        const data = profiles();
        if (!data) {
            clearTimer();
            runtime(room.id, false);
            return;
        }
        const choice = store.get(roomStatusSettingsAtom);
        const target = data.profiles.find(
            (p) => p.id === (choice.profileId ?? data.defaultProfileId)
        );
        if (!target) {
            clearTimer();
            runtime(
                room.id,
                false,
                '설정에서 방 상태 요약에 사용할 프로바이더 프로필을 선택하세요.'
            );
            return;
        }
        // 사용자가 비공개 정보 전송을 승인한 목적지는 OpenAI 공식 API이다.
        let approved = target.provider === 'openai';
        if (target.baseURL) {
            try {
                approved =
                    approved &&
                    new URL(target.baseURL).origin === 'https://api.openai.com';
            } catch {
                approved = false;
            }
        }
        if (!approved) {
            clearTimer();
            runtime(
                room.id,
                false,
                '방 상태 요약은 승인된 OpenAI API 프로필을 선택하세요.'
            );
            return;
        }
        const next = fingerprint(key, messages);
        if (failures.get(room.id) === next || active) return;
        if (desired === next && timer !== undefined) return;
        clearTimer();
        desired = next;
        runtime(room.id, true);
        const elapsed = Date.now() - (lastStarted.get(room.id) ?? -Infinity);
        timer = setTimeout(
            () => {
                timer = undefined;
                void generate();
            },
            Math.max(DEBOUNCE_MS, MIN_INTERVAL_MS - elapsed)
        );
    }

    async function generate() {
        const room = current();
        if (disposed || !room || active) return;
        const messages = roomStatusTranscript(room);
        const key = inputKey(room, profiles());
        const cache = store.get(ownerStatusesAtom)[room.id];
        const previous = usableCache(cache, key, messages) ? cache : undefined;
        const start = previous?.messageIds.length ?? 0;
        const batch = roomStatusBatch(messages, start);
        if (!batch.length) {
            runtime(room.id, false);
            return;
        }
        const ctrl = new AbortController();
        const job = {
            roomId: room.id,
            key,
            ctrl,
            messages,
            end: start + batch.length,
            generation,
        };
        active = job;
        lastStarted.set(room.id, Date.now());
        runtime(room.id, true);
        const choice = store.get(roomStatusSettingsAtom);
        try {
            const response = await summarizeRoomStatus(
                {
                    profileId: choice.profileId,
                    model: choice.model,
                    reasoning: choice.reasoning ?? null,
                    roomName: room.name,
                    topic: room.topic,
                    userName: store.get(userNameAtom),
                    members: room.agents.map((a) => ({
                        id: a.id,
                        name: a.name,
                        persona: a.persona,
                        secret: a.secret ?? '',
                    })),
                    transcript: batch.map((m) => ({
                        ...m,
                        senderName:
                            m.sender === 'me'
                                ? store.get(userNameAtom)
                                : m.senderName,
                    })),
                    previous: previous?.summary ?? null,
                },
                ctrl.signal
            );
            if (
                disposed ||
                ctrl.signal.aborted ||
                active !== job ||
                generation !== job.generation
            )
                return;
            if (!response.ok) throw new Error(response.error);
            const fresh = current();
            if (
                !fresh ||
                fresh.id !== room.id ||
                inputKey(fresh, profiles()) !== key
            )
                return;
            const freshMessages = roomStatusTranscript(fresh);
            const prefix = messages.slice(0, job.end);
            if (
                signature(prefix) !== signature(freshMessages.slice(0, job.end))
            )
                return;
            store.set(ownerStatusesAtom, (prev) => ({
                ...prev,
                [room.id]: {
                    summary: response.status,
                    via: response.via,
                    updatedAt: Date.now(),
                    inputKey: key,
                    localInputKey: localInputKey(room),
                    messageIds: prefix.map((m) => m.id),
                    messageSignature: signature(prefix),
                },
            }));
            failures.delete(room.id);
        } catch (err) {
            if (disposed || ctrl.signal.aborted || active !== job) return;
            failures.set(room.id, fingerprint(key, messages));
            const error = await apiErrorMessage(err);
            if (!disposed && !ctrl.signal.aborted && active === job)
                runtime(room.id, false, error);
        } finally {
            if (active === job) {
                active = undefined;
                desired = '';
                // 성공하면 다음 증분을 처리하고, 실패하면 같은 입력을 자동 반복하지 않는다.
                if (!failures.has(room.id)) schedule();
                else {
                    const fresh = current();
                    if (
                        fresh &&
                        fingerprint(
                            inputKey(fresh, profiles()),
                            roomStatusTranscript(fresh)
                        ) !== failures.get(room.id)
                    )
                        schedule();
                }
            }
        }
    }

    const unsubscribe = [
        store.sub(roomsAtom, schedule),
        store.sub(currentRoomIdAtom, schedule),
        store.sub(userNameAtom, schedule),
        store.sub(roomStatusSettingsAtom, schedule),
        queryClient.getQueryCache().subscribe((event) => {
            if (
                event.type === 'updated' &&
                event.query.queryKey[0] === 'profiles'
            )
                schedule();
        }),
    ];
    const instance: Observer = {
        retry(roomId) {
            if (roomId !== current()?.id) return;
            failures.delete(roomId);
            desired = '';
            clearTimer();
            schedule();
        },
        dispose() {
            disposed = true;
            cancel();
            unsubscribe.forEach((fn) => fn());
            if (observer === instance) observer = null;
        },
    };
    observer = instance;
    schedule();
    return () => instance.dispose();
}

export function retryRoomStatus(roomId: string) {
    observer?.retry(roomId);
}
