import { atom, getDefaultStore } from 'jotai';
import { atomWithStorage } from 'jotai/utils';
import { DEFAULT_IMAGE_MODEL } from '@shared/images';
import type { ReasoningLevel, TalkLevel } from '@shared/providers';
import type { RoomStatusSummary } from '@shared/room-status';
import type {
    Agent,
    AgentImageGen,
    Message,
    PendingMessage,
    PollVote,
    Room,
} from '@/types/chat';
import { uid } from '@utils/id/id';

export const AGENT_COLORS = [
    '#ffd6a5',
    '#caffbf',
    '#9bf6ff',
    '#bdb2ff',
    '#ffc6ff',
    '#fdffb6',
    '#a0c4ff',
    '#ffadad',
];
export const AGENT_EMOJIS = [
    '🐶',
    '🐱',
    '🦊',
    '🐻',
    '🐼',
    '🐯',
    '🐰',
    '🐸',
    '🐵',
    '🦁',
];

export function newAgent(
    index: number,
    overrides: Partial<Agent> = {}
): Agent & {
    style: string;
    talk: TalkLevel;
    secret: string;
    relations: string;
    feeling: string;
    memories: string[];
    reasoning: ReasoningLevel | null;
    imageGen: AgentImageGen;
} {
    return {
        id: uid(),
        name: `에이전트${index + 1}`,
        emoji: AGENT_EMOJIS[index % AGENT_EMOJIS.length],
        color: AGENT_COLORS[index % AGENT_COLORS.length],
        persona: '',
        style: '',
        talk: 'normal',
        secret: '',
        relations: '',
        feeling: '',
        memories: [],
        profileId: null,
        model: '',
        reasoning: null,
        imageGen: { enabled: false, quality: 'low' },
        ...overrides,
    };
}

/** 처음 실행했을 때 보여줄 예시 방 */
export function sampleRoom(): Room {
    return {
        id: uid(),
        name: '점심 뭐 먹지',
        topic: '팀 점심 메뉴를 정해야 한다. 각자 의견을 내고 결론을 내 보자.',
        profileId: null,
        model: '',
        reasoning: null,
        updatedAt: Date.now(),
        messages: [],
        agents: [
            newAgent(0, {
                name: '철수',
                persona:
                    '낙천적이고 에너지 넘치는 백엔드 개발자. 새로운 걸 해보자고 자주 제안한다. 반말, 이모티콘을 가끔 쓴다.',
            }),
            newAgent(1, {
                name: '영희',
                emoji: '🐱',
                color: AGENT_COLORS[2],
                persona:
                    '꼼꼼하고 현실적인 PM. 예산, 일정, 리스크를 항상 따진다. 존댓말과 반말을 섞는다.',
            }),
            newAgent(2, {
                name: '민수',
                emoji: '🦊',
                color: AGENT_COLORS[3],
                persona:
                    '약간 시니컬하지만 센스 있는 디자이너. 짧고 위트 있게 말하며 가끔 딴지를 건다.',
            }),
        ],
    };
}

const persist = { getOnInit: true } as const;

/**
 * 채팅방과 대화 내용. 서버의 SQLite(data/agenttalk.db)에서 불러오고,
 * 바뀐 내용은 services/persistence가 서버에 저장한다.
 */
export const roomsAtom = atom<Room[]>([]);
/** 서버에서 방 목록을 불러온 상태 */
export const roomsLoadAtom = atom<
    | { state: 'loading' }
    | { state: 'ready' }
    | { state: 'error'; error: string }
>({ state: 'loading' });
export const currentRoomIdAtom = atomWithStorage<string | null>(
    'agenttalk.currentRoom',
    null,
    undefined,
    persist
);
export const userNameAtom = atomWithStorage(
    'agenttalk.userName',
    '나',
    undefined,
    persist
);

/** 내 지역 (예: "부산"). 에이전트의 시간/장소 감각과 웹 검색 지역 힌트에 쓴다 */
export const userLocationAtom = atomWithStorage(
    'agenttalk.userLocation',
    '',
    undefined,
    persist
);

/** 보조 AI 작업에 쓸 프로필/모델/effort. null/'' 이면 기본 프로필·기본 모델·프로필 effort */
export interface ModelChoice {
    profileId: string | null;
    model: string;
    /** null(또는 이전 데이터의 undefined)이면 프로필 기본 effort */
    reasoning?: ReasoningLevel | null;
}
/** AI 도우미: 에이전트 설명 다듬기 */
export const assistantSettingsAtom = atomWithStorage<ModelChoice>(
    'agenttalk.assistant',
    { profileId: null, model: '', reasoning: null },
    undefined,
    persist
);

/** 방 진행(관리) 모델: 다음 발언자·텀·대화 종료를 정한다. 빠르고 저렴한 모델 추천 */
export const moderatorSettingsAtom = atomWithStorage<ModelChoice>(
    'agenttalk.moderator',
    { profileId: null, model: '', reasoning: null },
    undefined,
    persist
);

/** 전체 비밀을 읽는 인간 전용 상태 요약 모델. 다른 AI 작업과 분리한다. */
export const roomStatusSettingsAtom = atomWithStorage<ModelChoice>(
    'agenttalk.roomStatusModel',
    { profileId: null, model: '', reasoning: null },
    undefined,
    persist
);

/** 이미지 생성에 쓸 OpenAI 프로필과 모델. profileId가 null이면 OpenAI 프로필을 자동으로 고른다 */
export interface ImageSettings {
    profileId: string | null;
    model: string;
}
export const imageSettingsAtom = atomWithStorage<ImageSettings>(
    'agenttalk.imageSettings',
    { profileId: null, model: DEFAULT_IMAGE_MODEL },
    undefined,
    persist
);

/** `${roomId}:${agentId}` → 진행 중인 얼굴/표정 생성 설명 (예: "얼굴 만드는 중") */
export const faceJobsAtom = atom<Record<string, string>>({});

export interface OwnerRoomStatus {
    summary: RoomStatusSummary;
    via: string;
    updatedAt: number;
    /** 공개 설정·비밀·요약 모델의 변경을 감지하는 캐시 키 */
    inputKey: string;
    /** 프로필 로딩 중에도 로컬 설정 변경을 확인한다. 이전 캐시는 undefined. */
    localInputKey?: string;
    /** 순서대로 요약한 메시지 ID. 긴 메시지는 조각 ID로 저장한다. */
    messageIds: string[];
    messageSignature: string;
}

/** 인간 전용 요약은 Room/messages와 별도 보존한다 (서버 SQLite의 별도 테이블). */
export const ownerStatusesAtom = atom<Record<string, OwnerRoomStatus>>({});
export const roomStatusRuntimeAtom = atom<
    Record<string, { loading: boolean; error?: string }>
>({});

export const currentRoomAtom = atom(
    (get) => get(roomsAtom).find((r) => r.id === get(currentRoomIdAtom)) ?? null
);

export interface RunState {
    /** 이번 실행에서 에이전트가 말한 횟수 */
    turns: number;
    /** 헤더에 보여줄 진행 상황 (예: "영희 차례 · 질문 받음") */
    status: string;
}
/** roomId → 대화 진행 상태 (실행 중인 방만 존재) */
export const runningAtom = atom<Record<string, RunState>>({});
/** roomId → 대화가 멈춘 이유 (진행 모델이 마무리했거나 한도에 도달) */
export const idleNoteAtom = atom<Record<string, string>>({});
/** roomId → 스트리밍 중인 메시지 */
export const pendingAtom = atom<Record<string, PendingMessage>>({});

export type SettingsSection =
    | 'general'
    | 'profiles'
    | 'assistants'
    | 'images'
    | 'presets';
export type ModalState =
    | { type: 'settings'; section?: SettingsSection }
    | { type: 'room'; roomId: string | null }
    | null;
export const modalAtom = atom<ModalState>(null);

/* ---------------- 스토어 조작 헬퍼 (React 밖의 대화 엔진에서도 사용) ---------------- */

export const store = getDefaultStore();

export function updateRoom(roomId: string, fn: (room: Room) => Room) {
    store.set(roomsAtom, (rooms) =>
        rooms.map((r) => (r.id === roomId ? fn(r) : r))
    );
}

export function createRoom(
    data: Omit<Room, 'id' | 'messages' | 'updatedAt'>
): Room {
    const room: Room = {
        id: uid(),
        messages: [],
        updatedAt: Date.now(),
        ...data,
    };
    store.set(roomsAtom, (rooms) => [...rooms, room]);
    return room;
}

/** 투표 메시지에 한 표를 기록한다. 같은 사람이 다시 투표하면 바꾼다 */
export function recordVote(roomId: string, messageId: string, vote: PollVote) {
    updateRoom(roomId, (r) => ({
        ...r,
        messages: r.messages.map((m) =>
            m.id === messageId && m.poll
                ? {
                      ...m,
                      poll: {
                          ...m.poll,
                          votes: [
                              ...m.poll.votes.filter(
                                  (v) => v.voter !== vote.voter
                              ),
                              vote,
                          ],
                      },
                  }
                : m
        ),
    }));
}

export function appendMessage(
    roomId: string,
    msg: Omit<Message, 'id' | 'ts'> & Partial<Pick<Message, 'id' | 'ts'>>
) {
    const m: Message = { id: uid(), ts: Date.now(), ...msg };
    updateRoom(roomId, (r) => ({
        ...r,
        messages: [...r.messages, m],
        updatedAt: m.ts,
    }));
    return m;
}
