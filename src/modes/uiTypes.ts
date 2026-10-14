import type { LucideIcon } from 'lucide-react';
import type { ComponentType } from 'react';
import type { z } from 'zod';
import type { Agent, ModeSettings, Room } from '@/types/chat';

/** 방 설정 화면의 모드별 설정 칸. 값은 room[모드 id]에 저장된다 */
export interface ModeSettingsFieldsProps<S> {
    value: S;
    onChange: (next: S) => void;
    agents: readonly Pick<Agent, 'id' | 'name'>[];
    /** 저장할 때 나온 검증 오류 */
    error?: string;
    /** 이 방에서 모드가 진행 중이면 true (바꾼 설정은 다음 판부터) */
    live: boolean;
}

/** 모드별 방 설정 (ModeSettings에 등록한 모드만) */
export interface ModeSettingsEditor<S> {
    /** 입력과 출력이 같아야 폼(react-hook-form)에 그대로 쓸 수 있다 */
    schema: z.ZodType<S, S>;
    defaults: (agentCount: number) => S;
    /** 저장된 설정을 지금 형식으로 맞춘다 (이전 버전 데이터) */
    load?: (stored: S) => S;
    /** 이 설정으로 시작할 수 없으면 이유 (저장할 때 검사한다) */
    problem?: (
        value: S,
        agents: readonly Pick<Agent, 'id' | 'name'>[]
    ) => string | null;
    /** 새 방에서 이 모드를 고를 때 설정을 지금 멤버 수에 맞춘다 */
    fit?: (value: S, agentCount: number) => S;
    Fields: ComponentType<ModeSettingsFieldsProps<S>>;
}

export type ModeSettingsEditors = {
    [K in keyof ModeSettings]: ModeSettingsEditor<ModeSettings[K]>;
};

/** 모드의 화면 */
export interface ModeUi {
    emoji: string;
    label: string;
    /** 방 종류를 고를 때 보이는 한 줄 설명 */
    hint: string;
    /** 채팅창 위에 붙는 상황판 (예: 마피아 게임 진행) */
    Bar?: ComponentType<{ room: Room }>;
    /** 말풍선 위 이름 옆에 붙는 표시 (예: 마피아 게임에서 내가 아는 역할) */
    SenderTag?: ComponentType<{ room: Room; senderId: string }>;
    /** 진행 알림(notice 시스템 메시지)의 아이콘, 색, 이모지를 뗀 본문. 없으면 글자 그대로 */
    noticeStyle?: (
        text: string
    ) => { icon: LucideIcon; tone: string; text: string } | null;
    topicLabel: string;
    topicPlaceholder: string;
    /** 방 설정 기본 정보 아래의 진행 방식 안내 */
    editorHint: string;
    /** 새 방에서 이 모드를 고를 때 비어 있는 칸에 채울 예시 */
    starter?: { name: string; topic: string; castingRules: string };
}
