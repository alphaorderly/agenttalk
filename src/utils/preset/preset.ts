import { DEFAULT_EXPRESSION } from '@shared/images';
import type { Agent, PresetRoom, Room } from '@/types/chat';
import { uid } from '@utils/id/id';
import { remapModeAgentIds, withoutModeState } from '@/modes';

/**
 * 방 설정을 프리셋으로 담는다. 대화 기록, 방 ID, 모드 진행 상태(예: 게임)는 넣지 않고,
 * 얼굴은 기본 표정으로 되돌린다
 */
export function toPresetRoom(room: PresetRoom | Room): PresetRoom {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { id, messages, updatedAt, ...rest } = room as Room;
    return {
        ...withoutModeState(rest),
        // 기억은 그 방의 대화에서 쌓인 것이라 담지 않는다 (감정은 설정으로 담는다)
        agents: room.agents.map(({ memories: _memories, ...a }) => ({
            ...a,
            ...(a.portrait && { expression: DEFAULT_EXPRESSION }),
        })),
    };
}

/** 프리셋으로 새 방을 만들 때: 에이전트 ID를 새로 매겨 다른 방과 겹치지 않게 한다 */
export function fromPreset(room: PresetRoom): PresetRoom {
    const agents = room.agents.map((a): Agent => ({ ...a, id: uid() }));
    const ids = new Map(room.agents.map((a, i) => [a.id, agents[i].id]));
    return remapModeAgentIds(
        {
            ...room,
            agents,
        },
        ids
    );
}
