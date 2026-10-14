import { DEFAULT_EXPRESSION } from '@shared/images';
import type { Agent, Room } from '@/types/chat';

export const expressionsOn = (room: Pick<Room, 'expressions'>) =>
    !!room.expressions?.enabled;

/** 에이전트의 현재 얼굴 이미지 ID. 표정 이미지가 아직 없으면 기본 얼굴 */
export function currentFace(agent: Agent): string | undefined {
    if (!agent.portrait) return undefined;
    return (
        agent.faces?.[agent.expression ?? DEFAULT_EXPRESSION] ?? agent.portrait
    );
}

/** 방의 표정 기능이 켜져 있으면 얼굴 이미지(face가 있으면 그 얼굴), 아니면 undefined(이모지) */
export function agentImage(
    room: Pick<Room, 'expressions'>,
    agent: Agent | undefined,
    face?: string
) {
    if (!expressionsOn(room)) return undefined;
    return face ?? (agent ? currentFace(agent) : undefined);
}
