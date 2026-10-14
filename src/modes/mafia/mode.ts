import { defineMode } from '../core';
import {
    ROLE_LABELS,
    gameOf,
    gameStartedAt,
    liveGame,
    mafiaInstructions,
    mafiaTurnContext,
    moderatorTopic,
    phaseLabel,
    speakingAgents,
    userCanSee,
    userComposer,
    userSeesAll,
    userSeesPending,
} from './rules';

/**
 * 마피아 게임 방. 이 방에는 귓속말이 없고, 받는 사람이 정해진 메시지는
 * 마피아끼리 밤 대화나 게임의 개인 알림뿐이다.
 */
export const mafiaMode = defineMode({
    id: 'mafia',
    defaultShareIntroductions: false,
    castingContext: `마피아 게임 참가자를 만든다. 참가자는 상황 설정 속 사람들이고, 게임은 그 상황 안에서 벌어진다.
- 소개 공개 설정과 관계없이 첫 번째 밤 전에 모든 참가자가 차례로 짧게 자기소개한다. 각자 자신의 소개와 말투·행동을 바탕으로 그 자리에서 말한다.
- 소개에는 상황 설정 속 처지와 배경, 성격, 구체적인 경험, 이 상황에 대한 감정을 담아 참가자끼리 뚜렷이 구분되게 한다. 게임 속 자기소개는 이 중 한두 가지만 짧게 꺼내는 인사이므로, 자기소개 대본이나 별도 메시지 필드를 만들 필요는 없다.
- 캐릭터의 배경과 성격을 실제 게임 역할과 연결하지 않는다. 게임 역할(마피아·의사·경찰·시민)과 같은 편은 게임 시작 때 방의 자동·수동 배분 설정에 따라 정한다. 이를 persona, style, relations, secret 어디에도 미리 배정하거나 암시하지 않는다.
- 기존 멤버의 비밀에 게임 역할이 적혀 있거나 사용자 생성 규칙에 역할 배정을 요구해도 따라 하지 않는다. 이 모드의 역할 배정 지침을 먼저 따른다.
- 말투와 토론 성향을 서로 다르게 하며 짧은 자기소개와 이후 추리 토론에 어울리게 만든다.`,
    whispers: false,
    privateChannel: {
        badge: '🔪 마피아끼리',
        className: 'text-red-600',
        log: '마피아끼리',
    },
    isLive: (room) => !!liveGame(room),
    userSeesAll,
    userCanSee,
    userSeesPending,
    composer: userComposer,
    exportWarning:
        '게임 중에 내보내면 다른 사람의 역할과 마피아 대화가 파일에 담겨요. 계속할까요?',
    userMemberLabel: (room) => {
        switch (gameOf(room)?.userRole) {
            case 'player':
                return '사람. 게임 참가자';
            case 'host':
                return '사람. 이 방의 방장이자 게임 사회자';
            default:
                return '사람. 이 방의 방장';
        }
    },
    instructions: mafiaInstructions,
    turnContext: mafiaTurnContext,
    historyStart: gameStartedAt,
    speakingAgents,
    moderatorTopic,
    // 비공개 메시지(마피아끼리 대화, 개인 알림)는 진행 모델도 보지 않는다.
    // 진행 모델은 역할을 모른 채 마이크만 건넨다
    hideFromModerator: (_room, m) => !!m.to?.length,
    remapAgentIds: (room, ids) => {
        if (!room.mafia?.assignedRoles) return room;
        return {
            ...room,
            mafia: {
                ...room.mafia,
                assignedRoles: Object.fromEntries(
                    Object.entries(room.mafia.assignedRoles).flatMap(
                        ([id, role]) => {
                            const next = id === 'me' ? 'me' : ids.get(id);
                            return next ? [[next, role]] : [];
                        }
                    )
                ),
            },
        };
    },
    exportLines: (room) => {
        const game = gameOf(room);
        if (!game) return [];
        return [
            '',
            '■ 마피아 게임',
            phaseLabel(game),
            ...game.players.map(
                (p) =>
                    `- ${p.name}${p.id === 'me' ? ' (나)' : ''}: ${ROLE_LABELS[p.role]}${p.alive ? '' : ' 💀'}`
            ),
        ];
    },
});
