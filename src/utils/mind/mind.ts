import type { Agent } from '@/types/chat';

/**
 * 에이전트 한 명의 마음: 지금 감정과 그 사람만 아는 기억.
 * 둘 다 그 에이전트의 프롬프트에만 들어가고 진행 모델·다른 멤버에게는 넘기지 않는다.
 * 에이전트는 발언 출력에 [감정:…], [기억:…] 줄을 붙여 스스로 고친다.
 */

export const FEELING_MAX = 100;
export const MEMORY_MAX = 200;
/** 한 사람이 들고 있는 기억 수. 넘치면 오래된 것부터 잊는다 */
export const MEMORY_LIMIT = 30;
/** 한 번의 발언에서 새로 남길 수 있는 기억 수 */
const MEMORIES_PER_TURN = 2;

const FEELING_TAG = /[[(（]\s*감정\s*[:：]\s*([^\])）\n]+?)\s*[\])）]/g;
const MEMORY_TAG = /[[(（]\s*기억\s*[:：]\s*([^\])）\n]+?)\s*[\])）]/g;

/** 모델 출력에서 감정·기억 표시를 떼어 낸다. 감정은 마지막 것, 기억은 앞에서부터 몇 개만 쓴다 */
export function extractMind(text: string): {
    text: string;
    feeling: string | null;
    memories: string[];
} {
    let feeling: string | null = null;
    const memories: string[] = [];
    const cleaned = text
        .replace(FEELING_TAG, (_, value: string) => {
            if (value.trim()) feeling = value.trim().slice(0, FEELING_MAX);
            return '';
        })
        .replace(MEMORY_TAG, (_, value: string) => {
            const memory = value.trim().slice(0, MEMORY_MAX);
            if (memory && memories.length < MEMORIES_PER_TURN)
                memories.push(memory);
            return '';
        });
    return { text: cleaned, feeling, memories };
}

/** 새 감정·기억을 반영한 에이전트. 같은 기억은 다시 쌓지 않는다 */
export function applyMind(
    agent: Agent,
    mind: { feeling: string | null; memories: string[] }
): Agent {
    const known = agent.memories ?? [];
    const added = mind.memories.filter((m) => !known.includes(m));
    if (!added.length && (!mind.feeling || mind.feeling === agent.feeling))
        return agent;
    return {
        ...agent,
        ...(mind.feeling && { feeling: mind.feeling }),
        ...(added.length && {
            memories: [...known, ...added].slice(-MEMORY_LIMIT),
        }),
    };
}

export const MIND_RULES = `감정과 기억:
- 채팅 로그 아래에 너의 지금 감정과 너만 아는 기억이 적혀 있다. 이것은 너만 보고 다른 사람에게는 보이지 않는다. 그 감정과 기억에 따라 말하고 판단한다.
- 방금 일로 감정이 달라졌으면 출력의 아무 줄에 [감정: 지금 감정과 그 이유를 짧게]를 쓴다. 예: [감정: 수빈이 내 말을 계속 캐물어 초조함]. 그대로면 쓰지 않는다.
- 나중에 판단할 때 쓸 만한 일을 알게 되거나 짐작했으면 [기억: 짧은 메모]를 쓴다. 예: [기억: 2번째 밤 수빈을 노렸는데 아무도 죽지 않음. 의사가 수빈을 지켰을 수 있음]. 확인한 사실과 짐작을 구분한다. 이미 있는 기억은 다시 쓰지 않는다. 한 번에 최대 ${MEMORIES_PER_TURN}개.
- 이 표시들은 글자로 보내지지 않는다.`;

/** 채팅 로그 아래에 붙는 이 에이전트의 감정과 기억 */
export function mindContext(agent: Agent): string[] {
    const feeling = agent.feeling?.trim();
    const memories = agent.memories ?? [];
    return [
        feeling ? `[${agent.name}의 지금 감정] ${feeling}` : null,
        memories.length
            ? `[${agent.name}만 아는 기억] (오래된 것부터)\n${memories.map((m) => `- ${m}`).join('\n')}`
            : null,
    ].filter((l) => l !== null);
}
