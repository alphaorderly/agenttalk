import { PROVIDER_IDS, PROVIDERS, type ProviderId } from '@shared/providers';
import { cn } from '@utils/cn/cn';

export const ProviderMark = ({
    provider,
    className,
}: {
    provider: ProviderId;
    className?: string;
}) => (
    <span
        className={cn(
            'grid size-8 shrink-0 place-items-center rounded-[11px] text-xs font-bold text-white',
            className
        )}
        style={{ background: PROVIDERS[provider].color }}
    >
        {PROVIDERS[provider].label.slice(0, 2)}
    </span>
);

interface ProviderPickerProps {
    value: ProviderId;
    onChange: (id: ProviderId) => void;
}

const ProviderPicker = ({ value, onChange }: ProviderPickerProps) => (
    <div
        role="radiogroup"
        aria-label="프로바이더"
        className="grid grid-cols-2 gap-2 sm:grid-cols-3"
    >
        {PROVIDER_IDS.map((id) => {
            const p = PROVIDERS[id];
            const selected = id === value;
            return (
                <button
                    key={id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => onChange(id)}
                    className={cn(
                        'flex items-center gap-2 rounded-xl border px-2.5 py-2 text-left transition',
                        selected
                            ? 'bg-kakao/20 ring-kakao/60 border-yellow-500 ring-2'
                            : 'border-neutral-200 hover:bg-neutral-50'
                    )}
                >
                    <ProviderMark provider={id} />
                    <span className="min-w-0">
                        <span className="block truncate text-[13px] font-semibold">
                            {p.label}
                        </span>
                        <span className="block truncate text-[11px] text-neutral-500">
                            {p.hint}
                        </span>
                    </span>
                </button>
            );
        })}
    </div>
);

export default ProviderPicker;
