import { z } from 'zod';
import { MAX_AGENTS, REASONING_LEVELS } from './providers.ts';

const identifier = z.string().trim().min(1).max(128);
const idList = z.array(identifier).max(MAX_AGENTS + 1);

/** 요약 본문의 최대 길이. 화면 한쪽에서 훑어볼 수 있는 분량만 남긴다. */
export const ROOM_STATUS_MAX_LENGTH = 6000;

/**
 * 방장 전용 현황. 특정 게임·진행 방식에 묶인 고정 칸 없이,
 * 그 방에서 정리할 가치가 있는 내용만 모델이 마크다운으로 자유롭게 쓴다.
 */
export const roomStatusSummarySchema = z.strictObject({
    markdown: z.string().max(ROOM_STATUS_MAX_LENGTH),
});

export type RoomStatusSummary = z.infer<typeof roomStatusSummarySchema>;

/** The observer receives full room data; no participant request uses this shape. */
export const roomStatusRequestSchema = z
    .strictObject({
        profileId: z.string().max(64).nullable(),
        model: z.string().trim().max(200),
        reasoning: z.enum(REASONING_LEVELS).nullable(),
        roomName: z.string().trim().max(60),
        topic: z.string().trim().max(2000),
        userName: z.string().trim().max(30),
        members: z
            .array(
                z.strictObject({
                    id: identifier,
                    name: z.string().trim().min(1).max(30),
                    persona: z.string().max(4000).optional(),
                    secret: z.string().max(2000),
                })
            )
            .max(MAX_AGENTS),
        transcript: z
            .array(
                z.strictObject({
                    id: identifier,
                    sender: identifier,
                    senderName: z.string().trim().max(40),
                    text: z.string().max(40_000),
                    to: idList.optional(),
                    sources: z
                        .array(
                            z.strictObject({
                                title: z.string().max(1000),
                                url: z.url().max(4000),
                            })
                        )
                        .max(3)
                        .optional(),
                })
            )
            .max(50),
        previous: roomStatusSummarySchema.nullable(),
    })
    .superRefine((request, context) => {
        if (
            request.transcript.reduce(
                (sum, message) => sum + message.text.length,
                0
            ) > 40_000
        ) {
            context.addIssue({
                code: 'custom',
                path: ['transcript'],
                message:
                    '대화 기록은 한 번에 합계 40,000자까지 요약할 수 있습니다.',
            });
        }
        for (const field of ['members', 'transcript'] as const) {
            const ids = request[field].map((item) => item.id);
            if (new Set(ids).size !== ids.length) {
                context.addIssue({
                    code: 'custom',
                    path: [field],
                    message: '중복된 ID가 있습니다.',
                });
            }
        }
        if (request.members.some((member) => member.id === 'me')) {
            context.addIssue({
                code: 'custom',
                path: ['members'],
                message: 'me는 인간 사용자를 위해 예약된 ID입니다.',
            });
        }
    });

export type RoomStatusRequest = z.infer<typeof roomStatusRequestSchema>;
export type RoomStatusResponse =
    | { ok: true; status: RoomStatusSummary; via: string }
    | { ok: false; error: string };
