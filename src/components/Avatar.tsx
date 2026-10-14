import { imageUrl } from '@shared/images';
import type { Room } from '@/types/chat';
import { cn } from '@utils/cn/cn';
import { agentImage } from '@utils/face/face';

export const Avatar = ({
    emoji,
    color,
    image,
    className,
}: {
    emoji: string;
    color: string;
    /** 있으면 이모지 대신 생성한 얼굴 이미지를 보여준다 */
    image?: string;
    className?: string;
}) =>
    image ? (
        <img
            src={imageUrl(image)}
            alt=""
            className={cn(
                'size-12 shrink-0 rounded-[17px] bg-white object-cover',
                className
            )}
            style={{ background: color }}
        />
    ) : (
        <div
            className={cn(
                'grid size-10 shrink-0 place-items-center rounded-[15px] text-xl',
                className
            )}
            style={{ background: color }}
        >
            {emoji}
        </div>
    );

/** 카톡 단체방처럼 최대 4명의 아바타를 격자로 보여준다 */
export const GroupAvatar = ({ room }: { room: Room }) => {
    const shown = room.agents.slice(0, 4);
    if (shown.length === 0) {
        return (
            <Avatar
                emoji="💬"
                color="#ddd"
                className="size-12 rounded-[18px] text-2xl"
            />
        );
    }
    if (shown.length === 1) {
        return (
            <Avatar
                emoji={shown[0].emoji}
                color={shown[0].color}
                image={agentImage(room, shown[0])}
                className="size-12 rounded-[18px] text-2xl"
            />
        );
    }
    return (
        <div className="grid size-12 shrink-0 grid-cols-2 gap-0.5 overflow-hidden rounded-[18px]">
            {shown.map((a, i) => {
                const image = agentImage(room, a);
                return (
                    <div
                        key={a.id}
                        className={cn(
                            'grid place-items-center overflow-hidden text-[15px]',
                            shown.length === 3 && i === 0 && 'col-span-2'
                        )}
                        style={{ background: a.color }}
                    >
                        {image ? (
                            <img
                                src={imageUrl(image)}
                                alt=""
                                className="size-full object-cover"
                            />
                        ) : (
                            a.emoji
                        )}
                    </div>
                );
            })}
        </div>
    );
};
