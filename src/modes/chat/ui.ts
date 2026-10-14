import type { ModeUi } from '../uiTypes';

export const chatUi: ModeUi = {
    emoji: '💬',
    label: '일반 대화',
    hint: '진행 모델이 흐름을 보고 누가 말할지 정해요',
    topicLabel: '대화 주제 / 상황',
    topicPlaceholder:
        '예: 주말 워크숍 장소 정하기. 짧게 적고 ✨를 누르면 상황·목표·조건을 자세히 써 줘요',
    editorHint:
        '발언 순서와 횟수는 정하지 않아요. 진행 모델(설정 → AI 도우미)이 대화 흐름을 보고 다음에 누가 말할지, 언제 쉬고 언제 멈출지 실제 단톡방처럼 정해요.',
};
