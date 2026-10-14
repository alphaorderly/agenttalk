import type { OwnerRoomStatus } from '@stores/chat';
import { describe, expect, it } from 'vitest';
import type { Room } from '@/types/chat';
import { exportFileName, roomToJson, roomToText } from './export';

const room = (): Room => ({
    id: 'r',
    name: '마피아 / 1판',
    topic: '마피아 게임',
    profileId: null,
    agents: [
        {
            id: 'a',
            name: '철수',
            emoji: '🐶',
            color: '#fff',
            persona: '수다쟁이',
            secret: '너는 마피아다',
            profileId: null,
            model: '',
        },
        {
            id: 'b',
            name: '영희',
            emoji: '🐱',
            color: '#fff',
            persona: '',
            profileId: null,
            model: '',
        },
    ],
    messages: [
        { id: '1', sender: 'me', text: '시작!', ts: 0 },
        { id: '2', sender: 'a', text: '난 시민임', ts: 0 },
        { id: '3', sender: 'a', text: '영희 찍자', ts: 0, to: ['me'] },
        { id: '4', sender: 'system', text: '오류', ts: 0, error: true },
        {
            id: '5',
            sender: 'b',
            text: '이거 봐',
            ts: 0,
            sources: [{ url: 'https://x.com', title: '규칙' }],
        },
    ],
    updatedAt: 0,
});

describe('roomToText', () => {
    it('writes topic, members with secrets, whispers, system lines and links', () => {
        const t = roomToText(room(), '하늘');
        expect(t).toContain('■ 대화 상황\n마피아 게임');
        expect(t).toContain('- 하늘 (방장)');
        expect(t).toContain(
            '- 🐶 철수\n    수다쟁이\n    🔒 비밀: 너는 마피아다'
        );
        expect(t).toMatch(/\] 하늘: 시작!/);
        expect(t).toMatch(/\] 철수: 난 시민임/);
        expect(t).toMatch(/\] 철수 → 하늘 \(귓속말\): 영희 찍자/);
        expect(t).toMatch(/\] ※ 오류/);
        expect(t).toContain('    🔗 규칙 https://x.com');
    });
});

describe('roomToJson', () => {
    it('keeps the whole room', () => {
        const data = JSON.parse(roomToJson(room(), '하늘'));
        expect(data.app).toBe('agenttalk');
        expect(data.userName).toBe('하늘');
        expect(data.room.messages).toHaveLength(5);
        expect(data.room.agents[0].secret).toBe('너는 마피아다');
    });
});

describe('exportFileName', () => {
    it('strips characters that are not allowed in file names', () => {
        const ts = new Date(2026, 9, 12, 13, 22).getTime();
        expect(exportFileName(room(), 'txt', ts)).toBe(
            '마피아_1판_20261012-1322.txt'
        );
        expect(exportFileName({ ...room(), name: '///' }, 'json', ts)).toBe(
            'chat_20261012-1322.json'
        );
    });
});

const ownerStatus: OwnerRoomStatus = {
    summary: {
        markdown:
            '## 지금 상황\n- 게임 종료 · 시민 승리\n- 🔒 철수가 마피아였음',
    },
    via: 'mock',
    updatedAt: 0,
    inputKey: 'test',
    messageIds: ['1'],
    messageSignature: 'test',
};

describe('owner-only summary export', () => {
    it('exports an optional summary alongside the room rather than in participant messages', () => {
        const r = room();
        const data = JSON.parse(roomToJson(r, '하늘', ownerStatus));
        expect(data.ownerStatus).toEqual(ownerStatus);
        expect(data.room).toEqual(r);
        expect(data.room.ownerStatus).toBeUndefined();
        expect(JSON.parse(roomToJson(r, '하늘')).ownerStatus).toBeUndefined();
    });
    it('includes the owner-only markdown memo in readable text', () => {
        const text = roomToText(room(), '하늘', ownerStatus);
        expect(text).toContain('■ 방장 전용 메모');
        expect(text).toContain('- 🔒 철수가 마피아였음');
        expect(roomToText(room(), '하늘')).not.toContain('■ 방장 전용 메모');
    });
});
