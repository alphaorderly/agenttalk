import dayjs from 'dayjs';

/** 카톡식 시간 표기: "오전 9:05" */
export function formatTime(ts: number) {
    const d = dayjs(ts);
    const h = d.hour();
    return `${h < 12 ? '오전' : '오후'} ${h % 12 || 12}:${d.format('mm')}`;
}

/** 채팅 목록: 오늘이면 시간, 아니면 "10월 12일" */
export function formatListTime(ts: number) {
    if (!ts) return '';
    const d = dayjs(ts);
    return d.isSame(dayjs(), 'day') ? formatTime(ts) : d.format('M월 D일');
}

export const sameMinute = (a: number, b: number) =>
    Math.floor(a / 60000) === Math.floor(b / 60000);

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

/** 프롬프트용 현재 시각: "2026년 10월 12일 (월) 오후 6:40" */
export function nowLabel(ts = Date.now()) {
    const d = dayjs(ts);
    return `${d.format('YYYY년 M월 D일')} (${WEEKDAYS[d.day()]}) ${formatTime(ts)}`;
}

/** 브라우저 시간대 (예: "Asia/Seoul"). 알 수 없으면 빈 문자열 */
export function timeZone() {
    try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone ?? '';
    } catch {
        return '';
    }
}
