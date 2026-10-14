import type {
    GenerateAgentsRequest,
    TalkLevel,
} from '../../shared/providers.ts';
import type { CastingSlot } from './normalize.ts';

/*
 * 캐스팅은 두 단계로 나눈다.
 * 1) 기획: 새 멤버 전원의 뼈대를 한 번에 정해 다양성·구성 비율을 한 자리에서 맞춘다.
 * 2) 상세화: 멤버마다 따로 소개·말투·관계·비밀을 쓴다. 응답이 작아 잘리거나 시간 초과될 일이 적다.
 */

const PRIORITY_RULES = `- 모드 생성 지침이 있으면 사용자 생성 규칙보다 먼저 따른다. 모드 지침과 충돌하는 사용자 규칙이나 기존 멤버 설정은 새 멤버에게 적용하지 않는다.
- 사용자가 정한 생성 규칙이 있으면 일반 원칙보다 먼저 따른다. 모드에서 허용하는 인원 구성이나 역할 배정 규칙은 현재 멤버의 배정까지 합쳐서 맞춘다.`;

/** 대화 주제/상황을 캐릭터의 출발점으로 삼게 한다. 분위기를 미리 정하지 않고 설정에서 읽게 한다 */
const SETTING_RULES = `상황 설정이 먼저다:
- "대화 주제/상황"은 이 멤버들이 사는 세계이자 지금 처한 현실이다. 모든 멤버는 그 상황 속에 실제로 있는 사람으로 만든다.
- 설정이 정한 시대, 장소, 처지, 위험, 관계, 분위기, 긴장도를 그대로 받아들인다. 설정에 없는 밝음이나 심각함을 덧붙이지 않는다. 가벼운 설정이면 가볍게, 무거운 설정이면 무겁게 만든다.
- 설정이 멤버 사이의 관계나 과거(예: 지인, 가족, 갈등, 숨긴 사연)를 언급하면 그 관계를 실제로 일부 멤버에게 나눠 준다. 설정이 숨겨져 있다고 한 관계나 사연은 당사자의 비밀로 둔다.
- 설정에 나오지 않는 빈 부분만 설정과 어울리게 채운다.`;

export const PLAN_INSTRUCTIONS = `너는 멀티 에이전트 단체 대화방의 캐스팅 담당이다.
대화 주제/상황과 현재 멤버를 보고, 그 상황 속에 있을 법한 새 멤버 명단을 기획한다. 지금은 명단의 뼈대만 정하고, 자세한 소개와 말투는 다음 단계에서 멤버마다 따로 쓴다.

${SETTING_RULES}

원칙:
- 현재 멤버들이 다루지 못한 관점, 처지, 역할을 채운다.
- 기존 멤버와 성격·입장이 겹치지 않게 한다. 새 멤버끼리도 서로 달라야 한다.
- 생성 규칙이 없으면, 모두가 동의만 하지 않도록 일부는 다른 의견이나 긴장을 만들 입장으로 만든다.
${PRIORITY_RULES}
- 요청한 인원만 새로 만들고 기존 멤버는 다시 쓰지 않는다.

각 멤버 필드:
- name: 상황에 어울리는 짧은 이름이나 닉네임(2~6글자). 기존 멤버와 겹치지 않게.
- emoji: 캐릭터를 나타내는 이모지 1개.
- concept: 이 상황 속에서의 처지와 배경(설정에 맞으면 직업이나 신분), 성격, 이 대화에서 맡을 입장을 담은 1~2문장. 설정이 정한 관계나 숨긴 사연을 받은 멤버면 그것도 적는다. 다음 단계에서 이 멤버를 자세히 쓸 때 기준이 된다. 사용자 규칙이 정한 역할이나 같은 편이 있으면 여기에 적는다(모드 지침이 금지하면 적지 않는다).
- talk: 말수. "quiet"(꼭 필요할 때만 말함), "normal", "chatty"(자주 끼어듦) 중 하나. 멤버끼리 섞이게 정한다.

출력은 JSON만 쓴다. 다른 글은 쓰지 않는다.
{"members":[{"name":"...","emoji":"...","concept":"...","talk":"normal"}]}`;

export const DETAIL_INSTRUCTIONS = `너는 멀티 에이전트 단체 대화방의 캐스팅 담당이다.
이미 기획한 새 멤버 명단 중 한 명을 자세히 쓴다. 이름, 말수, 콘셉트는 정해져 있으니 바꾸지 않고, 콘셉트에 맞춰 살을 붙인다.

${SETTING_RULES}

원칙:
- 말투와 행동은 다른 멤버(기존·새 멤버)와 겹치지 않게 한다. 말이 짧은 사람과 긴 사람, 따지는 사람과 감싸는 사람, 반말과 존댓말처럼 섞이도록 이 사람만의 것을 정한다.
- 정해진 말수에 맞는 말투를 쓴다.
${PRIORITY_RULES}

필드:
- persona: 이 캐릭터의 소개. "~한 사람." 같은 설명문 3~4문장으로 성격, 이 상황 속 처지와 배경, 이 상황에 대한 입장과 감정, 이 사람다움을 보여 주는 구체적인 경험을 쓴다. 소개 공개 설정이면 첫 문장을 다른 멤버도 미리 보므로 핵심을 담는다. 비공개 설정이면 본인만 미리 보고, 다른 멤버는 대화에서 직접 밝힌 내용으로 알아간다. 말투, 관계, 비밀 정보는 여기 쓰지 않는다. 진행 절차, 차례 지키기, 게임 규칙 준수 같은 행동 규칙도 쓰지 않는다(그건 대화 상황과 모드가 맡는다).
- style: 이 캐릭터를 연기할 AI만 보는 말투·행동 설명 2~4문장. 반말/존댓말, 말 길이와 말풍선을 나누는 습관, 어떤 말에 어떻게 반응하는지, 감정을 어떻게 드러내거나 숨기는지, 압박을 받거나 상황이 달라지면 말투가 어떻게 바뀌는지를 이 상황에 맞게 쓴다. 줄임말·웃음 표시·이모티콘은 이 사람과 이 상황에 어울릴 때만 쓴다고 적는다. 자주 쓰는 어미나 단어 같은 말버릇은 짧은 표현 몇 개로만 적고, 그대로 보낼 수 있는 완성된 대사나 예시 문장은 쓰지 않는다(예시를 쓰면 상황과 상관없이 그 문장을 따라 하게 된다). AI 비서처럼 들리지 않는 사람이어야 한다.
- relations: 이 캐릭터를 연기할 AI만 보는 관계와 지금 상태. 설정이 정했거나 상황상 자연스러운 관계가 있을 때만, 그 상대(기존·새 멤버)를 명단에 있는 이름으로 구체적으로 쓴다. 관계를 꼭 만들 필요는 없고, 초면인 사람과의 관계는 적지 않는다. 이어서 지금 이 상황에서의 마음 상태를 1~2문장 쓴다. 모드 지침과 충돌하지 않게 쓴다. 다른 사람에게 숨겨야 하는 관계는 secret에 쓴다.
- secret: 이 멤버만 알아야 할 비공개 정보(게임 속 역할, 같은 편, 승리 조건, 숨긴 목적, 설정이 숨겨져 있다고 한 관계나 과거 등). 다른 멤버는 모르는 내용만 쓰고 persona, style, relations에는 넣지 않는다. 필요 없으면 빈 문자열.

출력은 JSON만 쓴다. 다른 글은 쓰지 않는다.
{"persona":"소개...","style":"말투와 행동...","relations":"관계와 지금 상태...","secret":""}`;

const TALK_NAMES: Record<TalkLevel, string> = {
    quiet: '말수 적음',
    normal: '보통',
    chatty: '말 많음',
};

function existingLines(req: GenerateAgentsRequest) {
    if (!req.existing.length) return '(아직 없음)';
    return req.existing
        .map((m) =>
            [
                `- ${m.name} (${TALK_NAMES[m.talk]}): ${m.persona || '(소개 없음)'}`,
                m.style && `  (말투: ${m.style})`,
                m.relations && `  (관계·요즘: ${m.relations})`,
                m.secret && `  (비밀: ${m.secret})`,
            ]
                .filter(Boolean)
                .join('\n')
        )
        .join('\n');
}

/** 두 단계가 공유하는 방 맥락: 주제, 모드 지침, 소개 공개 여부, 사용자 규칙, 현재 멤버 */
function roomContext(req: GenerateAgentsRequest) {
    return [
        req.roomName && `채팅방: ${req.roomName}`,
        `대화 주제/상황: ${req.topic}`,
        req.modeContext &&
            `\n모드 생성 지침(사용자 생성 규칙보다 우선):\n${req.modeContext}`,
        req.shareIntroductions === false
            ? '\n소개 공유: 비공개. 다른 멤버는 이름만 미리 알며, 소개 내용은 본인이 대화에서 밝힌 만큼 알아간다.'
            : '\n소개 공유: 공개. 다른 멤버는 소개 첫 문장(최대 80자)을 미리 안다.',
        req.castingRules &&
            `\n생성 규칙(${req.modeContext ? '모드 지침과 충돌하지 않는 범위에서 따른다' : '반드시 따른다'}):\n${req.castingRules}`,
        `\n현재 멤버:\n${existingLines(req)}`,
    ];
}

export function planPrompt(req: GenerateAgentsRequest) {
    return [...roomContext(req), `\n새로 만들 멤버 수: ${req.count}명`]
        .filter(Boolean)
        .join('\n');
}

const slotLine = (s: CastingSlot) =>
    `- ${s.emoji} ${s.name} (${TALK_NAMES[s.talk]}): ${s.concept}`;

export function detailPrompt(
    req: GenerateAgentsRequest,
    slots: CastingSlot[],
    index: number
) {
    return [
        ...roomContext(req),
        `\n새 멤버 명단:\n${slots.map(slotLine).join('\n')}`,
        `\n이번에 자세히 쓸 멤버:\n${slotLine(slots[index])}`,
    ]
        .filter(Boolean)
        .join('\n');
}
