import type { LucideIcon } from 'lucide-react';
import { X } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
import { cn } from '@utils/cn/cn';

export interface ModalNavItem<T extends string = string> {
    id: T;
    label: string;
    icon: LucideIcon;
    /** 오른쪽 머리말에 보여줄 한 줄 설명 */
    hint?: string;
    /** 이 섹션에 확인할 오류가 있으면 표시 */
    alert?: boolean;
}

interface ModalNav<T extends string> {
    items: ModalNavItem<T>[];
    active: T;
    onSelect: (id: T) => void;
}

interface ModalProps<T extends string> {
    open: boolean;
    onClose: () => void;
    title: string;
    children: ReactNode;
    className?: string;
    /**
     * 있으면 왼쪽(모바일은 위쪽 탭)에 섹션 내비게이션을 두는 넓은 레이아웃.
     * 이때 children은 오른쪽 영역을 채우며 ModalBody/ModalFooter로 구성한다.
     */
    nav?: ModalNav<T>;
}

/** 네이티브 <dialog> 기반 모달 (ESC로 닫힘. 입력 유실 방지를 위해 백드롭 클릭으로는 닫지 않음) */
const Modal = <T extends string>({
    open,
    onClose,
    title,
    children,
    className,
    nav,
}: ModalProps<T>) => {
    const ref = useRef<HTMLDialogElement>(null);

    useEffect(() => {
        const dialog = ref.current;
        if (!dialog) return;
        if (open && !dialog.open) dialog.showModal();
        if (!open && dialog.open) dialog.close();
    }, [open]);

    const active = nav?.items.find((item) => item.id === nav.active);

    return (
        <dialog
            ref={ref}
            onClose={onClose}
            aria-label={title}
            className={cn(
                'm-auto rounded-2xl p-0 shadow-2xl',
                nav
                    ? 'w-[min(960px,calc(100vw-24px))]'
                    : 'w-[min(440px,calc(100vw-32px))]',
                className
            )}
        >
            {open && !nav && (
                <div className="flex max-h-[calc(100dvh-48px)] flex-col gap-4 overflow-y-auto p-5 sm:p-6">
                    <h2 className="text-lg font-bold">{title}</h2>
                    {children}
                </div>
            )}
            {open && nav && (
                <div className="flex h-[min(780px,calc(100dvh-24px))] flex-col md:flex-row">
                    <aside className="flex shrink-0 flex-col border-b border-neutral-200 bg-neutral-50 md:w-56 md:border-r md:border-b-0">
                        <div className="flex items-center gap-2 px-4 pt-4 pb-2 md:px-5 md:pt-6 md:pb-4">
                            <h2 className="flex-1 truncate text-lg font-bold">
                                {title}
                            </h2>
                            <button
                                type="button"
                                className="icon-btn md:hidden"
                                title="닫기"
                                onClick={onClose}
                            >
                                <X size={18} />
                            </button>
                        </div>
                        <nav
                            aria-label={`${title} 섹션`}
                            className="flex [scrollbar-width:none] gap-1 overflow-x-auto px-3 pb-2.5 md:flex-col md:overflow-visible md:pb-4"
                        >
                            {nav.items.map((item) => {
                                const Icon = item.icon;
                                const selected = item.id === nav.active;
                                return (
                                    <button
                                        key={item.id}
                                        type="button"
                                        aria-current={
                                            selected ? 'page' : undefined
                                        }
                                        onClick={() => nav.onSelect(item.id)}
                                        className={cn(
                                            'flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm whitespace-nowrap',
                                            selected
                                                ? 'bg-white font-semibold text-neutral-900 shadow-sm ring-1 ring-neutral-200'
                                                : 'text-neutral-600 hover:bg-black/5'
                                        )}
                                    >
                                        <Icon
                                            size={16}
                                            className={cn(
                                                'shrink-0',
                                                selected
                                                    ? 'text-neutral-800'
                                                    : 'text-neutral-400'
                                            )}
                                        />
                                        <span className="flex-1">
                                            {item.label}
                                        </span>
                                        {item.alert && (
                                            <span
                                                className="size-1.5 rounded-full bg-red-500"
                                                aria-label="확인 필요"
                                            />
                                        )}
                                    </button>
                                );
                            })}
                        </nav>
                    </aside>
                    <section className="flex min-h-0 min-w-0 flex-1 flex-col">
                        <header className="hidden items-start gap-3 border-b border-neutral-100 px-6 py-4 md:flex">
                            <div className="min-w-0 flex-1">
                                <h3 className="text-base font-bold">
                                    {active?.label}
                                </h3>
                                {active?.hint && (
                                    <p className="mt-0.5 text-xs text-neutral-500">
                                        {active.hint}
                                    </p>
                                )}
                            </div>
                            <button
                                type="button"
                                className="icon-btn -mr-2"
                                title="닫기"
                                onClick={onClose}
                            >
                                <X size={18} />
                            </button>
                        </header>
                        {children}
                    </section>
                </div>
            )}
        </dialog>
    );
};

/** 사이드바 모달의 스크롤되는 본문 */
export const ModalBody = ({
    children,
    className,
}: {
    children: ReactNode;
    className?: string;
}) => (
    <div
        className={cn(
            'flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4 sm:px-6 sm:py-5',
            className
        )}
    >
        {children}
    </div>
);

/** 사이드바 모달 아래에 고정되는 버튼 줄 */
export const ModalFooter = ({ children }: { children: ReactNode }) => (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-neutral-100 bg-white px-4 py-3 sm:px-6">
        {children}
    </div>
);

export default Modal;
