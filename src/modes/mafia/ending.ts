import type { Room } from '@/types/chat';
import {
    ENDING_MAX_DECISIONS,
    ENDING_TRANSCRIPT_MAX,
    type EndingBeat,
    type MafiaEndingRequest,
} from '@shared/modes/mafia-ending';
import type { ModelChoice } from '../runtime';
import { shareIntroductionsOf } from '../index';
import { ROLE_LABELS, deathLabel, gameStartedAt, isGone } from './rules';
import type { MafiaEndingBeat, MafiaGame } from './types';

/**
 * 엔딩 연출 요청과 응답 처리. 엔딩의 내용은 연출 모델이 정하고,
 * 여기서는 자료를 모아 보내고 돌아온 장면의 이름을 참가자 id로 바꾸기만 한다.
 */

const MAX_MESSAGES = 200;
const MAX_MESSAGE_LENGTH = 1000;

export function endingRequest(
    room: Room,
    game: MafiaGame,
    target: ModelChoice,
    userName: string
): MafiaEndingRequest {
    const share = shareIntroductionsOf(room);
    const nameOf = (id: string) =>
        id === 'me'
            ? userName
            : id === 'system'
              ? '진행'
              : id === 'gm'
                ? '진행자만'
                : (game.players.find((p) => p.id === id)?.name ??
                  room.agents.find((a) => a.id === id)?.name ??
                  '(나간 멤버)');
    return {
        profileId: target.profileId,
        model: target.model,
        reasoning: target.reasoning ?? null,
        topic: room.topic.slice(0, 4000),
        userName,
        winner: game.winner ?? 'citizen',
        decisionsLeft: decisionsLeft(game),
        players: game.players.map((p) => {
            const persona = share
                ? room.agents.find((a) => a.id === p.id)?.persona
                : undefined;
            return {
                name: p.name.slice(0, 40),
                role: ROLE_LABELS[p.role],
                team: p.role === 'mafia' ? 'mafia' : 'citizen',
                alive: p.alive,
                ...(!p.alive && { death: deathLabel(p) }),
                human: p.id === 'me',
                ...(isGone(game, p.id) && { gone: true }),
                // 비공개 소개는 진행 모델과 마찬가지로 연출 모델에도 넘기지 않는다
                ...(persona && { persona: persona.slice(0, 4000) }),
            };
        }),
        transcript: gameTranscript(room, game, nameOf),
    };
}

/** 이번에 연출 모델에게 장면을 받을 때 인물에게 맡길 수 있는 결정 수 */
export const decisionsLeft = (game: MafiaGame) =>
    Math.max(0, ENDING_MAX_DECISIONS - (game.epilogue?.rounds ?? 0));

/** 이번 판의 기록. 최근 것부터 글자 수 한도 안에서 담는다 */
function gameTranscript(
    room: Room,
    game: MafiaGame,
    nameOf: (id: string) => string
) {
    const since = gameStartedAt(room, game);
    const picked: MafiaEndingRequest['transcript'] = [];
    let total = 0;
    for (const m of room.messages.filter((m) => m.ts >= since).reverse()) {
        const text = m.text.trim().slice(0, MAX_MESSAGE_LENGTH);
        if (!text || m.error) continue;
        if (picked.length >= MAX_MESSAGES) break;
        if (total + text.length > ENDING_TRANSCRIPT_MAX) break;
        total += text.length;
        picked.push({
            speaker: (m.senderName ?? nameOf(m.sender)).slice(0, 40),
            text,
            ...(m.to?.length && { to: m.to.map((id) => nameOf(id)) }),
        });
    }
    return picked.reverse();
}

/**
 * 연출 모델이 쓴 이름을 참가자 id로 바꾼다. 없는 사람만 남은 장면은 버린다.
 * 결정은 한 번에 하나만 받고(그 뒤는 결정을 보고 다시 짠다), 더 맡길 수 없으면 버린다.
 */
export function resolveBeats(
    game: MafiaGame,
    beats: EndingBeat[]
): MafiaEndingBeat[] {
    const idOf = (name: string) =>
        game.players.find((p) => p.name === name.trim())?.id;
    const canDecide = decisionsLeft(game) > 0;
    const resolved = beats.flatMap((beat): MafiaEndingBeat[] => {
        if (beat.type === 'narration') {
            const gone = [
                ...new Set((beat.gone ?? []).flatMap((n) => idOf(n) ?? [])),
            ];
            return [
                {
                    type: 'narration',
                    text: beat.text,
                    ...(gone.length && { gone }),
                },
            ];
        }
        if (beat.type === 'line') {
            const speaker = idOf(beat.speaker);
            return speaker ? [{ ...beat, speaker }] : [];
        }
        if (beat.type === 'decision') {
            const speaker = idOf(beat.speaker);
            return speaker && canDecide ? [{ ...beat, speaker }] : [];
        }
        const speakers =
            typeof beat.speakers === 'string'
                ? game.players
                      .filter(
                          (p) =>
                              beat.speakers === 'all' ||
                              p.alive === (beat.speakers === 'alive')
                      )
                      .map((p) => p.id)
                : [...new Set(beat.speakers.flatMap((n) => idOf(n) ?? []))];
        return speakers.length ? [{ ...beat, speakers }] : [];
    });
    const decision = resolved.findIndex((b) => b.type === 'decision');
    return decision < 0 ? resolved : resolved.slice(0, decision + 1);
}

/**
 * 연출 모델을 쓸 수 없을 때의 엔딩: 모든 참가자가 결과를 두고 이야기한다.
 * 결과를 어떻게 받아들일지는 각 에이전트가 상황 설정을 보고 정한다.
 */
export const fallbackBeats = (game: MafiaGame): MafiaEndingBeat[] => [
    {
        type: 'talk',
        speakers: game.players.map((p) => p.id),
        turns: 8,
        direction:
            '게임이 끝났다. 상황 설정 속에서 이 결과가 갖는 의미대로 반응하고, 게임 중에 있었던 일을 이야기한다. 상황 설정상 죽은 사람이 말할 수 없다면 죽은 사람은 말하지 않고 넘긴다.',
    },
];
