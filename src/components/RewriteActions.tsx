import { Loader2, Sparkles, Undo2 } from 'lucide-react';

interface RewriteActionsProps {
    busy: boolean;
    keyReady: boolean;
    canUndo: boolean;
    /** 다듬을 내용이 비어 있으면 true */
    empty: boolean;
    onRewrite: () => void;
    onUndo: () => void;
}

/** 텍스트 필드 아래의 "✨ AI로 다듬기 / 되돌리기" 버튼 */
const RewriteActions = ({
    busy,
    keyReady,
    canUndo,
    empty,
    onRewrite,
    onUndo,
}: RewriteActionsProps) => (
    <div className="flex items-center justify-end gap-1.5">
        {canUndo && !busy && (
            <button
                type="button"
                className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-neutral-500 hover:bg-black/5"
                onClick={onUndo}
            >
                <Undo2 size={13} /> 되돌리기
            </button>
        )}
        <button
            type="button"
            className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-neutral-600 hover:bg-black/5 hover:text-neutral-900 disabled:opacity-40 disabled:hover:bg-transparent"
            disabled={busy || empty || !keyReady}
            title={
                !keyReady
                    ? '설정 > AI 도우미에서 API 키가 있는 프로필을 고르세요'
                    : empty
                      ? '먼저 짧게 적어 주세요'
                      : '설정의 AI 도우미 모델로 자세히 다시 써요'
            }
            onClick={onRewrite}
        >
            {busy ? (
                <Loader2 size={13} className="animate-spin" />
            ) : (
                <Sparkles size={13} />
            )}
            {busy ? '다듬는 중…' : 'AI로 다듬기'}
        </button>
    </div>
);

export default RewriteActions;
