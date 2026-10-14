// @vitest-environment node
import { NoObjectGeneratedError } from 'ai';
import { describe, expect, it, vi } from 'vitest';
import {
    generateAgentsSchema,
    type CastingEvent,
} from '../../shared/providers';
import { castAgents, planTimeout, type CastingCall } from './generate';
import { PLAN_INSTRUCTIONS } from './prompts';

const req = (count: number) =>
    generateAgentsSchema.parse({
        profileId: null,
        model: '',
        reasoning: null,
        roomName: '팀방',
        topic: '워크숍',
        count,
        existing: [{ name: '철수', persona: '개발자' }],
    });

const plan = (names: string[]) => ({
    members: names.map((name) => ({
        name,
        emoji: '🙂',
        concept: `${name}의 콘셉트`,
        talk: 'normal',
    })),
});

const detail = (persona: string) => ({
    persona,
    style: '',
    relations: '',
    secret: '',
});

const badOutput = () =>
    new NoObjectGeneratedError({
        message: 'bad json',
        text: '{',
        response: { id: '', timestamp: new Date(), modelId: 'm' },
        usage: {} as never,
        finishReason: 'stop',
    });

/** 단계별 응답을 정하는 가짜 호출. detail은 프롬프트 끝의 대상 멤버 이름으로 고른다 */
function fakeCall(
    planResult: () => unknown,
    detailResult: (name: string) => unknown
) {
    return vi.fn(async (instructions: string, prompt: string) => {
        if (instructions === PLAN_INSTRUCTIONS) return planResult();
        const name = prompt.match(/이번에 자세히 쓸 멤버:\n- \S+ (\S+)/)![1];
        return detailResult(name);
    }) as unknown as CastingCall & ReturnType<typeof vi.fn>;
}

async function collect(gen: AsyncGenerator<CastingEvent>) {
    const events: CastingEvent[] = [];
    for await (const e of gen) events.push(e);
    return events;
}

describe('castAgents', () => {
    it('plans the roster once, then details each member', async () => {
        const call = fakeCall(
            () => plan(['철수', '하린']),
            (name) => detail(`${name} 소개`)
        );
        const events = await collect(
            castAgents(req(2), { call, signal: new AbortController().signal })
        );
        expect(events[0]).toEqual({
            type: 'plan',
            members: [
                { name: '철수2', emoji: '🙂' },
                { name: '하린', emoji: '🙂' },
            ],
        });
        const agents = events.filter((e) => e.type === 'agent');
        expect(agents.map((e) => [e.index, e.agent.persona])).toEqual(
            expect.arrayContaining([
                [0, '철수2 소개'],
                [1, '하린 소개'],
            ])
        );
        expect(call).toHaveBeenCalledTimes(3);
    });

    it('retries a broken detail once and reports a member that still fails', async () => {
        const attempts: Record<string, number> = {};
        const call = fakeCall(
            () => plan(['가', '나']),
            (name) => {
                attempts[name] = (attempts[name] ?? 0) + 1;
                if (name === '나' || attempts[name] === 1) throw badOutput();
                return detail('소개');
            }
        );
        const events = await collect(
            castAgents(req(2), { call, signal: new AbortController().signal })
        );
        expect(attempts).toEqual({ 가: 2, 나: 2 });
        expect(events).toContainEqual(
            expect.objectContaining({ type: 'agent', index: 0 })
        );
        expect(events).toContainEqual(
            expect.objectContaining({ type: 'failed', index: 1 })
        );
    });

    it('does not retry errors that will not change, such as auth failures', async () => {
        const call = fakeCall(
            () => {
                throw Object.assign(new Error('401 invalid key'), {
                    statusCode: 401,
                });
            },
            () => detail('소개')
        );
        await expect(
            collect(
                castAgents(req(2), {
                    call,
                    signal: new AbortController().signal,
                })
            )
        ).rejects.toThrow('401');
        expect(call).toHaveBeenCalledTimes(1);
    });

    it('gives the plan more time for bigger rosters and does not repeat a timed-out plan', async () => {
        const timeouts: number[] = [];
        const call = vi.fn(
            async (
                _instructions: string,
                _prompt: string,
                _schema: unknown,
                timeoutMs: number
            ) => {
                timeouts.push(timeoutMs);
                throw new DOMException('timed out', 'TimeoutError');
            }
        ) as unknown as CastingCall & ReturnType<typeof vi.fn>;
        await expect(
            collect(
                castAgents(req(20), {
                    call,
                    signal: new AbortController().signal,
                })
            )
        ).rejects.toThrow('명단 기획이 180초 안에 끝나지 않았습니다');
        expect(timeouts).toEqual([planTimeout(20)]);
        expect(planTimeout(20)).toBeGreaterThan(planTimeout(2));
    });

    it('throws when the plan stays empty after a retry', async () => {
        const call = fakeCall(
            () => plan([]),
            () => detail('소개')
        );
        await expect(
            collect(
                castAgents(req(2), {
                    call,
                    signal: new AbortController().signal,
                })
            )
        ).rejects.toThrow('명단');
        expect(call).toHaveBeenCalledTimes(2);
    });

    it('runs at most `concurrency` details at once', async () => {
        let running = 0;
        let peak = 0;
        const call = fakeCall(
            () => plan(['가', '나', '다', '라', '마']),
            async () => {
                running++;
                peak = Math.max(peak, running);
                await new Promise((r) => setTimeout(r, 5));
                running--;
                return detail('소개');
            }
        );
        const events = await collect(
            castAgents(req(5), {
                call,
                signal: new AbortController().signal,
                concurrency: 2,
            })
        );
        expect(peak).toBe(2);
        expect(events.filter((e) => e.type === 'agent')).toHaveLength(5);
    });

    it('starts no new details after cancellation', async () => {
        const controller = new AbortController();
        const call = fakeCall(
            () => plan(['가', '나', '다', '라']),
            async () => {
                controller.abort();
                return detail('소개');
            }
        );
        await collect(
            castAgents(req(4), {
                call,
                signal: controller.signal,
                concurrency: 1,
            })
        );
        // 기획 1번 + 이미 시작한 상세화 1번
        expect(call).toHaveBeenCalledTimes(2);
    });
});
