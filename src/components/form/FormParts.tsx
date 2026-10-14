import { Minus, Plus } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@utils/cn/cn';

/** 설정 화면의 한 묶음. 묶음 사이는 얇은 선으로만 나눈다 */
export const FormSection = ({
    title,
    description,
    children,
    className,
}: {
    title?: ReactNode;
    description?: ReactNode;
    children: ReactNode;
    className?: string;
}) => (
    <section
        className={cn(
            'flex flex-col gap-4 border-t border-neutral-200 pt-5 first:border-t-0 first:pt-0',
            className
        )}
    >
        {title && (
            <header className="flex flex-col gap-0.5">
                <h4 className="text-sm font-semibold text-neutral-900">
                    {title}
                </h4>
                {description && (
                    <p className="text-xs leading-relaxed text-neutral-500">
                        {description}
                    </p>
                )}
            </header>
        )}
        {children}
    </section>
);

/** 왼쪽 이름표, 오른쪽 조작 한 줄. 설명은 이름표 아래에 작게 붙는다 */
export const FormRow = ({
    label,
    description,
    children,
    htmlFor,
}: {
    label: ReactNode;
    description?: ReactNode;
    children: ReactNode;
    htmlFor?: string;
}) => (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        {/* 좁은 화면에서는 이름표를 짓누르지 않고 조작을 다음 줄로 내린다 */}
        <div className="min-w-0 flex-1 basis-56">
            <label
                htmlFor={htmlFor}
                className="block text-[13px] font-medium text-neutral-800"
            >
                {label}
            </label>
            {description && (
                <p className="mt-0.5 text-xs leading-relaxed text-neutral-500">
                    {description}
                </p>
            )}
        </div>
        <div className="shrink-0">{children}</div>
    </div>
);

/** 몇 개 중 하나를 고르는 버튼 묶음 */
export const Segmented = <T extends string | number>({
    value,
    options,
    onChange,
    label,
    className,
}: {
    value: T;
    options: readonly { value: T; label: ReactNode }[];
    onChange: (value: T) => void;
    /** 화면 낭독기용 이름 */
    label: string;
    className?: string;
}) => (
    <div
        role="radiogroup"
        aria-label={label}
        className={cn(
            'inline-flex rounded-lg bg-neutral-100 p-0.5 text-[13px]',
            className
        )}
    >
        {options.map((o) => {
            const on = o.value === value;
            return (
                <button
                    key={String(o.value)}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => onChange(o.value)}
                    className={cn(
                        'flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 whitespace-nowrap transition-colors',
                        on
                            ? 'bg-white font-semibold text-neutral-900 shadow-sm ring-1 ring-black/5'
                            : 'text-neutral-500 hover:text-neutral-800'
                    )}
                >
                    {o.label}
                </button>
            );
        })}
    </div>
);

/** − 숫자 + */
export const Stepper = ({
    value,
    onChange,
    min,
    max,
    label,
}: {
    value: number;
    onChange: (value: number) => void;
    min: number;
    max: number;
    /** 화면 낭독기용 이름 */
    label: string;
}) => {
    const n = Number.isFinite(value) ? value : min;
    const btn =
        'grid size-8 place-items-center text-neutral-600 hover:bg-neutral-100 disabled:text-neutral-300 disabled:hover:bg-transparent';
    return (
        <div
            role="group"
            aria-label={label}
            className="inline-flex items-center overflow-hidden rounded-lg border border-neutral-300 bg-white"
        >
            <button
                type="button"
                className={btn}
                aria-label={`${label} 줄이기`}
                disabled={n <= min}
                onClick={() => onChange(Math.max(min, n - 1))}
            >
                <Minus size={14} />
            </button>
            <output
                aria-live="polite"
                className="w-8 text-center text-sm font-semibold text-neutral-900 tabular-nums"
            >
                {n}
            </output>
            <button
                type="button"
                className={btn}
                aria-label={`${label} 늘리기`}
                disabled={n >= max}
                onClick={() => onChange(Math.min(max, n + 1))}
            >
                <Plus size={14} />
            </button>
        </div>
    );
};

/** 켜고 끄는 스위치 */
export const Switch = ({
    checked,
    onChange,
    label,
    id,
}: {
    checked: boolean;
    onChange: (checked: boolean) => void;
    /** 화면 낭독기용 이름 */
    label: string;
    id?: string;
}) => (
    <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={cn(
            'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors',
            checked ? 'bg-neutral-900' : 'bg-neutral-300'
        )}
    >
        <span
            className={cn(
                'size-4 rounded-full bg-white shadow transition-transform',
                checked ? 'translate-x-[18px]' : 'translate-x-0.5'
            )}
        />
    </button>
);
