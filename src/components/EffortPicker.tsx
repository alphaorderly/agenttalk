import {
    REASONING_LABELS,
    REASONING_LEVELS,
    type ReasoningLevel,
} from '@shared/providers';
import { cn } from '@utils/cn/cn';

const INHERIT = '__inherit__';

interface EffortPickerProps {
    value: ReasoningLevel | null;
    onChange: (level: ReasoningLevel | null) => void;
    /** 지정하면 null("상위 설정 따름") 선택지를 맨 위에 보여준다 */
    inheritLabel?: string;
    /** 라벨 없이 쓰일 때 각 선택지 앞에 "Effort:"를 붙인다 */
    prefixed?: boolean;
    disabled?: boolean;
    className?: string;
}

/** 추론 강도(effort) 선택. 지원하지 않는 모델에서는 서버가 무시하고 경고를 돌려준다. */
const EffortPicker = ({
    value,
    onChange,
    inheritLabel,
    prefixed,
    disabled,
    className,
}: EffortPickerProps) => (
    <select
        className={cn(
            'field disabled:cursor-not-allowed disabled:bg-neutral-100 disabled:text-neutral-400',
            className
        )}
        title="Effort (추론 강도)"
        disabled={disabled}
        value={value ?? INHERIT}
        onChange={(e) =>
            onChange(
                e.target.value === INHERIT
                    ? null
                    : (e.target.value as ReasoningLevel)
            )
        }
    >
        {inheritLabel !== undefined && (
            <option value={INHERIT}>{inheritLabel}</option>
        )}
        {REASONING_LEVELS.map((level) => (
            <option key={level} value={level}>
                {prefixed && 'Effort: '}
                {REASONING_LABELS[level]}
                {level === 'provider-default' || level === 'none'
                    ? ''
                    : ` (${level})`}
            </option>
        ))}
    </select>
);

export default EffortPicker;
