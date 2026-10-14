import { NoObjectGeneratedError, NoOutputGeneratedError } from 'ai';
import type { z } from 'zod';
import type {
    CastingEvent,
    GenerateAgentsRequest,
} from '../../shared/providers.ts';
import { errorMessage } from '../llm.ts';
import { normalizePlan, toAgent, type CastingSlot } from './normalize.ts';
import {
    DETAIL_INSTRUCTIONS,
    PLAN_INSTRUCTIONS,
    detailPrompt,
    planPrompt,
} from './prompts.ts';
import { detailSchema, planSchema } from './schema.ts';

/** 구조화 출력 한 번 호출. 라우트가 프로필·모델을 묶어 주입하고, timeoutMs가 지나면 TimeoutError로 끝낸다 */
export type CastingCall = <T>(
    instructions: string,
    prompt: string,
    schema: z.ZodType<T>,
    timeoutMs: number
) => Promise<T>;

interface CastOptions {
    call: CastingCall;
    signal: AbortSignal;
    /** 동시에 상세화할 멤버 수 */
    concurrency?: number;
}

const DETAIL_CONCURRENCY = 3;

/**
 * 기획은 인원이 많고 effort가 높을수록 오래 생각한다(20명·high에서 50초 이상).
 * 인원에 비례해 넉넉히 두고, 상세화는 한 명분이라 고정값으로 둔다.
 */
export const planTimeout = (count: number) => 60_000 + count * 6_000;
export const DETAIL_TIMEOUT = 90_000;

export class CastingError extends Error {
    name = 'CastingError';
}

/**
 * 같은 호출을 다시 하면 나아질 수 있는 실패인지.
 * HTTP 408/429/5xx는 AI SDK가 이미 재시도하고, 시간 초과는 같은 호출을 반복해도 또 오래 걸리므로
 * 출력 형식 오류·빈 출력만 본다.
 */
function worthRetrying(err: unknown) {
    return (
        NoObjectGeneratedError.isInstance(err) ||
        NoOutputGeneratedError.isInstance(err) ||
        err instanceof CastingError
    );
}

const isTimeout = (err: unknown) =>
    err instanceof Error && err.name === 'TimeoutError';

/** 한 번 실패하면 같은 호출을 한 번 더 한다. 중단됐으면 다시 하지 않는다 */
async function once<T>(
    signal: AbortSignal,
    timeoutMessage: string,
    run: () => Promise<T>
) {
    try {
        try {
            return await run();
        } catch (err) {
            if (signal.aborted || !worthRetrying(err)) throw err;
            return await run();
        }
    } catch (err) {
        throw isTimeout(err) ? new Error(timeoutMessage) : err;
    }
}

const seconds = (ms: number) => `${Math.round(ms / 1000)}초`;

/** fn을 limit개까지 동시에 돌리며 끝나는 순서대로 결과를 내보낸다. 중단되면 새 작업을 시작하지 않는다 */
async function* settleInOrderOfCompletion<R>(
    total: number,
    limit: number,
    signal: AbortSignal,
    fn: (index: number) => Promise<R>
): AsyncGenerator<R> {
    const running = new Map<number, Promise<{ index: number; result: R }>>();
    let next = 0;
    const fill = () => {
        while (!signal.aborted && next < total && running.size < limit) {
            const index = next++;
            running.set(
                index,
                fn(index).then((result) => ({ index, result }))
            );
        }
    };
    fill();
    while (running.size) {
        const { index, result } = await Promise.race(running.values());
        running.delete(index);
        fill();
        yield result;
    }
}

/**
 * 새 멤버를 기획한 뒤 멤버마다 상세화해 이벤트로 내보낸다.
 * 기획이 실패하면 throw 하고, 상세화 실패는 그 멤버만 failed 이벤트로 알린다.
 */
export async function* castAgents(
    req: GenerateAgentsRequest,
    { call, signal, concurrency = DETAIL_CONCURRENCY }: CastOptions
): AsyncGenerator<CastingEvent> {
    const timeout = planTimeout(req.count);
    const slots: CastingSlot[] = await once(
        signal,
        `명단 기획이 ${seconds(timeout)} 안에 끝나지 않았습니다. AI 도우미 Effort를 낮추거나 인원을 나눠 만들어 보세요.`,
        async () => {
            const plan = await call(
                PLAN_INSTRUCTIONS,
                planPrompt(req),
                planSchema,
                timeout
            );
            const normalized = normalizePlan(
                plan,
                req.existing.map((m) => m.name),
                req.count
            );
            if (!normalized.length)
                throw new CastingError(
                    '모델이 새 멤버 명단을 만들지 못했습니다.'
                );
            return normalized;
        }
    );
    if (signal.aborted) return;
    yield {
        type: 'plan',
        members: slots.map(({ name, emoji }) => ({ name, emoji })),
    };

    yield* settleInOrderOfCompletion(
        slots.length,
        concurrency,
        signal,
        async (index): Promise<CastingEvent> => {
            try {
                const agent = await once(
                    signal,
                    `${seconds(DETAIL_TIMEOUT)} 안에 끝나지 않았습니다.`,
                    async () => {
                        const detail = await call(
                            DETAIL_INSTRUCTIONS,
                            detailPrompt(req, slots, index),
                            detailSchema,
                            DETAIL_TIMEOUT
                        );
                        const result = toAgent(slots[index], detail);
                        if (!result)
                            throw new CastingError(
                                '모델이 빈 소개를 돌려줬습니다.'
                            );
                        return result;
                    }
                );
                return { type: 'agent', index, agent };
            } catch (err) {
                return { type: 'failed', index, error: errorMessage(err) };
            }
        }
    );
}
