import {
    Clapperboard,
    Dices,
    Eye,
    Mic,
    Drama,
    Gavel,
    Hand,
    Moon,
    NotebookPen,
    OctagonX,
    Search,
    Stethoscope,
    Sun,
    TriangleAlert,
    Trophy,
    UserRound,
    VenetianMask,
    Vote,
    type LucideIcon,
} from 'lucide-react';
import type { MafiaGame, MafiaPhase, MafiaRole, MafiaUserRole } from './types';

/**
 * 마피아 화면 전용 표시 규칙. 규칙(rules.ts)의 문구는 프롬프트와 진행 알림에도 쓰이므로
 * 이모지를 그대로 두고, 화면에서는 이 아이콘과 색으로 바꿔 보여준다.
 */

/** 내 자리 (관전, 사회, 플레이어) */
export const SEAT_ICON: Record<MafiaUserRole, LucideIcon> = {
    observer: Eye,
    host: Mic,
    player: Hand,
};

export const ROLE_ICON: Record<MafiaRole, LucideIcon> = {
    mafia: VenetianMask,
    doctor: Stethoscope,
    police: Search,
    citizen: UserRound,
};

/** 역할 배지 색 (마피아만 붉게, 특수 시민은 각자 색, 일반 시민은 무채색) */
export const ROLE_TONE: Record<MafiaRole, string> = {
    mafia: 'bg-rose-600 text-white',
    doctor: 'bg-emerald-600 text-white',
    police: 'bg-sky-600 text-white',
    citizen: 'bg-neutral-500 text-white',
};

export interface PhaseTheme {
    icon: LucideIcon;
    title: string;
    /** 단계 이름 아래 한 줄 */
    caption: string;
    /** 상황판 배경과 글자색 */
    surface: string;
    /** 단계 아이콘 바탕 */
    badge: string;
    /** 상황판 안의 보조 글자색 */
    muted: string;
    dark: boolean;
}

const LIGHT = {
    surface: 'bg-white text-neutral-900',
    muted: 'text-neutral-500',
    dark: false,
};

const PHASES: Record<
    MafiaPhase,
    (
        game: MafiaGame
    ) => Omit<PhaseTheme, 'surface' | 'muted' | 'dark'> & Partial<PhaseTheme>
> = {
    introduction: () => ({
        icon: Hand,
        title: '자기소개',
        caption: '역할은 소개가 끝나면 나눠져요',
        badge: 'bg-neutral-900 text-white',
    }),
    night: (g) => ({
        icon: Moon,
        title: `${g.day}번째 밤`,
        caption: '마피아가 움직이는 시간',
        badge: 'bg-indigo-400/20 text-indigo-200',
        surface: 'bg-[#161b2e] text-white',
        muted: 'text-indigo-200/70',
        dark: true,
    }),
    day: (g) => ({
        icon: Sun,
        title: `${g.day}번째 낮`,
        caption: '토론 중',
        badge: 'bg-amber-100 text-amber-600',
    }),
    vote: (g) => ({
        icon: Vote,
        title: `${g.day}번째 낮`,
        caption: '투표 중',
        badge: 'bg-sky-100 text-sky-600',
    }),
    lastWords: (g) => ({
        icon: Gavel,
        title: `${g.day}번째 낮`,
        caption: '최후의 한마디',
        badge: 'bg-rose-100 text-rose-600',
    }),
    verdict: (g) => ({
        icon: Gavel,
        title: `${g.day}번째 낮`,
        caption: '처형 찬반 투표',
        badge: 'bg-rose-100 text-rose-600',
    }),
    epilogue: (g) => ({
        icon: Clapperboard,
        title: g.winner === 'mafia' ? '마피아 승리' : '시민 승리',
        caption: '엔딩',
        badge:
            g.winner === 'mafia'
                ? 'bg-rose-600 text-white'
                : 'bg-emerald-600 text-white',
    }),
    ended: (g) =>
        g.winner
            ? {
                  icon: Trophy,
                  title: g.winner === 'mafia' ? '마피아 승리' : '시민 승리',
                  caption: '게임 종료',
                  badge:
                      g.winner === 'mafia'
                          ? 'bg-rose-600 text-white'
                          : 'bg-emerald-600 text-white',
              }
            : {
                  icon: OctagonX,
                  title: '게임 중단',
                  caption: '역할이 모두 공개됐어요',
                  badge: 'bg-neutral-200 text-neutral-600',
              },
};

export function phaseTheme(game: MafiaGame | undefined): PhaseTheme {
    if (!game)
        return {
            ...LIGHT,
            icon: VenetianMask,
            title: '마피아 게임',
            caption: '대기 중',
            badge: 'bg-neutral-900 text-white',
        };
    return { ...LIGHT, ...PHASES[game.phase](game) };
}

/* ---------------- 진행 알림 ---------------- */

/** 진행 알림 앞의 이모지 → 아이콘과 색 */
const NOTICE: { emoji: string; icon: LucideIcon; tone: string }[] = [
    { emoji: '🎲', icon: Dices, tone: 'bg-neutral-900 text-white' },
    { emoji: '🙋', icon: Hand, tone: 'bg-white text-neutral-700' },
    { emoji: '🎭', icon: Drama, tone: 'bg-neutral-900 text-white' },
    { emoji: '🛑', icon: OctagonX, tone: 'bg-white text-neutral-700' },
    { emoji: '🌙', icon: Moon, tone: 'bg-[#161b2e] text-indigo-100' },
    { emoji: '☀️', icon: Sun, tone: 'bg-amber-50 text-amber-900' },
    { emoji: '🗳️', icon: Vote, tone: 'bg-white text-neutral-700' },
    { emoji: '⚖️', icon: Gavel, tone: 'bg-rose-50 text-rose-800' },
    { emoji: '🔍', icon: Search, tone: 'bg-sky-50 text-sky-900' },
    { emoji: '🩺', icon: Stethoscope, tone: 'bg-emerald-50 text-emerald-900' },
    { emoji: '🔪', icon: VenetianMask, tone: 'bg-rose-50 text-rose-900' },
    { emoji: '📝', icon: NotebookPen, tone: 'bg-white text-neutral-700' },
    { emoji: '⚠️', icon: TriangleAlert, tone: 'bg-amber-50 text-amber-900' },
    { emoji: '🏁', icon: Trophy, tone: 'bg-neutral-900 text-white' },
    { emoji: '🎬', icon: Clapperboard, tone: 'bg-stone-100 text-stone-800' },
];

/** 진행 알림을 아이콘, 색, 이모지를 뗀 본문으로 나눈다. 모르는 알림이면 null */
export function noticeOf(text: string) {
    const hit = NOTICE.find((n) => text.startsWith(n.emoji));
    if (!hit) return null;
    return {
        icon: hit.icon,
        tone: hit.tone,
        text: text.slice(hit.emoji.length).trimStart(),
    };
}

/** 문구 앞의 이모지 하나를 뗀다 (규칙의 질문 문구를 아이콘과 함께 보여줄 때) */
export const stripEmoji = (text: string) =>
    text.replace(
        /^(\p{Extended_Pictographic}|\p{Emoji_Presentation})️?\s*/u,
        ''
    );
