import type { ModeStates, Room, RoomMode } from '@/types/chat';
import {
    appendMessage,
    moderatorSettingsAtom,
    roomsAtom,
    store,
    updateRoom,
    userNameAtom,
    type ModelChoice,
} from '@stores/chat';
import { runModeAction as postModeAction } from '@services/api';

/**
 * 모드가 앱 상태와 서버에 닿는 유일한 통로. 모드 코드는 @stores·@services를 직접 import하지 않는다
 * (eslint로 막는다). 대화 엔진을 멈추거나 다시 시작하는 동작은 화면 전용 controls.ts에 있다.
 */

export type { ModelChoice };
export { appendMessage, updateRoom };

export const getRoom = (roomId: string): Room | undefined =>
    store.get(roomsAtom).find((r) => r.id === roomId);

/** 모드의 진행 상태 (room.modeState[mode]) */
export const stateOf = <K extends keyof ModeStates>(
    room: Pick<Room, 'modeState'>,
    mode: K
): ModeStates[K] | undefined => room.modeState?.[mode];

/** 모드의 진행 상태를 바꾼다. fn이 undefined를 돌려주면 상태를 지운다 */
export function setState<K extends keyof ModeStates>(
    roomId: string,
    mode: K,
    fn: (
        state: ModeStates[K] | undefined,
        room: Room
    ) => ModeStates[K] | undefined
) {
    updateRoom(roomId, (r) => withState(r, mode, fn(stateOf(r, mode), r)));
}

/** room의 모드 진행 상태를 바꾼 새 방 (다른 필드도 함께 바꿀 때 updateRoom 안에서 쓴다) */
export function withState<K extends keyof ModeStates>(
    room: Room,
    mode: K,
    state: ModeStates[K] | undefined
): Room {
    if (stateOf(room, mode) === state) return room;
    const modeState = { ...room.modeState };
    if (state === undefined) delete modeState[mode];
    else modeState[mode] = state;
    return { ...room, modeState };
}

/** 진행 알림. 에이전트도 로그에서 본다. to가 있으면 그 사람만 본다 */
export function announce(roomId: string, text: string, to?: string[]) {
    appendMessage(roomId, { sender: 'system', text, notice: true, to });
}

export const userName = () => store.get(userNameAtom);

/** AI 도우미(진행 모델) 설정. 모드의 서버 작업도 이 모델로 돌린다 */
export const assistantModel = (): ModelChoice =>
    store.get(moderatorSettingsAtom);

/** 서버의 모드 작업 (server/modes에 등록한 것) */
export const runModeAction = <T>(
    mode: RoomMode,
    action: string,
    req: unknown,
    signal?: AbortSignal
) => postModeAction<T>(mode, action, req, signal);
