import type { Room } from '@/types/chat';
import RoleGlyph from './RoleGlyph';
import { ROLE_LABELS, knownRole } from './rules';

/**
 * 말풍선 위 이름 옆의 역할 표시. knownRole을 따르므로 플레이어로 참가 중이면
 * 내 역할로 알 수 있는 사람(같은 마피아, 조사 결과, 공개된 죽음)만 보인다.
 */
const MafiaSenderTag = ({
    room,
    senderId,
}: {
    room: Room;
    senderId: string;
}) => {
    const role = knownRole(room, 'me', senderId);
    if (!role) return null;
    const label = role === 'notMafia' ? '시민 쪽' : ROLE_LABELS[role];
    return (
        <span className="ml-1.5 inline-flex translate-y-[-1px] items-center gap-1 rounded-full bg-white/70 py-px pr-1.5 pl-px align-middle text-[10.5px] font-semibold text-neutral-700">
            <RoleGlyph
                role={role}
                className="size-3.5"
                iconClassName="size-[9px]"
            />
            {label}
        </span>
    );
};

export default MafiaSenderTag;
