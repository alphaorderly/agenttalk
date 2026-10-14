import {
    restartConversation,
    startConversation,
    stopConversation,
} from '../controls';
import {
    abandonGame,
    startNewGame,
    startVote,
    submitUserAction,
} from './engine';

/**
 * 마피아 상황판의 버튼이 부르는 동작. 대화 엔진을 멈추고 다시 시작해야 해서
 * 엔진(engine.ts)과 따로 둔다 (엔진은 대화 엔진을 import하지 않는다).
 */

/** 새 게임을 시작한다. 진행 중인 대화를 멈추고 참가자 자기소개부터 진행한다 */
export const startMafiaGame = (roomId: string) =>
    restartConversation(roomId, () => startNewGame(roomId), {
        resetBudget: true,
    });

/** 낮 토론을 끝내고 투표로 넘어간다 */
export const startMafiaVote = (roomId: string) =>
    restartConversation(roomId, () => startVote(roomId));

/** 사람(나)의 소개 건너뛰기·밤 행동·투표·최후의 한마디를 기록하고 게임을 이어간다 */
export function submitMafiaAction(roomId: string, target: string | null) {
    if (submitUserAction(roomId, target)) startConversation(roomId);
}

/** 게임을 중단하고 역할을 공개한다 */
export function stopMafiaGame(roomId: string) {
    stopConversation(roomId);
    abandonGame(roomId);
}
