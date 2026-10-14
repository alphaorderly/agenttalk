/**
 * 모드 화면(상황판 버튼 등)이 대화 엔진을 멈추고 다시 시작할 때 쓰는 통로.
 * 대화 엔진이 모드 엔진을 import하므로, 모드 엔진(engine.ts)에서는 쓰지 않는다 (순환 참조).
 */
export {
    restartConversation,
    startConversation,
    stopConversation,
} from '@services/conversation';
