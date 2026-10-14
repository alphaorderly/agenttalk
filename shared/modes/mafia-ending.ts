import { z } from 'zod';
import { MAX_AGENTS, REASONING_LEVELS } from '../providers.ts';
import type { ModeActionResponse } from './action.ts';

/**
 * 마피아 게임이 끝난 뒤의 엔딩. 엔딩의 내용(보상, 처벌, 뒷풀이 등)은 코드에 정하지 않고
 * 엔딩 연출 모델이 상황 설정과 결과를 읽고 아래의 범용 장면을 조합해 정한다.
 */

export const ENDING_MAX_BEATS = 32;
export const ENDING_NARRATION_MAX = 800;
export const ENDING_DIRECTION_MAX = 400;
export const ENDING_MAX_TURNS = 20;
/** 연출 모델에 보내는 게임 기록의 총 글자 수 */
export const ENDING_TRANSCRIPT_MAX = 30_000;
/** 한 엔딩에서 인물에게 맡길 수 있는 결정 수. 결정마다 연출 모델이 그 뒤를 다시 짠다 */
export const ENDING_MAX_DECISIONS = 5;
export const ENDING_OPTION_MAX = 60;

const name = z.string().trim().min(1).max(40);

/** 이름은 연출 모델이 쓴 그대로다. 클라이언트가 참가자 id로 바꾼다 */
export const endingBeatSchema = z.discriminatedUnion('type', [
    /** 진행자가 상황·행동·결과를 서술한다. gone은 이 서술로 이야기에서 빠져 더 말할 수 없게 된 인물 */
    z.object({
        type: z.literal('narration'),
        text: z.string().trim().min(1).max(ENDING_NARRATION_MAX),
        gone: z
            .array(name)
            .max(MAX_AGENTS + 1)
            .optional(),
    }),
    /** 한 인물이 주어진 상황에서 직접 말한다. direction은 대사가 아니라 그 인물에게 주는 상황 메모다 */
    z.object({
        type: z.literal('line'),
        speaker: name,
        direction: z.string().trim().max(ENDING_DIRECTION_MAX),
    }),
    /** 여러 인물이 자유롭게 대화한다. 누가 말할지는 진행 모델이 정한다 */
    z.object({
        type: z.literal('talk'),
        speakers: z.union([
            z.enum(['all', 'alive', 'dead']),
            z
                .array(name)
                .min(1)
                .max(MAX_AGENTS + 1),
        ]),
        turns: z.number().int().min(1).max(ENDING_MAX_TURNS),
        direction: z.string().trim().max(ENDING_DIRECTION_MAX),
    }),
    /** 한 인물이 무엇을 할지 직접 고른다. 결과는 미리 정하지 않고, 고른 뒤 연출 모델이 이어서 짠다 */
    z.object({
        type: z.literal('decision'),
        speaker: name,
        direction: z.string().trim().max(ENDING_DIRECTION_MAX),
        options: z
            .array(z.string().trim().min(1).max(ENDING_OPTION_MAX))
            .min(2)
            .max(4),
    }),
]);

export type EndingBeat = z.infer<typeof endingBeatSchema>;

export const mafiaEndingRequestSchema = z
    .strictObject({
        profileId: z.string().max(64).nullable(),
        model: z.string().trim().max(200),
        reasoning: z.enum(REASONING_LEVELS).nullable(),
        topic: z.string().trim().max(4000),
        userName: z.string().trim().max(30),
        winner: z.enum(['mafia', 'citizen']),
        /** 이번 응답에 넣을 수 있는 decision 수 (0이면 넣지 않는다) */
        decisionsLeft: z.number().int().min(0).max(ENDING_MAX_DECISIONS),
        players: z
            .array(
                z.strictObject({
                    name,
                    /** 게임 역할 이름 (예: 마피아) */
                    role: z.string().trim().max(20),
                    team: z.enum(['mafia', 'citizen']),
                    alive: z.boolean(),
                    /** 예: "2번째 밤에 마피아에게 당함" */
                    death: z.string().trim().max(60).optional(),
                    /** 사람(나)이면 true */
                    human: z.boolean(),
                    /** 앞선 엔딩 서술로 이야기에서 빠졌으면 true */
                    gone: z.boolean().optional(),
                    /** 방에서 소개를 공개할 때만 담는다 */
                    persona: z.string().max(4000).optional(),
                })
            )
            .min(1)
            .max(MAX_AGENTS + 1),
        transcript: z
            .array(
                z.strictObject({
                    speaker: z.string().trim().max(40),
                    text: z.string().max(4000),
                    /** 받는 사람이 정해진 메시지 (예: 마피아끼리 밤 대화) */
                    to: z.array(z.string().trim().max(40)).max(40).optional(),
                })
            )
            .max(200),
    })
    .refine(
        (r) =>
            r.transcript.reduce((sum, m) => sum + m.text.length, 0) <=
            ENDING_TRANSCRIPT_MAX,
        {
            path: ['transcript'],
            message: `게임 기록은 합계 ${ENDING_TRANSCRIPT_MAX}자까지 보낼 수 있습니다.`,
        }
    );

export type MafiaEndingRequest = z.infer<typeof mafiaEndingRequestSchema>;

/** 연출 모델이 짠 엔딩. after는 게임이 끝난 뒤 이어지는 대화에 죽은 인물도 끼는지 */
export interface MafiaEndingPlan {
    beats: EndingBeat[];
    after?: 'all' | 'alive';
}

export type MafiaEndingResponse = ModeActionResponse<MafiaEndingPlan>;
