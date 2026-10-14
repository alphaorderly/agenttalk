import type { ModeUi } from '../uiTypes';
import MafiaBar from './MafiaBar';
import MafiaSenderTag from './MafiaSenderTag';
import { noticeOf } from './visuals';

export const mafiaUi: ModeUi = {
    emoji: '🕵️',
    label: '마피아 게임',
    hint: '자기소개 후 밤·토론·투표를 진행해요',
    Bar: MafiaBar,
    SenderTag: MafiaSenderTag,
    noticeStyle: noticeOf,
    topicLabel: '세계관 / 분위기',
    topicPlaceholder:
        '예: 눈 덮인 산장에 갇힌 사람들. 게임 규칙은 프로그램이 따로 알려 줘요',
    editorHint:
        '첫 번째 밤 전에 참가자들이 차례로 짧게 자기소개해요. 역할은 자동으로 무작위 배분하거나 참가자별로 수동 지정할 수 있어요. 밤 행동, 투표, 처형, 승패는 프로그램이 정하고, 낮 토론에서는 진행 모델(설정 → AI 도우미)이 살아 있는 사람 중 다음에 누가 말할지 정해요.',
    starter: {
        name: '마피아 게임',
        topic: '조용한 산골 마을에 마피아가 숨어들었다. 마을 사람들은 낮마다 마을회관 단톡방에 모여 누가 마피아인지 토론하고, 투표로 한 명을 처형한다.',
        castingRules:
            '마피아 게임 참가자를 만든다. 첫 자기소개에서 구별되도록 마을에서의 처지, 직업, 경험과 성격을 다양하게 만든다. 게임 역할과 같은 편은 방의 역할 배분 설정으로 정하므로 캐릭터 생성에서 미리 정하지 않는다. 의심 많은 사람, 순진한 사람, 논리적인 사람, 감정적인 사람, 말 많은 사람처럼 말투와 토론 성향이 겹치지 않게 한다.',
    },
};
