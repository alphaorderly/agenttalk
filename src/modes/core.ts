import type {
    Agent,
    Message,
    PendingMessage,
    PresetRoom,
    Room,
    RoomMode,
} from '@/types/chat';

/**
 * 방 모드(일반 대화, 마피아 게임 …)의 공통 계약.
 *
 * 공통 코드(대화 엔진, 프롬프트, 화면)는 모드를 직접 알지 않고 이 훅들만 부른다.
 * 새 모드를 추가하려면:
 * 1. `@/types/chat`의 RoomMode에 id를 더한다. 방 설정이 있으면 ModeSettings(room[id]),
 *    진행 상태가 있으면 ModeStates(room.modeState[id])에 더한다.
 * 2. `src/modes/<id>/`에 규칙(defineMode), 엔진(ModeEngine), 화면(ModeUi)을 만든다.
 * 3. `modes/index.ts`(규칙), `modes/engines.ts`(엔진), `modes/ui.ts`(화면, 설정 칸) 레지스트리에 등록한다.
 *    규칙·엔진·화면 레지스트리는 모든 RoomMode를 요구하므로 빠뜨리면 컴파일 오류가 난다.
 * 4. 서버 AI 작업이 필요하면 `server/modes/<id>/`에 defineModeAction으로 만들어 `server/modes/index.ts`에 등록하고,
 *    클라이언트에서는 runtime의 runModeAction(id, 작업 이름, 요청)으로 부른다.
 *
 * 모드 코드는 앱 상태와 서버에 `modes/runtime.ts`로만 닿고(진행 상태 읽기·쓰기, 진행 알림 등),
 * 대화 엔진을 멈추거나 다시 시작하는 화면 동작은 `modes/controls.ts`를 쓴다. eslint가 다른 경로를 막는다.
 * 비워 둔 훅은 일반 대화와 똑같이 동작한다.
 */

/** 사람(나)의 입력창 상태 */
export type ComposerPolicy =
    | { allowed: false; reason: string }
    | {
          allowed: true;
          /** 있으면 내 메시지를 이 사람들에게만 보낸다 (예: 마피아끼리 밤 대화) */
          to?: string[];
          /** to가 있을 때 입력창 위에 보여줄 안내 */
          toLabel?: string;
          placeholder?: string;
          /** 투표 만들기·자동 반응 전환 버튼을 보여준다 */
          tools: boolean;
      };

/** 순수 규칙: 상태를 바꾸지 않고 방 상태만 보고 답한다 */
export interface ModeDefinition {
    id: RoomMode;
    /** 방에서 소개 공개 여부를 따로 정하지 않았을 때의 기본값 */
    defaultShareIntroductions: boolean;
    /** 에이전트 자동 생성에 항상 넘길 모드별 지침. 사용자 생성 규칙보다 우선한다 */
    castingContext: string | null;
    /** 귓속말(@@)을 쓸 수 있는지 */
    whispers: boolean;
    /**
     * 귓속말 대신 받는 사람이 정해진 메시지를 쓰는 모드의 표시 (예: 마피아끼리 밤 대화).
     * badge는 말풍선 위, log는 에이전트가 보는 로그에 붙는다.
     */
    privateChannel?: { badge: string; className: string; log: string };

    /** 모드가 진행 중이라 대화 엔진 대신 모드가 흐름을 쥐고 있는지 (예: 게임 중) */
    isLive(room: Room): boolean;
    /** 진행 중일 때 ▶ 버튼 이름 */
    liveRunLabel: string;

    /* ---- 사람(나)이 무엇을 보는지 ---- */
    /** 모든 비밀(다른 사람의 비공개 메시지, 방 메모)을 볼 수 있는지 */
    userSeesAll(room: Room): boolean;
    userCanSee(room: Room, m: Message): boolean;
    /** 에이전트가 쓰고 있는 말풍선(입력 중 표시)을 보여도 되는지 */
    userSeesPending(
        room: Room,
        pending: Pick<PendingMessage, 'to' | 'silent'>
    ): boolean;
    composer(room: Room): ComposerPolicy;
    /** userSeesAll이 false일 때 내보내기 전에 묻는 말 */
    exportWarning: string;

    /* ---- 에이전트 프롬프트 ---- */
    /** 멤버 목록에서 사람(나)을 소개하는 말 */
    userMemberLabel(room: Room): string;
    /** 에이전트 instructions에 넣는 모드 규칙. 진행 중에는 바뀌지 않아 캐시할 수 있게 한다 */
    instructions(room: Room, agent: Agent, userName: string): string | null;
    /** 채팅 로그 아래에 붙는 지금 상황 (매 차례 바뀐다) */
    turnContext(room: Room, agent: Agent): string[];
    /** 에이전트·진행 모델이 보는 로그의 시작 시각. 이보다 앞선 메시지는 넘기지 않는다 (예: 이전 판) */
    historyStart(room: Room): number;

    /* ---- 진행 모델 ---- */
    /** 진행 모델이 다음 화자로 고를 수 있는 에이전트 */
    speakingAgents(room: Room): Agent[];
    /** 진행 모델에 넘기는 주제 */
    moderatorTopic(room: Room): string;
    /** 진행 모델에게 보이지 않을 메시지 */
    hideFromModerator(room: Room, m: Message): boolean;

    /* ---- 내보내기 ---- */
    /** 텍스트 내보내기에서 멤버 목록 뒤에 붙는 줄 */
    exportLines(room: Room): string[];
    /** 프리셋 복제 시 모드 설정에 저장된 에이전트 ID 참조를 새 ID로 바꾼다 */
    remapAgentIds?(
        room: PresetRoom,
        ids: ReadonlyMap<string, string>
    ): PresetRoom;
}

const CHAT_DEFAULTS: Omit<ModeDefinition, 'id'> = {
    defaultShareIntroductions: true,
    castingContext: null,
    whispers: true,
    isLive: () => false,
    liveRunLabel: '진행',
    userSeesAll: () => true,
    userCanSee: () => true,
    userSeesPending: () => true,
    composer: () => ({ allowed: true, tools: true }),
    exportWarning: '지금 내게 보이지 않는 대화가 파일에 담겨요. 계속할까요?',
    userMemberLabel: () => '사람. 이 방의 방장',
    instructions: () => null,
    turnContext: () => [],
    historyStart: () => 0,
    speakingAgents: (room) => room.agents,
    moderatorTopic: (room) => room.topic,
    hideFromModerator: () => false,
    exportLines: () => [],
};

/** 비워 둔 훅은 일반 대화의 동작으로 채운다 */
export const defineMode = (
    def: Pick<ModeDefinition, 'id'> & Partial<ModeDefinition>
): ModeDefinition => ({ ...CHAT_DEFAULTS, ...def });

/* ---------------- 대화 엔진 훅 ---------------- */

/** 모드가 진행하는 차례에서 에이전트가 고르는 것 */
export interface ModeChoice {
    question: string;
    options: string[];
    /** 고른 뒤 쓰는 말을 누가 보는지 안내 (예: "같은 마피아만 본다") */
    after: string;
    /**
     * 고른 선택지 인덱스(고르지 않았으면 null)와 선택 표시를 뺀 나머지 글.
     * silent 차례에서는 이 글이 말풍선으로 나가지 않으므로 모드가 따로 기록할 수 있다
     */
    onPick: (index: number | null, note: string) => void;
}

/** 모드가 에이전트에게 맡기는 한 차례 */
export interface ModeTurn {
    note: string;
    canPass: boolean;
    /** 모든 말풍선을 이 사람들에게만 보낸다 (예: 마피아끼리 밤 대화) */
    forceTo?: string[];
    /** 고르기만 하고 아무 말풍선도 보내지 않는다 (예: 의사·경찰의 밤 행동) */
    silent?: boolean;
    choice?: ModeChoice;
    /** 말풍선이 기록에 저장된 직후 호출한다. 단계별 완료 상태를 같은 차례 안에 저장할 때 쓴다 */
    onMessage?: (message: Message) => void;
}

/** 모드가 쓰는 대화 엔진 기능. 모드가 엔진을 직접 import하지 않도록 넘겨준다 */
export interface ModeIO {
    speak: (
        room: Room,
        agent: Agent,
        turn: ModeTurn,
        signal: AbortSignal
    ) => Promise<'spoke' | 'passed' | 'failed'>;
    /** 헤더에 보일 진행 상황 */
    status: (text: string) => void;
    /** 멈춘 이유 */
    idle: (text: string) => void;
    sleep: (ms: number, signal: AbortSignal) => Promise<void>;
    /** 단계가 바뀌면 자동 진행 안전 한도를 다시 센다 */
    resetBudget: () => void;
}

/**
 * 대화 엔진에 끼어드는 훅. 모두 비워 두면 진행 모델이 대화를 이끄는 일반 대화가 된다.
 * 결과로 undefined를 돌려주면 엔진의 기본 동작을 따른다.
 */
export interface ModeEngine {
    /**
     * 사람(나)이 메시지를 보낸 직후. 'react'면 에이전트가 반응하고,
     * 'ignore'면 아무도 반응하지 않는다.
     */
    onUserMessage?(roomId: string): 'react' | 'ignore' | undefined;
    /** ▶로 직접 이어갈 때 */
    onResume?(roomId: string): void;
    /** 한 차례를 모드가 직접 진행한다 (진행 모델 대신) */
    step?(
        room: Room,
        signal: AbortSignal,
        io: ModeIO
    ): Promise<'next' | 'stop'> | undefined;
    /** 진행 모델이 고른 에이전트가 실제로 말한 직후 (패스는 세지 않는다) */
    onTalk?(roomId: string): void;
    /** 진행 모델 대화가 잦아들었을 때 */
    onQuiet?(roomId: string, io: ModeIO): 'next' | 'stop' | undefined;
}
