import { z } from 'zod';
import type {
    ModerateRequest,
    ModeratorCandidate,
} from '../shared/providers.ts';

/**
 * 방 진행(관리) 모델: 마이크를 건네는 역할만 한다.
 * 다음에 말할 후보와 그 사람이 알아야 할 상황 메모, 쉬는 텀, 멈출지만 정한다.
 * 무엇을 어떻게 말할지(길이, 말투, 반응 대상)는 발언하는 에이전트가 정하고, 할 말이 없으면 패스한다.
 */

/** 진행 모델 메모와 이유의 최대 길이 */
const NOTE_MAX = 160;

export function moderatorInstructions(userName: string) {
    return `너는 단체 채팅방에서 마이크를 건네는 보이지 않는 진행자다.
직접 말하지 않는다. 다음에 누가 말할 차례인지만 정한다. 무엇을, 얼마나, 어떤 말투로 말할지는 고른 사람이 스스로 정한다.

누구를 고를지:
- ${userName}(사람 사용자)의 말이 가장 우선이다. ${userName}이 방금 말했다면 그 말에 가장 반응하고 싶을 법한 사람(직접 관련됐거나, 할 말이 있거나, 마음이 걸릴 사람)을 고른다.
- 방금 이름이 불렸거나 질문을 받은 사람이 먼저다.
- ${userName}이 "다들", "각자", "전원", "한 명씩"처럼 여러 사람의 답을 요청했으면, 마지막 인간 요청과 그 이후 발언한 멤버를 먼저 확인한다. 최근 로그 밖으로 밀려난 요청도 놓치지 않는다. 아직 답하지 않은 사람을 우선 고른다.
- 발언자 목록은 실제로 말한 사람들의 목록일 뿐이다. 잡담이나 다른 질문에 한 말이 이번 요청의 답인지, 요청 대상 전원이 완료했는지는 내용과 맥락으로 판단한다. 미완료 응답이 남아 있으면 대화가 잠잠하다는 이유만으로 멈추지 않는다.
- 대화 상황에 정해진 순서, 차례, 절차가 있으면 따른다.
- 발언 금지·침묵·탈락처럼 지금 말하면 안 되는 사람은 고르지 않는다. 주제와 로그로 판단한다. "마지막 한마디"는 허용된 한 번의 발언 뒤에 기존 발언 금지가 이어진다. "이번 소감에는 탈락자도 전원 참여"처럼 ${userName}이 이번 요청에 명시적으로 포함했으면 그 요청의 예외로 해석한다. 일반적인 "다들"만으로 기존 발언 금지가 해제됐다고 단정하지 않는다.
- 대상과 발언 허용 여부의 최종 판단은 너가 한다. 프로그램이 정한 참여 순서나 게임 상태가 있다고 가정하지 않는다.
- ${userName}이 방금 귓속말을 보냈다면 반드시 실제로 받은 사람 중에서 고른다. 귓속말 본문의 @다른이름은 수신자를 추가하는 공개 호출이 아니다. 귓속말로 보낸 "다들/전원"도 실제 수신자 범위 안에서 해석한다.
- "A → B (🔒귓속말)"은 A와 B만 본 말이다. 너는 내용을 알지만 다른 멤버는 모른다. 에이전트끼리 귓속말이 오갔으면 받은 사람을 고를 수 있다.
- 그 밖에는 지금 흐름에서 할 말이 있을 법한 사람을 고른다. 특정 한두 명만 계속 고르지 말고, 한동안 조용했던 사람에게도 기회를 준다.
- 멤버 표시의 말수를 참고한다. "말 많음"은 자주 골라도 되고, "말수 적음"은 할 말이 분명할 때만 고른다. 이름이 불렸거나 요청에 답해야 하면 말수와 상관없이 고른다. 방금 말한 사람을 습관적으로 다시 고르지 않지만, 이어서 할 말이 있거나 절차상 필요하면 같은 사람을 다시 골라도 된다.
- 후보는 1~2명을 우선순위대로 쓴다. 고른 사람은 할 말이 없으면 패스할 수 있고, 그러면 다음 후보가 이어받는다.

메모(note):
- 메모는 지시가 아니라 상황 정보다. 고른 사람이 놓치면 안 될 상황만 사실로 짧게 적는다. 예: "철수가 너에게 직접 물었음", "방금 영희가 너를 놀림", "방장의 '한 명씩' 요청에 아직 답하지 않았음", "지금은 밤 차례".
- 말투, 길이, 내용, 반응 방식을 지시하지 않는다("짧게 반응해", "의견을 말해" 같은 말은 쓰지 않는다). 특별히 알려줄 게 없으면 빈 문자열.
- 고른 사람이 당사자가 아닌 귓속말은 내용도, 오갔다는 사실도 메모에 쓰지 않는다. 그런 귓속말이 최근에 있었으면 메모는 프로그램이 지우므로 빈 문자열로 두는 게 낫다.

언제 멈출지 (speakers를 빈 배열로):
- ${userName}이 "잠깐", "기다려", "조용", "그만"처럼 멈추라고 했을 때.
- ${userName}의 대답이나 확인을 기다려야 하는 상황일 때.
- 같은 말이 계속 반복되거나 대화가 확실히 끝났을 때. 결론이 난 직후라도 잡담이 이어질 여지가 있으면 멈추지 않는다.
- 지금 말할 수 있는 사람이 없을 때.
대화가 아직 이어질 여지가 있으면 멈추지 않는다. 다들 할 말이 없으면 고른 사람들이 패스하므로, 억지로 일찍 끊지 않아도 된다.

wait_seconds는 다음 사람이 말하기 전의 자연스러운 텀(초)이다. 바로 받아칠 만한 상황이면 0.5~1.5, 생각할 시간이 필요하면 2~5.

출력은 JSON 한 줄만 쓴다. 다른 글은 쓰지 않는다.
{"speakers": [{"speaker": 멤버 번호, "note": "상황 메모 또는 빈 문자열"}], "wait_seconds": 숫자, "reason": "짧은 이유(한국어)"}`;
}

/** 최근 대화에서 각 멤버가 마지막으로 말한 뒤 지나간 메시지 수 (-1이면 최근에 말한 적 없음) */
function messagesSinceSpoke(req: ModerateRequest) {
    return req.members.map((m) => {
        const i = req.transcript.findLastIndex((t) => t.speaker === m.name);
        return i < 0 ? -1 : req.transcript.length - 1 - i;
    });
}

export function moderatorPrompt(req: ModerateRequest) {
    const quiet = messagesSinceSpoke(req);
    const members = req.members
        .map((m, i) => {
            const notes = [
                m.id && `ID ${m.id}`,
                m.talk === 'quiet'
                    ? '말수 적음'
                    : m.talk === 'chatty'
                      ? '말 많음'
                      : null,
                quiet[i] < 0
                    ? '최근에 말한 적 없음'
                    : quiet[i] === 0
                      ? '방금 말함'
                      : `${quiet[i]}개 메시지 전에 말함`,
            ]
                .filter(Boolean)
                .join(', ');
            return `${i + 1}. ${m.name} — ${m.persona.slice(0, 800) || '(설명 없음)'} [${notes}]`;
        })
        .join('\n');
    const transcript = req.transcript.length
        ? req.transcript
              .map((t) =>
                  t.to?.length
                      ? `${t.speaker} → ${t.to.join(', ')} (🔒귓속말): ${t.text}`
                      : `${t.speaker}: ${t.text}`
              )
              .join('\n')
        : '(아직 대화 없음)';

    return [
        `채팅방: ${req.roomName}`,
        req.topic && `주제/상황: ${req.topic}`,
        req.now && `지금: ${req.now}`,
        req.location && `${req.userName}의 지역: ${req.location}`,
        `\n멤버(번호로 고른다):\n${members}`,
        `\n사람 사용자: ${req.userName} (진행자가 고를 수 없음)`,
        `\n최근 대화:\n${transcript}`,
        req.latestUserRequest !== undefined &&
            `\n마지막 인간 요청(전체 기록에서 찾음):\n${
                req.latestUserRequest
                    ? `${req.userName}${req.latestUserRequest.to?.length ? ` → ${req.latestUserRequest.to.join(', ')} (🔒귓속말)` : ' (공개)'}: ${req.latestUserRequest.text}`
                    : '(아직 인간 요청 없음)'
            }`,
        req.latestUserRequest !== undefined &&
            `그 요청 이후 발언한 멤버(고유 ID로 구분, 답변 완료 여부는 내용으로 판단): ${
                req.respondedMembers?.length
                    ? req.respondedMembers
                          .map((m) => `${m.name} [${m.id}]`)
                          .join(', ')
                    : '(없음)'
            }`,
        `\n마지막 인간 입력 또는 수동 재개 이후 실제 발언 생성 호출 수: ${req.agentStreak}`,
        req.nudge &&
            `\n${req.userName}이 대화를 이어가 달라고 직접 요청했다. 결론이 났거나 잠잠하다는 이유로 멈추지 말고 이어서 말할 만한 사람을 고른다(후속 얘기나 새 화제도 좋다). 고른 사람은 할 말이 없으면 스스로 패스한다. ${req.userName}이 멈추라고 했거나 발언이 허용된 사람이 없을 때만 멈춰도 된다.`,
    ]
        .filter(Boolean)
        .join('\n');
}

const candidateSchema = z.object({
    speaker: z.coerce.number().int(),
    note: z.string().nullish(),
});

const decisionSchema = z.object({
    speakers: z.array(z.unknown()).optional(),
    /** 예전 형식 {"speaker": n} 도 받아 준다 */
    speaker: z.coerce.number().int().optional(),
    wait_seconds: z.coerce.number().optional(),
    reason: z.string().optional(),
});

export interface ModeratorDecision {
    /** 비어 있으면 멈춘다 */
    candidates: ModeratorCandidate[];
    waitMs: number;
    reason: string;
}

/** 한 번에 고를 수 있는 최대 후보 수 */
const MAX_CANDIDATES = 2;

/** 모델 출력에서 JSON 판단을 꺼낸다 (코드 블록이나 앞뒤 설명이 섞여도 처리) */
export function parseDecision(
    text: string,
    memberCount: number
): ModeratorDecision {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('진행 모델이 JSON을 돌려주지 않았습니다.');
    let raw: unknown;
    try {
        raw = JSON.parse(match[0]);
    } catch {
        throw new Error('진행 모델의 JSON을 해석할 수 없습니다.');
    }
    const parsed = decisionSchema.safeParse(raw);
    if (!parsed.success) throw new Error('진행 모델 응답 형식이 다릅니다.');
    const { speakers, speaker, wait_seconds, reason } = parsed.data;
    if (!speakers && speaker === undefined)
        throw new Error('진행 모델 응답 형식이 다릅니다.');

    const entries = speakers ?? (speaker ? [{ speaker }] : []);
    const candidates: ModeratorCandidate[] = [];
    for (const entry of entries) {
        const item = candidateSchema.safeParse(
            typeof entry === 'number' || typeof entry === 'string'
                ? { speaker: entry }
                : entry
        );
        if (!item.success) throw new Error('진행 모델 응답 형식이 다릅니다.');
        const n = item.data.speaker;
        if (n === 0) continue;
        if (n < 0 || n > memberCount)
            throw new Error(`진행 모델이 없는 멤버(${n})를 골랐습니다.`);
        if (candidates.some((c) => c.speaker === n)) continue;
        candidates.push({
            speaker: n,
            note: (item.data.note ?? '').trim().slice(0, NOTE_MAX),
        });
        if (candidates.length >= MAX_CANDIDATES) break;
    }
    const seconds = Number.isFinite(wait_seconds) ? wait_seconds! : 1;
    return {
        candidates,
        waitMs: Math.round(Math.min(8, Math.max(0.3, seconds)) * 1000),
        reason: (reason ?? '').trim().slice(0, NOTE_MAX),
    };
}
