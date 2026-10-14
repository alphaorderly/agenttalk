import type {
    Message,
    ModeStates,
    PresetRoom,
    Room,
    RoomMode,
} from '@/types/chat';
import type { ModeDefinition } from './core';
import { chatMode } from './chat/mode';
import { mafiaMode } from './mafia/mode';

/** 모드 규칙 레지스트리. 엔진 훅은 engines.ts, 화면은 ui.ts에 따로 등록한다 */
export const MODES: Record<RoomMode, ModeDefinition> = {
    chat: chatMode,
    mafia: mafiaMode,
};

/** 화면에 보일 모드 순서 */
export const MODE_IDS = Object.keys(MODES) as RoomMode[];

/** 방의 모드 규칙. mode가 없는 이전 데이터는 일반 대화 */
export const modeOf = (room: Pick<Room, 'mode'>): ModeDefinition =>
    MODES[room.mode ?? 'chat'] ?? chatMode;

/** 명시한 선택이 먼저이고, 설정이 없는 방·프리셋은 현재 모드의 기본값을 따른다 */
export const shareIntroductionsOf = (
    room: Pick<Room, 'mode' | 'shareIntroductions'>
): boolean => room.shareIntroductions ?? modeOf(room).defaultShareIntroductions;

/** 현재 선택하지 않은 모드의 보관된 설정도 프리셋의 새 에이전트 ID를 따라간다 */
export const remapModeAgentIds = (
    room: PresetRoom,
    ids: ReadonlyMap<string, string>
): PresetRoom =>
    Object.values(MODES).reduce(
        (current, mode) => mode.remapAgentIds?.(current, ids) ?? current,
        room
    );

/** 방에서 모드 진행 상태만 뽑는다 (방 설정을 고쳐도 진행 중인 상태는 그대로 둔다) */
export const modeStateOf = (
    room: Pick<Room, 'modeState'>
): Pick<Room, 'modeState'> =>
    room.modeState ? { modeState: room.modeState } : {};

/** 모드 진행 상태를 뺀 방 (프리셋으로 담을 때) */
export function withoutModeState<T extends Pick<Room, 'modeState'>>(
    room: T
): Omit<T, 'modeState'> {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { modeState, ...rest } = room;
    return rest;
}

/**
 * 이전 버전에 저장된 방을 지금 형식으로 맞춘다. 바꿀 게 없으면 같은 객체를 돌려준다.
 * - room.game(마피아 게임) → room.modeState.mafia
 * - message.game(진행 알림 표시) → message.notice
 */
export function upgradeRoom(room: Room): Room {
    const legacy = room as Room & { game?: ModeStates['mafia'] };
    let next: Room = room;
    if ('game' in legacy) {
        const { game, ...rest } = legacy;
        next = game
            ? { ...rest, modeState: { ...rest.modeState, mafia: game } }
            : rest;
    }
    let messagesChanged = false;
    const messages = next.messages.map((m) => {
        if (!('game' in m)) return m;
        messagesChanged = true;
        const { game, ...rest } = m as Message & { game?: boolean };
        return game ? { ...rest, notice: true } : rest;
    });
    return messagesChanged ? { ...next, messages } : next;
}
