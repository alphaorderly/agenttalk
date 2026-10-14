export type MafiaRole = 'mafia' | 'doctor' | 'police' | 'citizen';

/** 마피아 게임에서 사람(나)의 자리 */
export type MafiaUserRole = 'observer' | 'host' | 'player';

/** 마피아 게임 설정. 게임을 시작할 때 이 값으로 역할을 나눈다 */
export interface MafiaSetup {
    userRole: MafiaUserRole;
    /** undefined(이전 데이터)는 자동 무작위 배분 */
    roleAssignment?: 'random' | 'manual';
    /** 수동 배분: 참가자 id(agent.id 또는 'me')별 역할 */
    assignedRoles?: Record<string, MafiaRole>;
    /** 마피아 수 */
    mafia: number;
    /** 의사 수. 이전 데이터는 boolean일 수 있어 읽을 때 +로 센다 */
    doctor: number;
    /** 경찰 수. 이전 데이터는 boolean일 수 있어 읽을 때 +로 센다 */
    police: number;
    /** 죽은 사람의 역할을 공개한다 */
    reveal: boolean;
    /** 낮 토론에서 에이전트가 말하는 최대 횟수 (내가 말하면 다시 센다) */
    dayTalk: number;
    /** 최후의 한마디 뒤 처형 찬반 투표를 한다. undefined(이전 데이터)는 켠 것으로 본다 */
    verdict?: boolean;
}

export interface MafiaPlayer {
    /** agent.id 또는 'me' */
    id: string;
    /** 에이전트가 나가도 보이도록 저장한다 */
    name: string;
    role: MafiaRole;
    alive: boolean;
    /** 죽은 날과 이유 */
    death?: { day: number; cause: 'killed' | 'executed' };
}

export type MafiaPhase =
    | 'introduction'
    | 'night'
    | 'day'
    | 'vote'
    | 'lastWords'
    /** 최후의 한마디 뒤 처형할지 찬반 투표 */
    | 'verdict'
    /** 승패가 난 뒤 상황 설정에 맞춘 엔딩 장면을 진행한다 */
    | 'epilogue'
    | 'ended';

/** 밤의 진행. 단계마다 저장해서 멈췄다 이어가도 같은 자리에서 시작한다 */
export interface MafiaNight {
    step: 'chat' | 'kill' | 'save' | 'check' | 'done';
    /** 이번 밤 마피아 대화에서 이미 말한 에이전트 */
    chatted: string[];
    /** 마피아 에이전트가 고른 대상 (agent.id → 대상 id) */
    picks: Record<string, string>;
    kill?: string;
    /** 의사별로 지킨 대상 (의사 id → 대상 id) */
    saves?: Record<string, string>;
    /** 경찰별로 조사한 대상 (경찰 id → 대상 id) */
    inspections?: Record<string, string>;
    /** 이전 버전(의사·경찰이 한 명)에서 저장된 밤의 선택 */
    save?: string;
    check?: string;
}

/** 엔딩의 한 장면. 사람은 참가자 id('me' 포함)로 저장한다 */
export type MafiaEndingBeat =
    /** gone: 이 서술로 이야기에서 빠져 더 말할 수 없게 된 사람 */
    | { type: 'narration'; text: string; gone?: string[] }
    | { type: 'line'; speaker: string; direction: string }
    | { type: 'talk'; speakers: string[]; turns: number; direction: string }
    /** 한 인물이 직접 정하는 행동. 고른 뒤에는 연출 모델이 그 결과부터 다시 짠다 */
    | {
          type: 'decision';
          speaker: string;
          direction: string;
          options: string[];
      };

/** 엔딩 진행. 장면마다 저장해서 멈췄다 이어가도 같은 장면에서 시작한다 */
export interface MafiaEpilogue {
    /** 연출 모델이 짠 장면. 아직 짜지 않았으면 undefined */
    beats?: MafiaEndingBeat[];
    /** 지금 진행할 장면 번호 */
    at: number;
    /** 지금 자유 대화 장면에서 말한 횟수 */
    talk: number;
    /** 연출 모델에게 장면을 받은 횟수 (인물의 결정마다 이어서 다시 받는다) */
    rounds?: number;
    /**
     * 엔딩 서술로 이야기에서 빠진 사람. 게임 결과(players)는 그대로 두고 따로 센다.
     * 엔딩의 다음 장면과 게임이 끝난 뒤의 대화에서 말하지 않는다
     */
    gone?: string[];
    /** 게임이 끝난 뒤 이어지는 대화에 누가 낄 수 있는지 (상황 설정에 따라 연출 모델이 정한다) */
    after?: 'all' | 'alive';
}

/** 진행 중인(또는 끝난) 마피아 게임. 진행 판단은 모두 이 상태로 한다 */
export interface MafiaGame {
    /** 게임을 시작할 때의 설정 (게임 중에 방 설정을 바꿔도 이번 판은 그대로) */
    userRole: MafiaUserRole;
    reveal: boolean;
    dayTalk: number;
    phase: MafiaPhase;
    /** 몇 번째 밤/낮인지 (첫 밤이 1) */
    day: number;
    players: MafiaPlayer[];
    /** 자기소개를 마친 참가자. 이전에 저장된 게임에는 없을 수 있다 */
    introduced?: string[];
    night: MafiaNight;
    /** 이번 투표: 투표한 사람 id → 대상 id (null은 기권) */
    votes: Record<string, string | null>;
    /** 투표로 가장 많은 표를 받아 최후의 한마디를 할 사람 */
    accused?: string;
    lastSaid?: boolean;
    /** 최후의 한마디 뒤 처형 찬반 투표를 하는지. undefined(이전에 저장된 게임)는 하지 않는다 */
    verdict?: boolean;
    /** 이번 찬반 투표: 투표한 사람 id → 처형 찬성 여부 (null은 고르지 않음 → 반대로 센다)와 한마디 */
    verdicts?: Record<string, { guilty: boolean | null; note: string }>;
    /** 이번 낮에 에이전트가 말한 횟수 */
    talk: number;
    /** 사회자 모드: 다음 단계로 넘어가기 전에 ▶를 기다린다 */
    hold: boolean;
    /** 경찰 조사 결과 (경찰 본인과 다 보는 사람만 안다) */
    /** by는 조사한 경찰 id. 이전에 저장된 결과에는 없다 */
    checks: { day: number; target: string; mafia: boolean; by?: string }[];
    winner?: 'mafia' | 'citizen';
    /** 승패가 난 뒤의 엔딩 (이전에 저장된 게임에는 없다) */
    epilogue?: MafiaEpilogue;
    /** 이번 판을 시작한 시각. 이보다 앞선 메시지(이전 판)는 에이전트에게 넘기지 않는다 */
    startedAt?: number;
}
