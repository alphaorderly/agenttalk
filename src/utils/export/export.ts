import type { OwnerRoomStatus } from '@stores/chat';
import dayjs from 'dayjs';
import type { Room } from '@/types/chat';
import { messageBody, recipientName, senderName } from '@utils/prompt/prompt';
import { formatTime } from '@utils/time/time';
import { modeOf } from '@/modes';

export type ExportFormat = 'txt' | 'json';

const stamp = (ts: number) =>
    `${dayjs(ts).format('YYYY-MM-DD')} ${formatTime(ts)}`;

/** 사람이 읽기 좋은 대화 기록. 귓속말·시스템 메시지·비밀 정보까지 남겨 복기할 수 있게 한다 */
export function roomToText(
    room: Room,
    userName: string,
    ownerStatus?: OwnerRoomStatus
) {
    const lines = [
        `[${room.name}] 대화 기록`,
        `내보낸 시각: ${stamp(Date.now())}`,
    ];
    if (room.topic.trim()) lines.push('', '■ 대화 상황', room.topic.trim());

    lines.push('', '■ 멤버', `- ${userName} (방장)`);
    for (const a of room.agents) {
        lines.push(`- ${a.emoji} ${a.name}`);
        if (a.persona.trim())
            lines.push(
                ...a.persona
                    .trim()
                    .split('\n')
                    .map((l) => `    ${l}`)
            );
        if (a.style?.trim())
            lines.push(
                ...`💬 말투: ${a.style.trim()}`
                    .split('\n')
                    .map((l) => `    ${l}`)
            );
        if (a.relations?.trim())
            lines.push(`    🤝 관계·요즘: ${a.relations.trim()}`);
        if (a.secret?.trim()) lines.push(`    🔒 비밀: ${a.secret.trim()}`);
        if (a.feeling?.trim())
            lines.push(`    💭 지금 감정: ${a.feeling.trim()}`);
        for (const memory of a.memories ?? [])
            lines.push(`    🧠 기억: ${memory}`);
    }

    lines.push(...modeOf(room).exportLines(room));

    if (typeof ownerStatus?.summary?.markdown === 'string') {
        lines.push(
            '',
            '■ 방장 전용 메모',
            `갱신: ${stamp(ownerStatus.updatedAt)}`,
            `모델: ${ownerStatus.via}`,
            ownerStatus.summary.markdown.trim()
        );
    }

    lines.push('', '■ 대화');
    if (room.messages.length === 0) lines.push('(대화 없음)');
    for (const m of room.messages) {
        if (m.sender === 'system') {
            lines.push(`[${stamp(m.ts)}] ※ ${m.text}`);
            continue;
        }
        const to = m.to?.length
            ? ` → ${m.to.map((id) => recipientName(room, id, userName)).join(', ')} (귓속말)`
            : '';
        lines.push(
            `[${stamp(m.ts)}] ${senderName(room, m, userName)}${to}: ${messageBody(m)}`
        );
        for (const s of m.sources ?? [])
            lines.push(`    🔗 ${s.title} ${s.url}`);
    }
    return lines.join('\n') + '\n';
}

/** 방 전체 데이터(설정 + 메시지)를 그대로 담은 JSON */
export function roomToJson(
    room: Room,
    userName: string,
    ownerStatus?: OwnerRoomStatus
) {
    return (
        JSON.stringify(
            {
                app: 'agenttalk',
                exportedAt: Date.now(),
                userName,
                room,
                ...(ownerStatus ? { ownerStatus } : {}),
            },
            null,
            2
        ) + '\n'
    );
}

/** 파일 이름에 쓸 수 없는 문자를 걷어낸 "방이름_20261012-1322.txt" */
export function exportFileName(
    room: Room,
    format: ExportFormat,
    ts = Date.now()
) {
    const base =
        room.name.replace(/[\\/:*?"<>|\s]+/g, '_').replace(/^_+|_+$/g, '') ||
        'chat';
    return `${base}_${dayjs(ts).format('YYYYMMDD-HHmm')}.${format}`;
}

export function downloadRoom(
    room: Room,
    userName: string,
    format: ExportFormat,
    ownerStatus?: OwnerRoomStatus
) {
    const body =
        format === 'txt'
            ? roomToText(room, userName, ownerStatus)
            : roomToJson(room, userName, ownerStatus);
    const type =
        format === 'txt' ? 'text/plain;charset=utf-8' : 'application/json';
    const url = URL.createObjectURL(new Blob([body], { type }));
    const a = document.createElement('a');
    a.href = url;
    a.download = exportFileName(room, format);
    a.click();
    // 다운로드가 시작될 시간을 준 뒤 해제한다
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}
