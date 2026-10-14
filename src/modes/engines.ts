import type { Room, RoomMode } from '@/types/chat';
import type { ModeEngine } from './core';
import { chatEngine } from './chat/engine';
import { mafiaEngine } from './mafia/engine';

/** 모드별 대화 엔진 훅. 규칙은 index.ts, 화면은 ui.ts에 따로 등록한다 */
const ENGINES: Record<RoomMode, ModeEngine> = {
    chat: chatEngine,
    mafia: mafiaEngine,
};

export const engineOf = (room: Pick<Room, 'mode'>): ModeEngine =>
    ENGINES[room.mode ?? 'chat'] ?? chatEngine;
