import { mafiaActions } from './mafia/index.ts';
import type { ModeAction, ModeActionTarget } from './types.ts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyModeAction = ModeAction<any, object>;

/**
 * 모드별 서버 작업 레지스트리. 키는 클라이언트의 모드 id(RoomMode)와 같다.
 * POST /api/modes/:mode/:action 으로 부른다.
 */
const MODE_ACTIONS: Record<string, Record<string, AnyModeAction>> = {
    mafia: mafiaActions,
};

export const modeActionOf = (
    mode: string,
    action: string
): ModeAction<ModeActionTarget, object> | undefined =>
    Object.hasOwn(MODE_ACTIONS, mode) &&
    Object.hasOwn(MODE_ACTIONS[mode], action)
        ? MODE_ACTIONS[mode][action]
        : undefined;
