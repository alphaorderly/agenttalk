import { BadgeCheck } from 'lucide-react';
import { cn } from '@utils/cn/cn';
import type { MafiaRole } from './types';
import { ROLE_ICON, ROLE_TONE } from './visuals';

/** 역할 아이콘 동그라미. notMafia는 경찰 조사로 시민 쪽임을 안 사람 */
const RoleGlyph = ({
    role,
    className,
    iconClassName = 'size-3',
}: {
    role: MafiaRole | 'notMafia';
    className?: string;
    iconClassName?: string;
}) => {
    const Icon = role === 'notMafia' ? BadgeCheck : ROLE_ICON[role];
    return (
        <span
            className={cn(
                'grid shrink-0 place-items-center rounded-full',
                role === 'notMafia' ? 'bg-white text-sky-600' : ROLE_TONE[role],
                className
            )}
        >
            <Icon className={iconClassName} strokeWidth={2.5} />
        </span>
    );
};

export default RoleGlyph;
