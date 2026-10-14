import type { ModeSettings, PresetRoom, RoomMode } from '@/types/chat';
import { chatUi } from './chat/ui';
import { mafiaSettings } from './mafia/settings';
import { mafiaUi } from './mafia/ui';
import type {
    ModeSettingsEditor,
    ModeSettingsEditors,
    ModeUi,
} from './uiTypes';

/** 모드별 화면 레지스트리. 규칙은 index.ts, 엔진 훅은 engines.ts에 따로 등록한다 */
export const MODE_UI: Record<RoomMode, ModeUi> = {
    chat: chatUi,
    mafia: mafiaUi,
};

export const modeUiOf = (mode: RoomMode | undefined): ModeUi =>
    MODE_UI[mode ?? 'chat'] ?? chatUi;

/** 모드별 방 설정 칸. 키(모드 id)는 방의 설정 필드 이름이기도 하다 (room.mafia) */
export const MODE_SETTINGS: ModeSettingsEditors = {
    mafia: mafiaSettings,
};

export type SettingsMode = keyof ModeSettings;

export const hasSettings = (mode: RoomMode): mode is SettingsMode =>
    mode in MODE_SETTINGS;

/** 모드의 설정 편집기. 값은 그 모드의 설정(room[mode])만 넘긴다 */
export const settingsEditorOf = (mode: SettingsMode) =>
    MODE_SETTINGS[mode] as ModeSettingsEditor<ModeSettings[SettingsMode]>;

/** 모든 모드의 설정 (없으면 기본값). 방 종류를 바꿔도 각 모드의 설정은 남는다 */
export function modeSettingsOf(
    room: Partial<PresetRoom> | undefined,
    agentCount: number
): ModeSettings {
    return Object.fromEntries(
        (Object.keys(MODE_SETTINGS) as SettingsMode[]).map((mode) => {
            const editor = settingsEditorOf(mode);
            const stored = room?.[mode];
            return [
                mode,
                stored
                    ? (editor.load?.(stored) ?? stored)
                    : editor.defaults(agentCount),
            ];
        })
    ) as unknown as ModeSettings;
}

/** 폼 스키마에 넣을 모드별 설정 스키마 */
export const modeSettingsShape = Object.fromEntries(
    Object.entries(MODE_SETTINGS).map(([mode, e]) => [mode, e.schema])
) as { [K in SettingsMode]: ModeSettingsEditors[K]['schema'] };
