import type { ImageQuality, ImageSize } from '@shared/images';
import type { ReasoningLevel, SourceLink, TalkLevel } from '@shared/providers';
import type { MafiaGame, MafiaSetup } from '@/modes/mafia/types';

/** 에이전트가 직접 프롬프트를 써서 이미지를 보낼 수 있는지 */
export interface AgentImageGen {
    enabled: boolean;
    quality: ImageQuality;
}

/** 방의 표정 기능: 에이전트 아이콘을 생성한 얼굴 이미지로 바꾸고 대화에 따라 표정을 바꾼다 */
export interface RoomExpressions {
    enabled: boolean;
    quality: ImageQuality;
    size: ImageSize;
    /** 얼굴 그림체 (빈 문자열이면 기본 그림체) */
    style: string;
}

export interface Agent {
    id: string;
    name: string;
    emoji: string;
    color: string;
    /** 소개: 성격, 역할, 입장, 취향. 방에서 소개를 공개하면 다른 멤버도 첫 문장을 본다 */
    persona: string;
    /**
     * 말투·행동: 말투, 말 길이, 반응 성향, 말버릇. 이 에이전트의 프롬프트에만 들어간다.
     * 비어 있으면(이전 데이터의 undefined 포함) 기본 단톡방 말투를 쓴다.
     */
    style?: string;
    /** 말수. 진행 모델이 얼마나 자주 고를지 참고한다. undefined(이전 데이터)는 보통 */
    talk?: TalkLevel;
    /**
     * 이 에이전트만 아는 비공개 정보(게임 속 역할, 숨긴 목적, 다른 멤버와의 관계 등).
     * 이 에이전트의 프롬프트에만 들어가고 진행 모델·AI 도우미·다른 멤버에게는 넘기지 않는다.
     * undefined(이전 데이터)는 빈 문자열.
     */
    secret?: string;
    /**
     * 다른 멤버와의 관계와 요즘 근황·기분. 이 에이전트의 프롬프트와 캐스팅에만 들어간다.
     * undefined(이전 데이터)는 빈 문자열.
     */
    relations?: string;
    /** 지금 감정. 방장이 정할 수 있고, 대화 중에는 이 에이전트가 [감정:…]으로 고친다. 이 에이전트의 프롬프트에만 들어간다 */
    feeling?: string;
    /** 이 에이전트만 아는 기억 (오래된 것부터). 대화 중 [기억:…]으로 쌓이고 이 에이전트의 프롬프트에만 들어간다 */
    memories?: string[];
    /** null 이면 방 프로필 → 기본 프로필 순으로 사용 */
    profileId: string | null;
    /** 빈 문자열이면 프로필의 기본 모델 */
    model: string;
    /** null(또는 이전 데이터의 undefined)이면 방 설정 → 프로필 기본 effort */
    reasoning?: ReasoningLevel | null;
    /** undefined(이전 데이터)는 꺼짐 */
    imageGen?: AgentImageGen;
    /** 표정 기능의 기본 얼굴 이미지 ID. 표정 이미지를 만들 때 참고해 같은 얼굴을 유지한다 */
    portrait?: string;
    /** 표정 → 이미지 ID. 한 번 만든 표정은 다시 쓴다 */
    faces?: Record<string, string>;
    /** 현재 표정 (EXPRESSIONS의 키) */
    expression?: string;
}

/** 투표 한 표. 에이전트가 나가도 보이도록 이름도 저장한다 */
export interface PollVote {
    /** agent.id */
    voter: string;
    name: string;
    /** options의 인덱스 (0부터) */
    choice: number;
}

/** 방장이 올린 투표. 에이전트가 각자 하나를 고른다 */
export interface Poll {
    question: string;
    options: string[];
    votes: PollVote[];
}

export interface Message {
    id: string;
    /** 'me' | 'system' | agent.id */
    sender: string;
    /** 에이전트가 삭제된 뒤에도 이름을 보여주기 위해 저장 */
    senderName?: string;
    text: string;
    ts: number;
    /**
     * 귓속말 받는 사람('me' | agent.id). 있으면 보낸 사람과 받는 사람만 볼 수 있다
     * (사용자는 모든 귓속말을 본다). 없으면 모두에게 보이는 메시지.
     */
    to?: string[];
    error?: boolean;
    /** 응답한 프로바이더/모델 (예: "OpenAI · gpt-5-mini") */
    via?: string;
    /** 웹 검색으로 공유한 링크 (링크 카드로 표시) */
    sources?: SourceLink[];
    /** 보낼 때의 얼굴 이미지 ID (표정 기능). 나중에 표정이 바뀌어도 이 말풍선의 얼굴은 유지된다 */
    face?: string;
    /** 이 발언에서 바뀐 보낸 사람의 감정 (감정 변화 기록) */
    feeling?: string;
    /** 에이전트가 만들어 보낸 이미지 */
    image?: { id: string; prompt: string };
    /** 방장이 올린 투표 (text에는 질문이 들어간다) */
    poll?: Poll;
    /** 모드의 진행 알림 (sender 'system', 예: 마피아 게임). 오류 알림과 달리 에이전트도 로그에서 본다 */
    notice?: boolean;
}

/** 방 종류. undefined(이전 데이터)는 일반 대화. 모드별 동작은 src/modes에 있다 */
export type RoomMode = 'chat' | 'mafia';

/**
 * 모드별 방 설정. 키는 모드 id이고 값은 room[모드 id]에 저장된다 (예: room.mafia).
 * 설정이 필요한 모드를 추가하면 여기에 한 줄 더한다. 모드 id는 방의 다른 필드 이름과 겹칠 수 없다.
 */
export interface ModeSettings {
    mafia: MafiaSetup;
}

/**
 * 모드가 진행 중에 쌓는 상태. 키는 모드 id이고 값은 room.modeState[모드 id]에 저장된다.
 * 프리셋에는 넣지 않고, 방 설정을 고쳐도 그대로 둔다. 상태가 필요한 모드를 추가하면 여기에 한 줄 더한다.
 */
export interface ModeStates {
    /** 마피아 모드에서 시작한 게임 (끝난 게임도 다음 판을 시작할 때까지 남는다) */
    mafia: MafiaGame;
}

/** 모드와 관계없는 방 필드 */
interface BaseRoom {
    id: string;
    name: string;
    topic: string;
    /** 에이전트 자동 생성 때 캐스팅 모델이 따를 규칙. undefined(이전 데이터)는 없음 */
    castingRules?: string;
    /** null 이면 기본 프로필 */
    profileId: string | null;
    /** 방 기본 모델. 빈 문자열(또는 이전 데이터의 undefined)이면 프로필의 기본 모델 */
    model?: string;
    /** null(또는 undefined)이면 프로필 기본 effort */
    reasoning?: ReasoningLevel | null;
    /**
     * false 면 내가 말해도 에이전트가 자동으로 반응하지 않고, ▶나 @이름으로 부를 때까지 기다린다.
     * undefined(이전 데이터)는 true.
     */
    autoReply?: boolean;
    /** undefined(이전 데이터)는 꺼짐 */
    expressions?: RoomExpressions;
    /** undefined(이전 데이터)는 일반 대화 */
    mode?: RoomMode;
    /** 다른 멤버에게 소개의 첫 문장을 공개할지. undefined는 모드 기본값(일반 공개, 마피아 비공개) */
    shareIntroductions?: boolean;
    agents: Agent[];
    messages: Message[];
    updatedAt: number;
    /** 모드 진행 상태 (ModeStates) */
    modeState?: Partial<ModeStates>;
}

/* 모드 설정·상태의 키가 모드 id가 아니거나, 모드 id가 방 필드와 겹치면 여기서 컴파일 오류가 난다 */
type AssertNever<T extends never> = T;
export type _ModeKeysAreModeIds = AssertNever<
    Exclude<keyof ModeSettings | keyof ModeStates, RoomMode>
>;
export type _ModeIdsDoNotClash = AssertNever<
    Extract<keyof ModeSettings, keyof BaseRoom>
>;

export interface Room extends BaseRoom, Partial<ModeSettings> {}

/** 프리셋에 담기는 방 설정 (대화 기록·방 ID 없음) */
export type PresetRoom = Omit<Room, 'id' | 'messages' | 'updatedAt'>;

/** 스트리밍 중인 (아직 확정되지 않은) 메시지 */
export interface PendingMessage {
    id: string;
    agentId: string;
    text: string;
    via?: string;
    /** 입력 중 표시 옆에 보여줄 상태 (예: 검색 중) */
    status?: string;
    face?: string;
    /** 모드가 보이지 않게 진행하는 차례: 받는 사람(예: 마피아끼리 대화), 또는 아무에게도 보내지 않음 */
    to?: string[];
    silent?: boolean;
}
