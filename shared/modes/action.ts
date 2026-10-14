/**
 * 모드가 서버에 맡기는 AI 작업(예: 마피아 게임의 엔딩 연출)의 공통 계약.
 * 모든 작업은 POST /api/modes/:mode/:action 하나로 부르고, 응답은 아래 모양이다.
 */
export type ModeActionResponse<T> =
    | ({ ok: true; via: string } & T)
    | { ok: false; error: string };

/** api 기준 경로 (prefix /api 제외) */
export const modeActionPath = (mode: string, action: string) =>
    `modes/${encodeURIComponent(mode)}/${encodeURIComponent(action)}`;
