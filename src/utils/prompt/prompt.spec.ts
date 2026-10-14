import { describe, expect, it } from 'vitest';
import type { Agent, Room } from '@/types/chat';
import {
    addressedAgents,
    agentStreak,
    buildPrompt,
    extractExpression,
    extractVote,
    introLine,
    isPass,
    lastSpeaker,
    mentionedAgents,
    moderatorNoteFor,
    moderatorTranscript,
    moderatorRequestContext,
    parseImageLine,
    parseWhisper,
    splitReply,
    type TurnContext,
} from './prompt';

const agent = (id: string, name: string): Agent => ({
    id,
    name,
    emoji: '🙂',
    color: '#fff',
    persona: '',
    profileId: null,
    model: '',
});

const room = (overrides: Partial<Room> = {}): Room => ({
    id: 'r',
    name: '방',
    topic: '주제',
    profileId: null,
    agents: [agent('a', '철수'), agent('b', '영희'), agent('c', '민수')],
    messages: [],
    updatedAt: 0,
    ...overrides,
});

describe('agentStreak', () => {
    it('counts agent messages since the last human message', () => {
        const r = room({
            messages: [
                { id: '1', sender: 'a', text: '1', ts: 1 },
                { id: '2', sender: 'me', text: '2', ts: 2 },
                { id: '3', sender: 'b', text: '3', ts: 3 },
                { id: '4', sender: 'system', text: '!', ts: 4 },
                { id: '5', sender: 'c', text: '5', ts: 5 },
            ],
        });
        expect(agentStreak(r)).toBe(2);
        expect(agentStreak(r, 4)).toBe(1);
    });

    it('counts consecutive bubbles from one agent as a single turn', () => {
        const r = room({
            messages: [
                { id: '1', sender: 'me', text: '1', ts: 1 },
                { id: '2', sender: 'a', text: '2', ts: 2 },
                { id: '3', sender: 'a', text: '3', ts: 3 },
                { id: '4', sender: 'b', text: '4', ts: 4 },
            ],
        });
        expect(agentStreak(r)).toBe(2);
    });
});

describe('lastSpeaker', () => {
    it('skips system notes', () => {
        const r = room({
            messages: [
                { id: '1', sender: 'b', text: '1', ts: 0 },
                { id: '2', sender: 'a', text: '2', ts: 0 },
                { id: '3', sender: 'system', text: '!', ts: 0 },
            ],
        });
        expect(lastSpeaker(r)).toBe('a');
        expect(lastSpeaker(room())).toBeNull();
    });
});

describe('moderatorTranscript', () => {
    it('uses display names and skips system messages', () => {
        const r = room({
            messages: [
                { id: '1', sender: 'me', text: '안녕', ts: 0 },
                { id: '2', sender: 'system', text: '오류', ts: 0 },
                { id: '3', sender: 'b', text: '반가워', ts: 0 },
            ],
        });
        expect(moderatorTranscript(r, '하늘')).toEqual([
            { speaker: '하늘', text: '안녕' },
            { speaker: '영희', text: '반가워' },
        ]);
    });
});

const ctx = (overrides: Partial<TurnContext> = {}): TurnContext => ({
    userName: '하늘',
    now: '2026년 10월 12일 (월) 오후 6:40',
    location: '부산',
    note: '',
    ...overrides,
});

describe('buildPrompt', () => {
    it('sends the whole chat as one log instead of user/assistant turns', () => {
        const r = room({
            messages: [
                { id: '1', sender: 'a', text: '안녕', ts: 0 },
                { id: '2', sender: 'b', text: '반가워', ts: 0 },
                { id: '3', sender: 'me', text: '나도', ts: 0 },
                { id: '4', sender: 'system', text: '시스템', ts: 0 },
            ],
        });
        const { messages, instructions } = buildPrompt(r, r.agents[0], ctx());
        expect(instructions).toContain('"철수"');
        // 매번 바뀌는 시각·지역은 instructions가 아니라 로그 아래에 둔다
        expect(instructions).not.toContain('오후 6:40');
        expect(instructions).not.toContain('부산');
        expect(messages[0].content).toContain(
            '지금: 2026년 10월 12일 (월) 오후 6:40'
        );
        expect(messages[0].content).toContain('하늘의 지역: 부산');
        expect(messages).toHaveLength(1);
        expect(messages[0].role).toBe('user');
        expect(messages[0].content).toContain(
            '철수: 안녕\n영희: 반가워\n하늘: 나도'
        );
        expect(messages[0].content).not.toContain('시스템');
        expect(messages[0].content).toMatch(/철수의 다음 카톡:$/);
    });

    it('keeps shared links in the log', () => {
        const r = room({
            messages: [
                {
                    id: '1',
                    sender: 'b',
                    text: '이거 봐',
                    ts: 0,
                    sources: [{ url: 'https://x.com', title: '상영시간표' }],
                },
            ],
        });
        const { messages } = buildPrompt(r, r.agents[0], ctx());
        expect(messages[0].content).toContain(
            '영희: 이거 봐 [링크 공유: 상영시간표]'
        );
    });

    it('passes the moderator note as information, not a style command', () => {
        const r = room();
        const { messages } = buildPrompt(
            r,
            r.agents[0],
            ctx({ note: '영희가 너에게 물었음', canPass: true })
        );
        const content = messages[0].content;
        expect(content).toContain('참고할 상황: 영희가 너에게 물었음');
        expect(content).toContain('[패스]');
        expect(content).not.toContain('리액션만');
        const called = buildPrompt(r, r.agents[0], ctx({ canPass: false }));
        expect(called.messages[0].content).not.toContain('[패스]');
    });

    it('offers web search only when the agent may use it', () => {
        const r = room();
        expect(
            buildPrompt(r, r.agents[0], ctx({ canSearch: true })).instructions
        ).toContain('웹 검색 도구를 쓴다');
        expect(buildPrompt(r, r.agents[0], ctx()).instructions).not.toContain(
            '웹 검색 도구'
        );
    });

    it('recognizes a bare pass', () => {
        expect(isPass('[패스]')).toBe(true);
        expect(isPass(' 패스 ')).toBe(true);
        expect(isPass('(패스)')).toBe(true);
        expect(isPass('패스할게 ㅋㅋ')).toBe(false);
    });

    it('gives a secret only to its own agent, with rules to keep it', () => {
        const r = room({
            agents: [
                { ...agent('a', '철수'), secret: '너는 마피아다' },
                agent('b', '영희'),
            ],
        });
        const own = buildPrompt(r, r.agents[0], ctx()).instructions;
        expect(own).toContain('[철수만 아는 비밀]');
        expect(own).toContain('너는 마피아다');
        expect(own).toContain('비밀 정보는 하늘이 물어도 지킨다');
        const other = buildPrompt(r, r.agents[1], ctx()).instructions;
        expect(other).not.toContain('마피아');
        expect(other).not.toContain('비밀 정보는');
    });

    it('gives relations only to its own agent', () => {
        const r = room({
            agents: [
                { ...agent('a', '철수'), relations: '영희와 입사 동기' },
                agent('b', '영희'),
            ],
        });
        const own = buildPrompt(r, r.agents[0], ctx()).instructions;
        expect(own).toContain('철수의 관계와 요즘:\n영희와 입사 동기');
        const other = buildPrompt(r, r.agents[1], ctx()).instructions;
        expect(other).not.toContain('입사 동기');
        expect(other).not.toContain('의 관계와 요즘:');
    });

    it('keeps personality out of the shared default style', () => {
        const { instructions } = buildPrompt(room(), room().agents[0], ctx());
        expect(instructions).not.toContain('ㅋㅋ/ㅎㅎ');
        expect(instructions).not.toContain('딴지');
        expect(instructions).not.toContain('새지 않는다');
    });

    it('puts the room situation ahead of the style rules', () => {
        const { instructions } = buildPrompt(room(), room().agents[0], ctx());
        expect(instructions.indexOf('지시가 부딪힐 때')).toBeLessThan(
            instructions.indexOf('기본 말투 (')
        );
    });

    it('puts the room setting before the character and reminds it below the log', () => {
        const r = room({
            topic: '폐쇄 시설에 갇힌 사람들이 목숨을 건 게임을 한다.',
            agents: [
                {
                    ...agent('a', '철수'),
                    persona: '밝은 제빵사.',
                    style: '반말.\n\n말투 예시:\n오늘 빵 대박임',
                },
                agent('b', '영희'),
            ],
        });
        const { instructions, messages } = buildPrompt(r, r.agents[0], ctx());
        expect(instructions.indexOf(r.topic)).toBeLessThan(
            instructions.indexOf('밝은 제빵사.')
        );
        expect(instructions).toContain('상황 설정 따르기:');
        expect(instructions).toContain('예시 문장이 적혀 있어도');
        expect(messages[0].content).toContain('잊지 말 것:');

        const blank = room({ topic: '' });
        const none = buildPrompt(blank, blank.agents[0], ctx());
        expect(none.instructions).not.toContain('상황 설정 따르기:');
        expect(none.messages[0].content).not.toContain('잊지 말 것:');
    });

    it('uses the default chat style only when the agent has no style of its own', () => {
        const plain = buildPrompt(room(), room().agents[0], ctx()).instructions;
        expect(plain).toContain('기본 말투 (');
        expect(plain).toContain('기본 규칙:');

        const r = room({
            agents: [
                { ...agent('a', '철수'), style: '존댓말로 길게 설명한다.' },
                agent('b', '영희'),
            ],
        });
        const own = buildPrompt(r, r.agents[0], ctx()).instructions;
        expect(own).toContain('철수의 말투와 행동:\n존댓말로 길게 설명한다.');
        expect(own).not.toContain('기본 말투 (');
        expect(own).not.toContain('ㅋㅋ/ㅎㅎ');
        // 늘 지키는 규칙은 그대로 남는다
        expect(own).toContain('기본 규칙:');
        expect(own).toContain('부르기 · 귓속말');
    });

    it('shows other members only by their one-line intro, never their style', () => {
        const r = room({
            agents: [
                agent('a', '철수'),
                {
                    ...agent('b', '영희'),
                    persona:
                        '꼼꼼한 PM. 예산을 따진다.\n\n말투 예시:\n그거 얼마임',
                    style: '반말 비밀 말버릇',
                },
            ],
        });
        const { instructions } = buildPrompt(r, r.agents[0], ctx());
        expect(instructions).toContain('- 영희: 꼼꼼한 PM.');
        expect(instructions).not.toContain('예산을 따진다');
        expect(instructions).not.toContain('그거 얼마임');
        expect(instructions).not.toContain('비밀 말버릇');
        expect(instructions).toContain('- 하늘: 사람. 이 방의 방장');
    });

    it.each<{
        label: string;
        settings: Partial<Room>;
        shared: boolean;
    }>([
        { label: 'legacy chat defaults', settings: {}, shared: true },
        {
            label: 'legacy chat explicit public',
            settings: { shareIntroductions: true },
            shared: true,
        },
        {
            label: 'legacy chat explicit private',
            settings: { shareIntroductions: false },
            shared: false,
        },
        { label: 'chat defaults', settings: { mode: 'chat' }, shared: true },
        {
            label: 'chat explicit public',
            settings: { mode: 'chat', shareIntroductions: true },
            shared: true,
        },
        {
            label: 'chat explicit private',
            settings: { mode: 'chat', shareIntroductions: false },
            shared: false,
        },
        { label: 'mafia defaults', settings: { mode: 'mafia' }, shared: false },
        {
            label: 'mafia explicit public',
            settings: { mode: 'mafia', shareIntroductions: true },
            shared: true,
        },
        {
            label: 'mafia explicit private',
            settings: { mode: 'mafia', shareIntroductions: false },
            shared: false,
        },
    ])(
        "respects $label without changing the agent's own settings",
        ({ settings, shared }) => {
            const r = room({
                ...settings,
                agents: [
                    {
                        ...agent('a', '철수'),
                        persona:
                            '차분한 사서. 오래된 책을 모은다.\n고전 소설을 좋아한다.',
                        style: '또박또박 존댓말로 이야기한다.',
                        secret: '숨겨 둔 편지가 있다.',
                    },
                    {
                        ...agent('b', '영희'),
                        persona: '호기심 많은 탐정. 사건 자료를 모은다.',
                        style: '수첩을 펼치며 답한다.',
                        secret: '서랍 속 열쇠를 숨겼다.',
                    },
                ],
            });
            const { instructions } = buildPrompt(r, r.agents[0], ctx());

            expect(instructions).toContain(r.agents[0].persona);
            expect(instructions).toContain(r.agents[0].style);
            expect(instructions).toContain(r.agents[0].secret);
            expect(instructions).not.toContain('사건 자료를 모은다');
            expect(instructions).not.toContain(r.agents[1].style);
            expect(instructions).not.toContain(r.agents[1].secret);
            if (shared) {
                expect(instructions).toContain('- 영희: 호기심 많은 탐정.');
            } else {
                expect(instructions).toContain('\n- 영희\n');
                expect(instructions).not.toContain('호기심 많은 탐정');
            }
        }
    );

    it('keeps introductions already spoken in the visible chat history when sharing is private', () => {
        const r = room({
            shareIntroductions: false,
            agents: [
                agent('a', '철수'),
                { ...agent('b', '영희'), persona: '호기심 많은 탐정.' },
            ],
            messages: [
                {
                    id: 'intro',
                    sender: 'b',
                    text: '안녕, 나는 탐정이야.',
                    ts: 0,
                },
            ],
        });
        const { instructions, messages } = buildPrompt(r, r.agents[0], ctx());
        expect(instructions).not.toContain('호기심 많은 탐정');
        expect(messages[0].content).toContain('영희: 안녕, 나는 탐정이야.');
    });
});

describe('introLine', () => {
    it('takes the first sentence of the first line and caps its length', () => {
        expect(introLine('낙천적인 개발자. 새로운 걸 좋아함.')).toBe(
            '낙천적인 개발자.'
        );
        expect(introLine('마침표 없는 소개\n둘째 줄')).toBe('마침표 없는 소개');
        expect(introLine('')).toBe('');
        expect(introLine('가'.repeat(100), 10)).toBe(`${'가'.repeat(10)}…`);
    });
});

describe('splitReply', () => {
    const r = room();
    const a = r.agents[0];

    it('splits lines into bubbles and strips the own name prefix', () => {
        expect(
            splitReply('철수: 난 웃긴 거\n\n"잔인한 건 패스"', r, a, '하늘')
        ).toEqual(['난 웃긴 거', '잔인한 건 패스']);
        expect(splitReply('[철수]： 안녕 ', r, a, '하늘')).toEqual(['안녕']);
    });

    it('stops when the model starts writing someone else', () => {
        expect(splitReply('ㅋㅋ\n영희: 그치\n또', r, a, '하늘')).toEqual([
            'ㅋㅋ',
        ]);
        expect(splitReply('ㅋㅋ\n하늘: 뭐야', r, a, '하늘')).toEqual(['ㅋㅋ']);
    });

    it('removes inline citation links', () => {
        expect(
            splitReply(
                '인턴 뜨네 ([moviebara.com](https://moviebara.com/c?utm=1))\n[여기](https://a.com) 봐 https://b.com',
                r,
                a,
                '하늘'
            )
        ).toEqual(['인턴 뜨네', '여기 봐']);
    });

    it('caps the number of bubbles', () => {
        expect(splitReply('1\n2\n3\n4', r, a, '하늘', 2)).toEqual(['1', '2']);
    });
});

describe('parseWhisper', () => {
    const r = room({
        agents: [agent('a', '철수'), agent('a2', '철수2'), agent('b', '영희')],
    });

    it('reads leading @@ recipients and strips them from the text', () => {
        expect(parseWhisper('@@영희 @@철수 비밀인데', r, '나', 'me')).toEqual({
            to: ['b', 'a'],
            text: '비밀인데',
        });
    });

    it('prefers the longest matching name', () => {
        expect(parseWhisper('@@철수2 야', r, '나', 'me').to).toEqual(['a2']);
    });

    it('keeps a name glued to the following word in the text', () => {
        expect(parseWhisper('@@철수야 비밀', r, '나', 'me')).toEqual({
            to: ['a'],
            text: '철수야 비밀',
        });
    });

    it('lets agents whisper to the user and ignores themselves', () => {
        expect(parseWhisper('@@나 @@철수 ㅋㅋ', r, '나', 'a').to).toEqual([
            'me',
        ]);
    });

    it('leaves public messages and unknown names alone', () => {
        expect(parseWhisper('@철수 안녕', r, '나', 'me')).toEqual({
            text: '@철수 안녕',
        });
        expect(parseWhisper('@@누구 안녕', r, '나', 'me')).toEqual({
            text: '@@누구 안녕',
        });
    });
});

describe('mentionedAgents / addressedAgents', () => {
    it('limits whispered calls to actual recipients despite other @ mentions', () => {
        const r = room({
            messages: [
                {
                    id: '1',
                    sender: 'me',
                    text: '@철수는 어떻게 생각해?',
                    ts: 1,
                    to: ['b'],
                },
            ],
        });
        expect(addressedAgents(r)).toEqual(['b']);
        r.messages[0].to = [];
        expect(addressedAgents(r)).toEqual(['a']);
    });

    it('finds public @ mentions but not whispers', () => {
        const r = room();
        expect(mentionedAgents('@영희 이거 봐 @@민수', r)).toEqual(['b']);
    });

    it('returns who the latest user message addressed', () => {
        const r = room({
            messages: [{ id: '1', sender: 'me', text: '야', ts: 1, to: ['c'] }],
        });
        expect(addressedAgents(r)).toEqual(['c']);
        r.messages.push({ id: '2', sender: 'c', text: 'ㅇㅇ', ts: 2 });
        expect(addressedAgents(r)).toBeNull();
    });
});

describe('whisper visibility', () => {
    const ctx: TurnContext = {
        userName: '나',
        now: '지금',
        location: '',
        note: '',
    };
    const r = room({
        messages: [
            { id: '1', sender: 'me', text: '공개', ts: 1 },
            { id: '2', sender: 'a', text: '비밀', ts: 2, to: ['b'] },
        ],
    });

    it('hides whispers from agents who are not part of them', () => {
        const content = buildPrompt(r, r.agents[2], ctx).messages[0].content;
        expect(content).toContain('나: 공개');
        expect(content).not.toContain('비밀');
    });

    it('shows whispers to the recipient and hints a whispered reply', () => {
        const content = buildPrompt(r, r.agents[1], ctx).messages[0].content;
        expect(content).toContain('철수 → 영희 (귓속말): 비밀');
        expect(content).toContain('"@@철수 "');
    });

    it('gives the moderator every whisper with its recipients', () => {
        expect(moderatorTranscript(r, '나')[1]).toEqual({
            speaker: '철수',
            text: '비밀',
            to: ['영희'],
        });
    });
});

describe('moderatorRequestContext', () => {
    it('keeps the latest human request and unique responders beyond the recent log', () => {
        const r = room({
            messages: [
                { id: 'old', sender: 'me', text: '이전 질문', ts: 0 },
                {
                    id: 'request',
                    sender: 'me',
                    text: '전원 소감을 한 명씩 말해줘',
                    ts: 1,
                },
                ...Array.from({ length: 35 }, (_, i) => ({
                    id: `a${i}`,
                    sender: 'a',
                    text: '소감',
                    ts: i + 2,
                })),
                { id: 'sys', sender: 'system', text: '오류', ts: 37 },
                { id: 'err', sender: 'c', text: '오류', error: true, ts: 38 },
                { id: 'b', sender: 'b', text: '내 소감', ts: 39 },
            ],
        });
        expect(moderatorTranscript(r, '나')).not.toContainEqual({
            speaker: '나',
            text: '전원 소감을 한 명씩 말해줘',
        });
        expect(moderatorRequestContext(r, '나')).toEqual({
            latestUserRequest: {
                id: 'request',
                text: '전원 소감을 한 명씩 말해줘',
            },
            respondedMembers: [
                { id: 'a', name: '철수' },
                { id: 'b', name: '영희' },
            ],
        });
    });

    it('preserves private recipients and resets responders for a new human request', () => {
        const r = room({
            messages: [
                {
                    id: '1',
                    sender: 'me',
                    text: '모두 답해 @철수',
                    to: ['b'],
                    ts: 1,
                },
                { id: '2', sender: 'b', text: 'ㅇㅇ', ts: 2 },
                { id: '3', sender: 'me', text: '다음 질문', ts: 3 },
            ],
        });
        expect(moderatorRequestContext(r, '나').respondedMembers).toEqual([]);
        r.messages.pop();
        expect(moderatorRequestContext(r, '나').latestUserRequest).toEqual({
            id: '1',
            text: '모두 답해 @철수',
            to: ['영희'],
        });
    });

    it('does not include member secrets or owner summaries', () => {
        const r = room({
            agents: [{ ...agent('a', '철수'), secret: '역할 비밀' }],
        });
        expect(moderatorRequestContext(r, '나')).toEqual({
            latestUserRequest: null,
            respondedMembers: [],
        });
        expect(JSON.stringify(moderatorRequestContext(r, '나'))).not.toContain(
            '역할 비밀'
        );
    });
});

describe('images and expressions', () => {
    it('strips expression tags, keeps the last known label and ignores unknown ones', () => {
        expect(extractExpression('[표정:기쁨]\nㅋㅋ 좋다')).toEqual({
            text: '\nㅋㅋ 좋다',
            expression: '기쁨',
        });
        expect(
            extractExpression('[표정: 슬픔] 아 진짜 (표정：화남) 어이없네')
                .expression
        ).toBe('화남');
        expect(extractExpression('[표정:행복함] 음')).toEqual({
            text: ' 음',
            expression: null,
        });
        expect(extractExpression('표정 관리 안 됨 ㅋㅋ').expression).toBeNull();
    });

    it('reads a photo line only when the whole bubble is the tag', () => {
        expect(parseImageLine('[이미지: 노을 지는 한강 사진]')).toBe(
            '노을 지는 한강 사진'
        );
        expect(parseImageLine(' [그림：고양이 낙서] ')).toBe('고양이 낙서');
        expect(parseImageLine('이거 봐 [이미지: 고양이]')).toBeNull();
        expect(parseImageLine('[이미지: ]')).toBeNull();
    });

    it('describes photos to other members and only offers tags that are enabled', () => {
        const r = room({
            messages: [
                {
                    id: '1',
                    sender: 'b',
                    text: '',
                    ts: 0,
                    image: { id: 'x', prompt: '김치찌개 사진' },
                },
            ],
        });
        const plain = buildPrompt(r, r.agents[0], ctx());
        expect(plain.messages[0].content).toContain(
            '영희: [사진: 김치찌개 사진]'
        );
        expect(plain.instructions).not.toContain('[이미지:');
        expect(plain.instructions).not.toContain('[표정:');

        const rich = buildPrompt(r, r.agents[0], {
            ...ctx(),
            canDraw: true,
            expression: '기쁨',
        });
        expect(rich.instructions).toContain('[이미지:');
        expect(rich.instructions).toContain('[표정:');
        expect(rich.instructions).not.toContain('기쁨"');
        expect(rich.messages[0].content).toContain('지금 네 표정: 기쁨');
        expect(rich.messages[0].content).toMatch(/\[표정:…\]\):$/);
        expect(moderatorTranscript(r, '하늘')[0].text).toBe(
            '[사진: 김치찌개 사진]'
        );
    });
});

describe('polls in prompts', () => {
    it('reads the first valid vote tag and strips all of them', () => {
        expect(extractVote('[투표:3]\n좋아', 2)).toEqual({
            text: '\n좋아',
            choice: null,
        });
        expect(extractVote('(투표: 2번) 짬뽕 [투표:1]', 2)).toEqual({
            text: ' 짬뽕 ',
            choice: 1,
        });
    });

    it('shows poll results to the moderator but only to agents who already voted', () => {
        const r = room({
            messages: [
                {
                    id: 'p',
                    sender: 'me',
                    text: '점심?',
                    ts: 0,
                    poll: {
                        question: '점심?',
                        options: ['짜장', '짬뽕'],
                        votes: [{ voter: 'a', name: '철수', choice: 1 }],
                    },
                },
            ],
        });
        const voted = buildPrompt(r, r.agents[0], ctx()).messages[0].content;
        const notYet = buildPrompt(r, r.agents[1], ctx()).messages[0].content;
        expect(voted).toContain('2) 짬뽕 — 철수');
        expect(notYet).toContain('결과는 투표하면 보임');
        expect(notYet).not.toContain('짬뽕 — 철수');
        expect(moderatorTranscript(r, '하늘')[0].text).toContain(
            '2) 짬뽕 — 철수'
        );
    });
});

describe('moderatorNoteFor', () => {
    const whisper = (overrides: Partial<Room['messages'][number]> = {}) => ({
        id: 'w',
        sender: 'a',
        to: ['b'],
        text: '나 마피아야',
        ts: 0,
        ...overrides,
    });

    it('keeps the note for whisper parties and drops it for everyone else', () => {
        const r = room({
            messages: [
                { id: '1', sender: 'me', text: '시작', ts: 0 },
                whisper(),
            ],
        });
        expect(moderatorNoteFor(r, 'a', '메모')).toBe('메모');
        expect(moderatorNoteFor(r, 'b', '메모')).toBe('메모');
        expect(moderatorNoteFor(r, 'c', '철수는 마피아')).toBe('');
    });

    it('drops the note for a user whisper the speaker did not receive', () => {
        const r = room({
            messages: [whisper({ sender: 'me', to: ['a'] })],
        });
        expect(moderatorNoteFor(r, 'a', '메모')).toBe('메모');
        expect(moderatorNoteFor(r, 'b', '메모')).toBe('');
    });

    it('still guards whispers pushed out of the recent log but sent after the last human request', () => {
        const filler = Array.from({ length: 40 }, (_, i) => ({
            id: `f${i}`,
            sender: 'b',
            text: `잡담 ${i}`,
            ts: 0,
        }));
        const r = room({
            messages: [
                { id: 'h', sender: 'me', text: '다들 한 명씩', ts: 0 },
                whisper(),
                ...filler,
            ],
        });
        expect(JSON.stringify(moderatorTranscript(r, '하늘'))).not.toContain(
            '마피아'
        );
        expect(moderatorNoteFor(r, 'c', '메모')).toBe('');
    });

    it('allows notes again once the whisper is outside everything the moderator saw', () => {
        const filler = Array.from({ length: 40 }, (_, i) => ({
            id: `f${i}`,
            sender: 'b',
            text: `잡담 ${i}`,
            ts: 0,
        }));
        const r = room({
            messages: [
                whisper(),
                { id: 'h', sender: 'me', text: '새 얘기', ts: 0 },
                ...filler,
            ],
        });
        expect(moderatorNoteFor(r, 'c', '메모')).toBe('메모');
    });

    it('treats poll results as hidden from members who have not voted', () => {
        const r = room({
            messages: [
                {
                    id: 'p',
                    sender: 'me',
                    text: '점심?',
                    ts: 0,
                    poll: {
                        question: '점심?',
                        options: ['짜장', '짬뽕'],
                        votes: [{ voter: 'a', name: '철수', choice: 0 }],
                    },
                },
            ],
        });
        expect(moderatorNoteFor(r, 'a', '메모')).toBe('메모');
        expect(moderatorNoteFor(r, 'b', '철수는 짜장')).toBe('');
    });
});
