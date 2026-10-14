import { useAtomValue } from 'jotai';
import { Loader2, Sparkles, Undo2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { useWatch, type Control, type UseFormGetValues } from 'react-hook-form';
import {
    MAX_AGENTS,
    type GenerateAgentsRequest,
    type GeneratedAgent,
} from '@shared/providers';
import { streamCasting } from '@services/api';
import { useProfileModels } from '@hooks/useProfileModels';
import { assistantSettingsAtom, newAgent } from '@stores/chat';
import type { RoomForm } from './RoomEditorModal';

type FormAgent = RoomForm['agents'][number];

/** 방 설정 중 캐스팅에 넘기는 부분 (모드 지침, 소개 공개 여부 등은 부모가 해석한다) */
export type CastingInput = Pick<
    GenerateAgentsRequest,
    'roomName' | 'topic' | 'castingRules' | 'modeContext' | 'shareIntroductions'
>;

/** 새 방의 기본 자리표시 에이전트(이름 그대로, 소개·말투 없음)인지 */
const isPlaceholder = (a: FormAgent) =>
    /^에이전트\d+$/.test(a.name.trim()) && !a.persona.trim() && !a.style.trim();

const PLANNING = '명단 기획 중';
const CANCELLED = '생성을 중단했습니다.';

/** 진행 중인 한 번의 생성 결과. 상세화는 끝나는 순서대로 오므로 기획 순서 자리에 채운다 */
interface Run {
    agents: (GeneratedAgent | undefined)[];
    settled: number;
    planned: number;
    failures: string[];
    error: string;
    via: string;
}

/**
 * 주제와 현재 멤버를 보고 AI 도우미 모델로 새 에이전트를 만든다.
 * 서버가 명단을 기획한 뒤 멤버마다 상세화하며, 끝나면 결과를 한 번에 폼에 반영한다.
 * 손대지 않은 자리표시 에이전트는 생성된 에이전트로 대체하고, 방금 생성한 것만 되돌릴 수 있다.
 */
const AgentGenerator = ({
    control,
    getValues,
    castingInput,
    onReplace,
}: {
    control: Control<RoomForm>;
    getValues: UseFormGetValues<RoomForm>;
    castingInput: () => CastingInput;
    /** removeIds를 빼고 add를 추가한다 */
    onReplace: (removeIds: string[], add: FormAgent[]) => void;
}) => {
    const assistant = useAtomValue(assistantSettingsAtom);
    const { keyReady } = useProfileModels(assistant.profileId);
    const topic = useWatch({ control, name: 'topic' });
    const agents = useWatch({ control, name: 'agents' });
    const [count, setCount] = useState(2);
    const [busy, setBusy] = useState(false);
    const [progress, setProgress] = useState('');
    const [incomplete, setIncomplete] = useState<{
        requested: number;
        created: number;
        error: string;
    } | null>(null);
    /** 되돌리기용: 방금 만든 에이전트 id와, 그때 대체한 자리표시 에이전트 */
    const [last, setLast] = useState<{
        created: string[];
        replaced: FormAgent[];
    } | null>(null);
    const controller = useRef<AbortController | null>(null);
    useEffect(
        () => () => {
            controller.current?.abort();
            controller.current = null;
        },
        []
    );

    // 자리표시 에이전트는 대체되므로 남은 자리 계산에서 뺀다
    const room = MAX_AGENTS - agents.filter((a) => !isPlaceholder(a)).length;
    const effectiveCount = Math.max(1, Math.min(count || 1, room));
    const disabledReason = !keyReady
        ? '설정 > AI 도우미에서 API 키가 있는 프로필을 고르세요'
        : !topic?.trim()
          ? '대화 주제를 먼저 적어 주세요'
          : room <= 0
            ? `에이전트는 최대 ${MAX_AGENTS}명까지예요`
            : null;

    const generate = async () => {
        if (controller.current) return;
        const requestController = new AbortController();
        controller.current = requestController;
        const { signal } = requestController;
        const current = getValues('agents');
        const placeholders = current.filter(isPlaceholder);
        const kept = current.filter((a) => !isPlaceholder(a));
        const requested = effectiveCount;
        const run: Run = {
            agents: [],
            settled: 0,
            planned: 0,
            failures: [],
            error: '',
            via: '',
        };
        setIncomplete(null);
        setBusy(true);
        setProgress(PLANNING);
        try {
            await streamCasting(
                {
                    profileId: assistant.profileId,
                    model: assistant.model,
                    reasoning: assistant.reasoning ?? null,
                    ...castingInput(),
                    count: requested,
                    existing: kept.map((a) => ({
                        name: a.name,
                        persona: a.persona,
                        style: a.style,
                        talk: a.talk,
                        secret: a.secret,
                        relations: a.relations,
                    })),
                },
                {
                    signal,
                    onEvent: (e) => {
                        switch (e.type) {
                            case 'plan':
                                run.planned = e.members.length;
                                break;
                            case 'agent':
                                run.agents[e.index] = e.agent;
                                run.settled++;
                                break;
                            case 'failed':
                                run.failures.push(e.error);
                                run.settled++;
                                break;
                            case 'done':
                                run.via = e.via;
                                break;
                            case 'error':
                                run.error = e.message;
                                break;
                        }
                        if (controller.current === requestController)
                            setProgress(
                                run.planned
                                    ? `${run.settled}/${run.planned}`
                                    : PLANNING
                            );
                    },
                }
            );
        } catch (err) {
            run.error = err instanceof Error ? err.message : String(err);
        }
        // 다른 방으로 이동했거나 편집 화면을 닫았으면 결과를 반영하지 않는다
        if (controller.current !== requestController) return;
        controller.current = null;
        setBusy(false);
        setProgress('');

        const created = run.agents
            .filter((a): a is GeneratedAgent => !!a)
            .map((a, i) => newAgent(kept.length + i, a));
        const failure = signal.aborted
            ? CANCELLED
            : run.error ||
              run.failures[0] ||
              (created.length < requested
                  ? '모델이 요청한 인원보다 적게 만들었습니다.'
                  : '');

        if (created.length) {
            onReplace(
                placeholders.map((a) => a.id),
                created
            );
            setLast({
                created: created.map((a) => a.id),
                replaced: placeholders,
            });
            if (!failure)
                toast.success(
                    `${created.map((a) => a.name).join(', ')} 님이 들어왔어요 · ${run.via}`
                );
        }
        if (failure) {
            setIncomplete({
                requested,
                created: created.length,
                error: failure,
            });
            // 다시 누르면 이미 만든 멤버를 유지하고 부족한 인원만 채운다
            setCount(requested - created.length);
            toast.error(
                `${requested}명 중 ${created.length}명 생성됨 · ${failure}`
            );
        }
    };

    return (
        <>
            {last && !busy && (
                <button
                    type="button"
                    className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-neutral-500 hover:bg-black/5"
                    onClick={() => {
                        onReplace(last.created, last.replaced);
                        setLast(null);
                        setIncomplete(null);
                    }}
                >
                    <Undo2 size={13} /> 되돌리기
                </button>
            )}
            <div
                className="flex items-center overflow-hidden rounded-lg border border-violet-200 bg-violet-50 text-sm"
                title={
                    disabledReason ??
                    '주제와 현재 멤버를 보고 어울리는 에이전트를 만들어요'
                }
            >
                <input
                    type="number"
                    min={1}
                    max={Math.max(1, room)}
                    className="h-full w-12 bg-transparent py-2 pl-2 text-right text-violet-700 outline-none disabled:opacity-50"
                    value={count || ''}
                    disabled={busy || !!disabledReason}
                    onChange={(e) => {
                        setCount(Math.floor(Number(e.target.value)));
                        setIncomplete(null);
                    }}
                    onBlur={() => setCount(effectiveCount)}
                    aria-label="만들 에이전트 수"
                />
                <span className="pr-1 text-violet-700">명</span>
                <button
                    type="button"
                    className="flex items-center gap-1 px-2.5 py-2 font-semibold text-violet-700 hover:bg-violet-100 disabled:opacity-50"
                    disabled={busy || !!disabledReason}
                    onClick={generate}
                >
                    {busy ? (
                        <Loader2 size={15} className="animate-spin" />
                    ) : (
                        <Sparkles size={15} />
                    )}
                    {busy ? `만드는 중… ${progress}`.trim() : '자동 생성'}
                </button>
            </div>
            {busy && (
                <button
                    type="button"
                    className="btn-ghost text-xs"
                    onClick={() => controller.current?.abort()}
                >
                    생성 중단
                </button>
            )}
            {incomplete && !busy && (
                <div
                    role="alert"
                    className="w-full text-right text-xs text-red-600"
                >
                    {incomplete.requested}명 중 {incomplete.created}명만
                    생성됐어요. {incomplete.error}
                    <br />
                    남은 {incomplete.requested - incomplete.created}명은 자동
                    생성을 다시 누르면 이어서 만들어요.
                </div>
            )}
        </>
    );
};

export default AgentGenerator;
