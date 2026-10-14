import { useAtomValue } from 'jotai';
import { useState } from 'react';
import toast from 'react-hot-toast';
import type { RewriteResponse } from '@shared/providers';
import { apiErrorMessage } from '@services/api';
import { assistantSettingsAtom, type ModelChoice } from '@stores/chat';
import { useProfileModels } from './useProfileModels';

type RewriteSuccess = Extract<RewriteResponse, { ok: true }>;

/**
 * 텍스트 필드를 AI 도우미 모델로 다시 쓰고, 직전 값으로 되돌릴 수 있게 한다.
 * 여러 칸을 한 번에 바꾸면 T에 그 칸들을 묶어 넘기고, pick으로 결과를 T로 바꾼다.
 * @param apply 결과(또는 되돌린 값)를 필드에 반영하는 함수
 */
export function useAiRewrite<T = string>(apply: (value: T) => void) {
    const assistant = useAtomValue(assistantSettingsAtom);
    const { keyReady } = useProfileModels(assistant.profileId);
    const [busy, setBusy] = useState(false);
    const [previous, setPrevious] = useState<{ value: T } | null>(null);

    const rewrite = async (
        current: T,
        request: (model: Required<ModelChoice>) => Promise<RewriteResponse>,
        pick: (res: RewriteSuccess) => T = (res) => res.text as T
    ) => {
        setBusy(true);
        try {
            const res = await request({
                profileId: assistant.profileId,
                model: assistant.model,
                reasoning: assistant.reasoning ?? null,
            });
            if (!res.ok) {
                toast.error(`다듬기 실패: ${res.error}`);
                return;
            }
            setPrevious({ value: current });
            apply(pick(res));
            toast.success(`${res.via} 모델로 다듬었어요`);
        } catch (err) {
            toast.error(await apiErrorMessage(err));
        } finally {
            setBusy(false);
        }
    };

    const undo = () => {
        if (previous === null) return;
        apply(previous.value);
        setPrevious(null);
    };

    return { busy, keyReady, canUndo: previous !== null, rewrite, undo };
}
