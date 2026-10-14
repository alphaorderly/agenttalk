import { z } from 'zod';

/**
 * 채팅방·메시지·프리셋 저장 API. 방의 세부 구조는 클라이언트가 정하므로
 * 서버는 ID와 크기만 검사하고 나머지 필드는 그대로 보관한다.
 */
const id = z.string().trim().min(1).max(128);

/** 메시지를 뺀 방 정보 (설정 · 멤버) */
export const storedRoomSchema = z.looseObject({
    id,
    name: z.string().max(200),
    agents: z.array(z.looseObject({ id })).max(100),
    updatedAt: z.number(),
});

export const storedMessageSchema = z.looseObject({
    id,
    sender: z.string().max(128),
    text: z.string().max(100_000),
    ts: z.number(),
});

/** 방 하나의 변경분. 메시지는 순서(seq)와 함께 추가·수정하고, 지운 것은 ID로 보낸다 */
export const roomSyncSchema = z.object({
    room: storedRoomSchema,
    upsert: z
        .array(
            z.object({
                seq: z.number().int().min(0),
                message: storedMessageSchema,
            })
        )
        .max(5000),
    remove: z.array(id).max(50_000),
    /** true면 이 방의 기존 메시지를 모두 지우고 upsert로 바꾼다 */
    replace: z.boolean().optional(),
});

export type RoomSync = z.infer<typeof roomSyncSchema>;

/** 방장 전용 메모 캐시 (형식은 클라이언트가 정한다) */
export const ownerStatusSchema = z.looseObject({ updatedAt: z.number() });

export interface RoomsResponse {
    /** 메시지를 포함한 전체 방. 서버가 정한 순서(생성 순) */
    rooms: unknown[];
    ownerStatuses: Record<string, unknown>;
}

/** 프리셋: 대화 기록 없이 방 설정과 멤버만 담는다 */
export const presetInputSchema = z.object({
    name: z.string().trim().min(1, '프리셋 이름을 입력하세요').max(60),
    room: z.looseObject({
        name: z.string().max(200),
        agents: z.array(z.looseObject({ id })).max(100),
    }),
});

export type PresetInput = z.infer<typeof presetInputSchema>;

export const presetRenameSchema = presetInputSchema.pick({ name: true });

export interface StoredPreset<Room = unknown> {
    id: string;
    name: string;
    room: Room;
    createdAt: number;
    updatedAt: number;
}
