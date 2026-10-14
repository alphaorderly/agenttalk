import { List } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@utils/cn/cn';

const CUSTOM = '__custom__';

interface ModelPickerProps {
    value: string;
    onChange: (model: string) => void;
    models: string[];
    disabled?: boolean;
    /** 지정하면 빈 값('')을 "상속" 선택지로 보여준다 */
    inheritLabel?: string;
    className?: string;
}

/**
 * 모델 선택 드롭다운. 목록에 없는 모델은 "직접 입력…"으로 자유롭게 입력할 수 있다.
 * 현재 값이 목록에 없으면 그 값도 선택지로 함께 보여준다.
 */
const ModelPicker = ({
    value,
    onChange,
    models,
    disabled,
    inheritLabel,
    className,
}: ModelPickerProps) => {
    const [custom, setCustom] = useState(false);

    if (custom && !disabled) {
        return (
            <div className={cn('flex gap-1', className)}>
                <input
                    className="field min-w-0 flex-1"
                    autoFocus
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="모델 ID 직접 입력"
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                />
                <button
                    type="button"
                    className="icon-btn shrink-0"
                    title="목록에서 고르기"
                    onClick={() => setCustom(false)}
                >
                    <List size={16} />
                </button>
            </div>
        );
    }

    return (
        <select
            className={cn(
                'field disabled:cursor-not-allowed disabled:bg-neutral-100 disabled:text-neutral-400',
                className
            )}
            disabled={disabled}
            value={value}
            onChange={(e) => {
                if (e.target.value === CUSTOM) setCustom(true);
                else onChange(e.target.value);
            }}
        >
            {inheritLabel !== undefined ? (
                <option value="">{inheritLabel}</option>
            ) : (
                !value && (
                    <option value="" disabled>
                        모델 선택
                    </option>
                )
            )}
            {value && !models.includes(value) && (
                <option value={value}>{value}</option>
            )}
            {models.map((m) => (
                <option key={m} value={m}>
                    {m}
                </option>
            ))}
            <option value={CUSTOM}>직접 입력…</option>
        </select>
    );
};

export default ModelPicker;
