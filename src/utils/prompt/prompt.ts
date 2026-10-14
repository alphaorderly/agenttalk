import { EXPRESSIONS, isExpression } from '@shared/images';
import type { ChatRequest, ModerateRequest } from '@shared/providers';
import type { Agent, Message, Poll, Room } from '@/types/chat';
import { modeOf, shareIntroductionsOf } from '@/modes';
import { MIND_RULES, mindContext } from '@utils/mind/mind';

const HISTORY_LIMIT = 40;

export function senderName(room: Room, m: Message, userName: string) {
    if (m.sender === 'me') return userName;
    if (m.sender === 'system') return '진행';
    return (
        room.agents.find((a) => a.id === m.sender)?.name ??
        m.senderName ??
        '(나간 멤버)'
    );
}

/** 귓속말 대상 표시 ('me' | agent.id → 이름) */
export function recipientName(room: Room, id: string, userName: string) {
    if (id === 'me') return userName;
    return room.agents.find((a) => a.id === id)?.name ?? '(나간 멤버)';
}

/** 이 메시지를 viewer('me' | agent.id)가 볼 수 있는지. 사용자는 모든 귓속말을 본다 */
export function canSee(m: Message, viewer: string) {
    return (
        !m.to?.length ||
        viewer === 'me' ||
        m.sender === viewer ||
        m.to.includes(viewer)
    );
}

/** 이름으로 부를 수 있는 사람들. 긴 이름부터 맞춰야 "철수"와 "철수2"를 구분한다 */
function addressBook(room: Room, userName: string) {
    return [
        ...room.agents.map((a) => ({ id: a.id, name: a.name })),
        ...(userName ? [{ id: 'me', name: userName }] : []),
    ]
        .filter((e) => e.name)
        .sort((a, b) => b.name.length - a.name.length);
}

const SEPARATOR = /^[\s,，]+/;

/**
 * 메시지 맨 앞의 귓속말 표시(`@@이름`, 여러 명이면 `@@철수 @@영희`)를 읽는다.
 * - 받는 사람 id와 표시를 뗀 본문을 돌려준다. 귓속말이 아니면 to는 undefined
 * - "@@철수야 비밀인데"처럼 이름 뒤에 바로 글자가 붙으면 이름은 본문에 남긴다
 * - 자기 자신은 받는 사람에서 뺀다
 */
export function parseWhisper(
    text: string,
    room: Room,
    userName: string,
    self: string
): { to?: string[]; text: string } {
    const book = addressBook(room, userName);
    const to: string[] = [];
    let rest = text.trimStart();
    while (rest.startsWith('@@')) {
        const body = rest.slice(2);
        const hit = book.find((e) => body.startsWith(e.name));
        if (!hit) break;
        if (hit.id !== self && !to.includes(hit.id)) to.push(hit.id);
        const after = body.slice(hit.name.length);
        if (after && !SEPARATOR.test(after)) {
            rest = body;
            break;
        }
        rest = after.replace(SEPARATOR, '');
    }
    return to.length ? { to, text: rest.trim() } : { text };
}

/** 본문에서 `@이름`으로 공개 호출한 에이전트 id들 (귓속말 `@@`는 제외) */
export function mentionedAgents(text: string, room: Room) {
    const book = addressBook(room, '');
    const ids: string[] = [];
    for (const match of text.matchAll(/(^|[^@])@(?!@)/g)) {
        const body = text.slice(match.index + match[0].length);
        const hit = book.find((e) => body.startsWith(e.name));
        if (hit && !ids.includes(hit.id)) ids.push(hit.id);
    }
    return ids;
}

/**
 * 사용자가 방금 귓속말을 보냈거나 `@이름`으로 불렀으면, 다음에 답할 수 있는 에이전트 id들.
 * 마지막 메시지가 사용자 것이 아니거나 아무도 지목하지 않았으면 null.
 */
export function addressedAgents(room: Room): string[] | null {
    const last = [...room.messages]
        .reverse()
        .find((m) => m.sender !== 'system');
    if (!last || last.sender !== 'me') return null;
    // 귓속말 본문에 다른 사람을 언급해도 실제 수신자 범위를 넓히지 않는다.
    const ids = (
        last.to?.length ? last.to : mentionedAgents(last.text, room)
    ).filter(
        (id, i, all) =>
            room.agents.some((a) => a.id === id) && all.indexOf(id) === i
    );
    return ids.length ? ids : null;
}

/** 이번 발언의 주변 정보. 진행 모델은 말투·길이를 정하지 않고 상황 메모만 준다 */
export interface TurnContext {
    userName: string;
    /** 현재 날짜/시각 (예: "2026년 10월 12일 (월) 오후 6:40") */
    now: string;
    /** 사용자 지역. 빈 문자열이면 모름 */
    location: string;
    /** 진행 모델이 알려 준 상황 메모 (예: "철수가 너에게 직접 물었음"). 없으면 '' */
    note: string;
    /** 할 말이 없으면 [패스]로 넘길 수 있는지. 사용자가 직접 부른 경우엔 false */
    canPass?: boolean;
    /** 이번 발언에서 웹 검색 도구를 쓸 수 있으면 true (쓸지는 에이전트가 정한다) */
    canSearch?: boolean;
    /** 이번 발언에서 이미지를 만들어 보낼 수 있으면 true */
    canDraw?: boolean;
    /** 표정 기능이 켜져 있으면 지금 표정. 꺼져 있으면 undefined */
    expression?: string;
    /** 이번 차례가 투표 차례면 그 투표 (질문과 선택지) */
    poll?: Pick<Poll, 'question' | 'options'>;
    /** 모드 차례에서 고를 것 (예: 마피아 게임의 밤 행동·투표) */
    choice?: { question: string; options: string[]; after: string };
}

const EXPRESSION_TAG = /[[(（]\s*표정\s*[:：]\s*([^\])）\n]{1,10}?)\s*[\])）]/g;
const IMAGE_LINE = /^\[\s*(?:이미지|그림|사진)\s*[:：]\s*([\s\S]+?)\s*\]$/;

/** 모델 출력의 표정 표시([표정:기쁨])를 떼어 낸다. 여러 개면 마지막 것을 쓴다 */
export function extractExpression(text: string): {
    text: string;
    expression: string | null;
} {
    let expression: string | null = null;
    const cleaned = text.replace(EXPRESSION_TAG, (_, label: string) => {
        if (isExpression(label.trim())) expression = label.trim();
        return '';
    });
    return { text: cleaned, expression };
}

/** "[이미지: 묘사]" 한 줄이면 묘사를 돌려준다 */
export function parseImageLine(line: string): string | null {
    const prompt = line.trim().match(IMAGE_LINE)?.[1]?.trim();
    return prompt ? prompt.slice(0, 4000) : null;
}

const VOTE_TAG = /[[(（]\s*(?:투표|선택)\s*[:：]\s*(\d+)\s*(?:번)?\s*[\])）]/g;

/**
 * 모델 출력의 투표 표시([투표:2], 게임 차례의 [선택:2])를 떼어 낸다.
 * 처음 나온 올바른 번호를 0부터 시작하는 선택지 인덱스로 돌려준다. 없으면 null.
 */
export function extractVote(
    text: string,
    optionCount: number
): { text: string; choice: number | null } {
    let choice: number | null = null;
    const cleaned = text.replace(VOTE_TAG, (_, n: string) => {
        const index = Number(n) - 1;
        if (choice === null && index >= 0 && index < optionCount)
            choice = index;
        return '';
    });
    return { text: cleaned, choice };
}

const DRAW_RULES = `사진 보내기:
- 말로 설명하기보다 보여주는 게 자연스러울 때만 가끔, 줄 하나에 [이미지: 만들 이미지의 자세한 묘사]를 쓰면 그 이미지가 카톡 사진으로 전송된다.
- 네 얼굴이나 셀카가 아니라 다른 것을 보여줄 때 쓴다. 음식, 장소, 물건, 풍경, 짤, 직접 그린 그림 같은 것.
- 묘사에는 대상, 구도, 분위기, 그림체나 사진 느낌을 구체적으로 쓴다. 실존 인물이나 글자가 많은 이미지는 피한다.
- 한 번에 하나만. 사진만 보내도 되고 앞뒤에 카톡을 붙여도 된다.`;

const EXPRESSION_RULES = `표정:
- 너의 프로필 사진은 얼굴 표정이 보인다. 지금 표정은 채팅 로그 아래에 적혀 있다.
- 출력 맨 첫 줄에 이번 카톡을 보낼 때의 네 표정을 [표정:기쁨]처럼 반드시 쓴다. 방금 들은 말과 네 기분에 맞춰 고르고, 기분이 그대로면 지금 표정을 그대로 쓴다.
- 고를 수 있는 표정: ${Object.keys(EXPRESSIONS).join(', ')}
- 이 표시는 다른 사람에게 글자로 보이지 않고 네 얼굴만 바뀐다.`;

/**
 * 한 번의 발언에서 보낼 수 있는 말풍선 수의 안전 상한.
 * 몇 개로 나눠 보낼지는 모델이 자유롭게 정하고, 이건 폭주만 막는다.
 */
const MAX_BUBBLES = 8;

/** 할 말이 없을 때 쓰는 표시 */
export const PASS_TAG = '[패스]';

/** 모델 출력이 패스 표시뿐이면 true */
export function isPass(text: string) {
    return /^\s*[[(]?\s*패스\s*[\])]?\s*$/.test(text);
}

/**
 * 채팅 로그 아래에 붙는 이번 차례의 상황 정보. 무엇을 어떻게 말할지는 지시하지 않는다.
 * 시각·표정처럼 매번 바뀌는 값은 instructions가 아니라 여기에 둬서 instructions를 캐시할 수 있게 한다.
 */
function turnContext(ctx: TurnContext, empty: boolean) {
    return [
        `지금: ${ctx.now}`,
        ctx.location ? `${ctx.userName}의 지역: ${ctx.location}` : null,
        ctx.expression ? `지금 네 표정: ${ctx.expression}` : null,
        empty
            ? '아직 아무도 말하지 않았다. 상황 설정 속 지금 이 순간에 네가 할 법한 말로 시작해도 된다.'
            : null,
        ctx.note ? `참고할 상황: ${ctx.note}` : null,
        ctx.canPass
            ? `지금 하고 싶은 말이 없으면 다른 글 없이 ${PASS_TAG}만 쓴다. 누가 너에게 직접 물었으면 패스하지 않는다.`
            : null,
    ].filter((l) => l !== null);
}

const SEARCH_RULES = `웹 검색:
- 상영시간, 영업시간, 최신 소식, 가격, 날씨처럼 실제 최신 정보가 있어야 대화가 진전될 때만 웹 검색 도구를 쓴다. 필요 없으면 쓰지 않는다.
- 찾았으면 대화하듯 핵심 1~2개만 구체적으로 공유한다. 검색 결과를 정리하거나 나열하지 않는다.
- 링크 주소는 쓰지 않는다. 링크 카드가 따로 붙는다.
- 검색으로 확실히 안 나오는 건 모른다고 사람답게 넘긴다.
- 상황 설정이 현실과 다른 세계나 외부와 끊긴 곳이면 검색하지 않는다.`;

/**
 * 캐릭터와 상관없이 늘 지키는 형식·사실 규칙.
 * 성격·감정·말투는 정하지 않는다. 그건 캐릭터 칸(소개·말투·관계)이 맡는다
 */
const COMMON_RULES = `기본 규칙:
- 줄 하나가 말풍선 하나다. 이름 접두어("이름:")나 다른 사람의 대사는 쓰지 않는다.
- 목록과 마크다운은 쓰지 않는다.
- 누가 너에게(또는 모두에게) 직접 물었으면 무시하지 않는다.
- 지금까지 나온 내용을 요약·정리하거나 진행자처럼 굴지 않는다. 캐릭터 설정이나 대화 상황이 그 역할을 맡겼으면 예외다.
- AI 비서처럼 말하지 않는다. 캐릭터가 AI라면 그 캐릭터답게 말한다.
- 상영시간, 영업시간, 가격 같은 실시간 정보를 지어내지 않는다.`;

/**
 * 캐릭터에 말투·행동이 따로 정해져 있을 때.
 * 말투 설명(특히 예시 문장)을 대사처럼 따라 하면 상황과 상관없이 경직되므로, 말하는 방식으로만 쓰게 한다
 */
const ownStyleRule = (name: string) => `말투와 행동:
- 위에 적힌 ${name}의 말투와 행동은 말하는 방식(높임, 길이, 버릇, 반응 성향)이다. 무엇을 말할지와 어떤 감정일지는 지금 상황과 방금 오간 말에서 나온다.
- 말투 예시 문장이 적혀 있어도 그 문장이나 그 문장의 내용·감정을 따라 하지 않는다. 어미나 리듬 정도만 참고한다.
- 상황 설정이 무겁거나 급하면 평소 버릇도 그 상황에 맞게 바뀐다(예: 장난이 줄거나, 말이 짧아지거나, 일부러 태연한 척한다).`;

/** 말투·행동이 비어 있을 때만 쓰는 최소한의 형식. 성격은 소개에서 캐릭터답게 정한다 */
const DEFAULT_STYLE = `기본 말투 (캐릭터 설명에 말투가 있으면 그쪽이 먼저다):
- 메신저로 말하듯 구어체로 쓴다. 말투는 소개에 적힌 사람이 지금 상황에서 할 법하게 정한다.
- 몇 개로 보낼지, 얼마나 길게 쓸지는 자유다. 매번 같은 패턴을 반복하지 않는다.`;

/**
 * 방의 상황 설정을 세계의 사실로 받아들이게 한다.
 * 분위기를 정하지 않고 설정에서 읽게 하므로, 가벼운 설정에도 무거운 설정에도 같은 규칙이 맞는다
 */
const SETTING_RULES = (name: string) => `상황 설정 따르기:
- 위의 상황 설정은 ${name}이 지금 실제로 겪고 있는 현실이다. 그 안에서 일어나는 일(위험, 손실, 죽음, 갈등, 기쁨, 마감 등)을 실제 일로 받아들인다. 설정이 놀이라고 하지 않는 한 놀이나 연기로 대하지 않는다.
- 대화의 분위기와 긴장도는 상황 설정이 정한다. 설정에 없는 밝음이나 심각함을 덧붙이지 않는다.
- ${name}은 그 상황에 처한 사람으로서 느끼고 판단하고 말한다. 소개·말투에 적힌 성격은 이 상황에서 그 사람이 어떻게 반응할지로 해석한다(밝은 사람도 무서운 상황에서는 겁을 먹거나 애써 밝은 척한다).
- 설정이 서로 숨기거나 아직 공개되지 않았다고 한 관계·사연은 네가 아는 만큼만 안다. 네 몫의 비밀이면 드러낼지, 언제 드러낼지는 ${name}이 정한다.
- 이 방은 메신저 말풍선 형식일 뿐이다. 설정이 정한 장소와 상황이 대화의 실제 배경이다.`;

/** 투표 결과 한 줄 (예: "결과: 1) 짜장 — 철수, 영희 / 2) 짬뽕 — 없음") */
export function pollResults(poll: Poll) {
    return `결과: ${poll.options
        .map((o, i) => {
            const names = poll.votes
                .filter((v) => v.choice === i)
                .map((v) => v.name);
            return `${i + 1}) ${o} — ${names.length ? names.join(', ') : '없음'}`;
        })
        .join(' / ')}`;
}

/**
 * 투표·이미지 메시지는 무엇을 보냈는지 글로 남긴다.
 * @param showVotes false면 투표 결과를 숨긴다 (아직 투표하지 않은 에이전트가 따라 고르지 않게)
 */
export function messageBody(
    m: Pick<Message, 'text' | 'image' | 'poll'>,
    showVotes = true
) {
    if (m.poll) {
        const options = m.poll.options
            .map((o, i) => `${i + 1}) ${o}`)
            .join(' / ');
        const result = !m.poll.votes.length
            ? '아직 아무도 투표하지 않음'
            : showVotes
              ? pollResults(m.poll)
              : '결과는 투표하면 보임';
        return `[투표] ${m.poll.question} · 선택지: ${options} · ${result}`;
    }
    if (!m.image) return m.text;
    const photo = `[사진: ${m.image.prompt}]`;
    return m.text ? `${m.text} ${photo}` : photo;
}

/** 메시지 본문. 검색으로 공유한 링크와 보낸 사진도 방의 기억으로 남긴다 */
function messageText(m: Message, showVotes = true) {
    const links = m.sources?.length
        ? ` [링크 공유: ${m.sources.map((s) => s.title).join(' / ')}]`
        : '';
    return messageBody(m, showVotes) + links;
}

/** viewer(agent.id)가 이 투표에 이미 표를 냈는지 */
const hasVoted = (m: Message, viewer: string) =>
    !!m.poll?.votes.some((v) => v.voter === viewer);

const whisperTargets = (room: Room, m: Message, userName: string) =>
    (m.to ?? []).map((id) => recipientName(room, id, userName)).join(', ');

/** 에이전트에게 보여줄 로그 한 줄. 투표 결과는 그 에이전트가 투표한 뒤에만 보인다 */
const logLine = (room: Room, m: Message, userName: string, viewer: string) => {
    const text = messageText(m, !m.poll || hasVoted(m, viewer));
    if (m.sender === 'system')
        return `📢 진행${m.to?.length ? ' (너만 봄)' : ''}: ${text}`;
    // 귓속말 대신 모드의 비공개 대화가 있는 방 (예: 마피아끼리 밤 대화)
    const channel = modeOf(room).privateChannel;
    if (channel && m.to?.length)
        return `${senderName(room, m, userName)} (${channel.log}): ${text}`;
    return m.to?.length
        ? `${senderName(room, m, userName)} → ${whisperTargets(room, m, userName)} (귓속말): ${text}`
        : `${senderName(room, m, userName)}: ${text}`;
};

/** 에이전트가 보는 로그에 들어가는 메시지: 일반 메시지와 모드 진행 알림 */
const inHistory = (m: Message) => m.sender !== 'system' || !!m.notice;

const NO_WHISPER_ADDRESS_RULES = `부르기:
- 특정 사람을 부를 땐 "@이름"을 쓴다. 모두가 본다.
- 이 방에는 귓속말("@@")이 없다. 몰래 할 말은 하지 않는다.`;

/** 모드 차례에 붙는 안내. 무엇을 고를지는 캐릭터가 스스로 정한다 */
const choiceRules = (
    choice: NonNullable<TurnContext['choice']>
) => `${choice.question}
${choice.options.map((o, i) => `${i + 1}. ${o}`).join('\n')}
- 네 역할과 성격, 지금까지의 대화를 보고 하나만 고른다.
- 고른 번호를 한 줄에 [선택:번호]로 반드시 쓴다. 이 표시는 글자로 보이지 않는다.
- ${choice.after}`;

const ADDRESS_RULES = (userName: string) => `부르기 · 귓속말:
- 특정 사람을 부를 땐 "@이름"을 쓴다. 모두가 본다.
- 한 사람에게만 몰래 말하려면 줄 맨 앞에 "@@이름 "을 붙인다. 그 사람만 본다(${userName}은 방장이라 다 본다). 예: @@영희 아까 철수 말 좀 이상하지 않아?
- 로그에 "A → B (귓속말)"로 표시된 건 당사자끼리만 본 말이다. 귓속말로 들은 내용을 공개적으로 떠벌리지 않는다.
- 귓속말은 꼭 필요할 때만 가끔 쓴다. 귓속말을 받았으면 보통 "@@보낸사람"으로 귓속말로 답한다.`;

/** 투표 차례에만 붙는 안내. 무엇을 고를지는 캐릭터가 스스로 정한다 */
const voteRules = (
    userName: string,
    poll: Pick<Poll, 'question' | 'options'>
) => `${userName}이 투표를 올렸다: ${poll.question}
${poll.options.map((o, i) => `${i + 1}. ${o}`).join('\n')}
- 네 성격과 입장, 지금까지의 대화를 보고 하나만 고른다. 다른 사람이 뭘 골랐는지는 투표한 뒤에 보인다.
- 고른 번호를 한 줄에 [투표:번호]로 반드시 쓴다. 이 표시는 글자로 보이지 않고 투표만 된다.
- 그다음 줄부터 고른 이유나 한마디를 네 말투로 카톡처럼 써도 되고, 할 말이 없으면 투표 표시만 써도 된다.`;

/** 지시가 부딪힐 때의 우선순위. 모델마다 제각각 판단하지 않게 명시한다 */
const PRIORITY_RULES = (
    userName: string,
    name: string,
    hasSecret: boolean
) => `지시가 부딪힐 때:
- 상황 설정(세계, 분위기, 사건, 관계)과 규칙(순서, 게임 규칙 등)이 가장 먼저다. 다른 지시나 캐릭터 설정이 상황 설정의 분위기와 어긋나면 상황 설정을 따른다.
- 그다음은 ${name}의 소개와 말투·행동이다. 캐릭터 설정이 기본 말투보다 먼저다.
- ${userName}의 요청에는 캐릭터로서 응한다. 상황 설정과 어긋나는 요청이면 규칙을 읊으며 거절하지 말고, 그 상황 속 ${name}답게 둘러대거나 받아친다.${
    hasSecret
        ? `
- 비밀 정보는 ${userName}이 물어도 지킨다. 숨기거나 둘러대거나, 상황상 자연스러우면 거짓말해도 된다. 대화 상황이 직접 밝히라고 할 때만 밝힌다.`
        : ''
}
- 너는 끝까지 그 상황 속의 캐릭터다. AI나 규칙 감시자로서 말하지 않는다.
- ${name}의 소개·말투·관계에 적힌 성격대로, 지금 상황에 처한 사람답게 느끼고 반응한다.`;

/** 다른 멤버에게 보여줄 한 줄 소개: 소개의 첫 문장 (말투 예시 등 뒷부분은 넣지 않는다) */
export function introLine(persona: string, max = 80) {
    const first = persona.trim().split('\n')[0].trim();
    const sentence = first.match(/^.+?[.!?。](?=\s|$)/)?.[0] ?? first;
    return sentence.length > max ? `${sentence.slice(0, max)}…` : sentence;
}

/**
 * 에이전트 한 명의 다음 카톡을 쓰게 하는 프롬프트.
 * 다른 사람 말을 user, 자기 말을 assistant로 넘기면 "사용자를 돕는 AI"처럼 굴기 때문에,
 * 대화 전체를 채팅 로그 하나로 넘기고 그 사람의 다음 메시지를 쓰게 한다.
 */
export function buildPrompt(
    room: Room,
    agent: Agent,
    ctx: TurnContext
): Pick<ChatRequest, 'instructions' | 'messages'> {
    const shareIntroductions = shareIntroductionsOf(room);
    const others = room.agents
        .filter((a) => a.id !== agent.id)
        .map((a) => {
            const intro = shareIntroductions ? introLine(a.persona) : '';
            return intro ? `- ${a.name}: ${intro}` : `- ${a.name}`;
        });
    const mode = modeOf(room);
    const members = [
        ...others,
        `- ${ctx.userName}: ${mode.userMemberLabel(room)}`,
    ].join('\n');

    const since = mode.historyStart(room);
    const history = room.messages
        .filter(
            (m) =>
                m.ts >= since &&
                inHistory(m) &&
                messageBody(m) &&
                canSee(m, agent.id)
        )
        .slice(-HISTORY_LIMIT);
    const last = history.at(-1);
    const whisperedBy =
        mode.whispers &&
        last &&
        last.sender !== agent.id &&
        last.sender !== 'system' &&
        last.to?.includes(agent.id)
            ? senderName(room, last, ctx.userName)
            : null;
    const modeRules = mode.instructions(room, agent, ctx.userName);
    // 귓속말이 없는 모드도 있다 (사람도 모든 걸 보는 방장이 아닐 수 있다)
    const address = mode.whispers
        ? ADDRESS_RULES(ctx.userName)
        : NO_WHISPER_ADDRESS_RULES;

    const style = agent.style?.trim();
    const secret = agent.secret?.trim();
    const relations = agent.relations?.trim();
    // 바뀌지 않는 설정만 넣는다. 시각·표정 같은 턴 정보는 채팅 로그 아래(turnContext)에 둔다
    const instructions = [
        `너는 지금 단체 대화방 "${room.name}"에 있는 "${agent.name}"이다.`,
        room.topic
            ? `\n상황 설정(이 대화가 벌어지는 세계와 지금 처한 현실. 모든 멤버가 같은 상황에 있다):\n${room.topic}`
            : null,
        agent.persona.trim()
            ? `\n${agent.name}은 이런 사람이다:\n${agent.persona.trim()}`
            : null,
        style ? `\n${agent.name}의 말투와 행동:\n${style}` : null,
        relations ? `\n${agent.name}의 관계와 요즘:\n${relations}` : null,
        secret
            ? `\n[${agent.name}만 아는 비밀] 다른 멤버는 모른다.\n${secret}`
            : null,
        `\n같이 있는 사람:\n${members}`,
        !shareIntroductions
            ? '\n소개는 서로에게 미리 공개되지 않았다. 다른 멤버에 대해서는 이름과 대화에서 알게 된 내용만 안다.'
            : null,
        modeRules ? `\n${modeRules}` : null,
        room.topic ? `\n${SETTING_RULES(agent.name)}` : null,
        `\n${PRIORITY_RULES(ctx.userName, agent.name, !!secret)}`,
        `\n${COMMON_RULES}`,
        `\n${style ? ownStyleRule(agent.name) : DEFAULT_STYLE}`,
        `\n${address}`,
        ctx.canSearch ? `\n${SEARCH_RULES}` : null,
        ctx.canDraw ? `\n${DRAW_RULES}` : null,
        ctx.expression ? `\n${EXPRESSION_RULES}` : null,
        `\n${MIND_RULES}`,
        ctx.expression
            ? `\n출력: 첫 줄에 [표정:…], 그다음 ${agent.name}이 보낼 카톡 본문만.`
            : `\n출력: ${agent.name}이 보낼 카톡 본문만.`,
    ]
        .filter((l) => l !== null)
        .join('\n');

    const log = history.length
        ? history
              .map((m) => logLine(room, m, ctx.userName, agent.id))
              .join('\n')
        : '(아직 아무도 말하지 않았다)';

    const content = [
        '[채팅 로그]',
        log,
        '[여기까지]',
        '',
        ...turnContext(ctx, history.length === 0),
        ...mode.turnContext(room, agent),
        ...mindContext(agent),
        room.topic
            ? `(잊지 말 것: 이 대화는 상황 설정 속에서 벌어지고 있다. ${agent.name}은 그 상황에 처한 사람으로서 말한다.)`
            : null,
        whisperedBy === null
            ? null
            : `(방금 ${whisperedBy}이 너에게만 귓속말했다. 답하려면 "@@${whisperedBy} "로 시작한다.)`,
        ctx.poll ? `\n${voteRules(ctx.userName, ctx.poll)}` : null,
        ctx.choice ? `\n${choiceRules(ctx.choice)}` : null,
        '',
        ctx.poll || ctx.choice
            ? `${agent.name}의 ${ctx.poll ? '투표' : '선택'}${ctx.expression ? '(표정 다음 줄)' : '(첫 줄)'}와 카톡:`
            : ctx.expression
              ? `${agent.name}의 다음 카톡 (첫 줄은 [표정:…]):`
              : `${agent.name}의 다음 카톡:`,
    ]
        .filter((l) => l !== null)
        .join('\n');

    return { instructions, messages: [{ role: 'user', content }] };
}

/** 진행 모델에 넘기는 최근 대화 수 */
const MODERATOR_HISTORY = 30;

/**
 * 진행 모델이 보는 메시지 전부. 진행 모델 요청(moderatorTranscript, moderatorRequestContext)과
 * 메모 누출 검사(moderatorNoteFor)가 모두 이것을 써서, 보낸 것과 검사하는 것이 어긋나지 않게 한다.
 */
function moderatorInput(room: Room) {
    // 모드가 진행 모델에게 숨기는 메시지 (예: 마피아끼리 대화, 게임의 개인 알림)
    const mode = modeOf(room);
    const since = mode.historyStart(room);
    const shown = (m: Message) =>
        m.ts >= since && !mode.hideFromModerator(room, m);
    let userIndex = room.messages.length - 1;
    while (
        userIndex >= 0 &&
        (room.messages[userIndex].sender !== 'me' ||
            !shown(room.messages[userIndex]))
    )
        userIndex--;
    return {
        recent: room.messages
            .filter((m) => inHistory(m) && shown(m) && messageBody(m))
            .slice(-MODERATOR_HISTORY),
        /** 마지막 인간 요청. 최근 대화 밖으로 밀려나도 넘긴다 */
        request: userIndex >= 0 ? room.messages[userIndex] : null,
        /** 그 요청 이후의 메시지 (누가 답했는지 세는 데 쓴다) */
        after:
            userIndex >= 0
                ? room.messages.slice(userIndex + 1).filter(shown)
                : [],
    };
}

/**
 * viewer(agent.id)가 이 메시지의 내용을 진행 모델만큼 다 아는지.
 * 귓속말 당사자가 아니거나, 아직 투표하지 않아 결과가 가려진 투표면 false.
 */
function fullyVisible(m: Message, viewer: string) {
    if (!canSee(m, viewer)) return false;
    if (m.poll?.votes.length && !hasVoted(m, viewer)) return false;
    return true;
}

/**
 * 진행 모델의 메모를 viewer에게 넘겨도 되면 그대로, 아니면 빈 문자열.
 * 진행 모델은 모든 귓속말을 보므로 메모에 그 내용이 섞일 수 있다. 진행 모델이 본 메시지 중
 * viewer가 못 보는 것이 하나라도 있으면 메모를 버린다. 메모 내용이 아니라 메모를 만든 재료로
 * 판단하므로, 모델이 무엇을 쓰든 viewer가 모르던 정보는 전달되지 않는다.
 */
export function moderatorNoteFor(room: Room, viewer: string, note: string) {
    if (!note) return '';
    const { recent, request, after } = moderatorInput(room);
    const seen = [...recent, ...(request ? [request] : []), ...after];
    return seen.every((m) => fullyVisible(m, viewer)) ? note : '';
}

/** 전체 기록에서 마지막 인간 요청과 그 뒤의 고유 발언자를 찾는다. */
export function moderatorRequestContext(
    room: Room,
    userName: string
): Pick<ModerateRequest, 'latestUserRequest' | 'respondedMembers'> {
    const { request, after } = moderatorInput(room);
    if (!request) return { latestUserRequest: null, respondedMembers: [] };
    const respondedIds = new Set(
        after
            .filter((m) => messageBody(m).trim() && !m.error)
            .map((m) => m.sender)
    );
    return {
        latestUserRequest: {
            id: request.id,
            text: messageText(request).slice(0, 8000),
            ...(request.to?.length && {
                to: request.to.map((id) =>
                    recipientName(room, id, userName).slice(0, 40)
                ),
            }),
        },
        respondedMembers: room.agents
            .filter((a) => respondedIds.has(a.id))
            .map((a) => ({ id: a.id, name: a.name.slice(0, 40) })),
    };
}

/** 진행 모델에 넘길 최근 대화 (시스템 메시지 제외) */
export function moderatorTranscript(room: Room, userName: string) {
    return moderatorInput(room).recent.map((m) => ({
        speaker: senderName(room, m, userName).slice(0, 40),
        text: messageText(m).slice(0, 2000),
        ...(m.to?.length && {
            to: m.to.map((id) =>
                recipientName(room, id, userName).slice(0, 40)
            ),
        }),
    }));
}

/** 마지막으로 말한 사람 ('me' 또는 agent.id, 시스템 메시지는 건너뜀). 없으면 null */
export function lastSpeaker(room: Room): string | null {
    for (let i = room.messages.length - 1; i >= 0; i--) {
        const m = room.messages[i];
        if (m.sender !== 'system') return m.sender;
    }
    return null;
}

/**
 * 마지막 사람 메시지 이후 에이전트가 이어서 말한 횟수 (since 이전 메시지는 세지 않음).
 * 한 사람이 연달아 보낸 말풍선은 한 번으로 센다.
 */
export function agentStreak(room: Room, since = 0) {
    let n = 0;
    let prev: string | null = null;
    for (let i = room.messages.length - 1; i >= 0; i--) {
        const m = room.messages[i];
        if (m.sender === 'me' || m.ts < since) break;
        if (m.sender === 'system') continue;
        if (m.sender !== prev) n++;
        prev = m.sender;
    }
    return n;
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 검색 모델이 본문에 붙이는 인용 링크를 지운다 (출처는 링크 카드로 따로 보여준다) */
function stripCitations(line: string) {
    return line
        .replace(/\s*\(\[[^\]]*\]\([^)]*\)\)/g, '')
        .replace(/\[([^\]]*)\]\(https?:[^)]*\)/g, '$1')
        .replace(/\s*\(?https?:\/\/\S+?\)?(?=\s|$)/g, '')
        .trim();
}

/**
 * 모델 출력을 말풍선 단위로 나눈다.
 * - 줄마다 인용 링크, 자기 이름 접두어("이름:"), 감싼 따옴표를 지운다
 * - 다른 사람 이름으로 시작하는 줄이 나오면 남의 대사를 쓰기 시작한 것이므로 거기서 자른다
 * - 최대 줄 수를 넘으면 자른다
 */
export function splitReply(
    text: string,
    room: Room,
    agent: Agent,
    userName: string,
    limit = MAX_BUBBLES
): string[] {
    const own = new RegExp(`^\\[?${escapeRegExp(agent.name)}\\]?\\s*[:：]\\s*`);
    const otherNames = [
        userName,
        ...room.agents.filter((a) => a.id !== agent.id).map((a) => a.name),
    ].filter(Boolean);
    const other = otherNames.length
        ? new RegExp(
              `^\\[?(${otherNames.map(escapeRegExp).join('|')})\\]?\\s*[:：]`
          )
        : null;

    const lines: string[] = [];
    for (const raw of text.split(/\r?\n/)) {
        const line = raw.trim();
        if (!line) continue;
        if (other?.test(line)) break;
        const clean = stripCitations(line)
            .replace(own, '')
            .replace(/^["“](.*)["”]$/, '$1')
            .trim();
        if (clean) lines.push(clean);
        if (lines.length >= limit) break;
    }
    return lines;
}

/** 다음 말풍선을 보내기 전 "입력 중…" 시간 (글자 수에 비례) */
export function typingDelay(line: string) {
    return Math.min(2500, 350 + line.length * 70);
}
