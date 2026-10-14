import { z } from 'zod';
import { PERSONA_MAX, STYLE_MAX } from '../shared/providers.ts';

/* 에이전트 소개 다듬기 응답 처리. 자동 생성(캐스팅)은 ./casting 에 있다 */

/** 인용 문자열·이스케이프를 구분하며 완전히 닫힌 JSON만 꺼낸다. 잘린 필드는 추측하지 않는다. */
function jsonCandidates(text: string): unknown[] {
    const stack: { start: number; bracket: string }[] = [];
    const candidates: { start: number; value: unknown }[] = [];
    let quoted = false;
    let escaped = false;
    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        if (quoted) {
            if (escaped) escaped = false;
            else if (char === '\\') escaped = true;
            else if (char === '"') quoted = false;
            continue;
        }
        if (char === '"' && stack.length) quoted = true;
        else if (char === '{' || char === '[')
            stack.push({ start: i, bracket: char });
        else if (char === '}' || char === ']') {
            const opening = stack.pop();
            if (!opening || opening.bracket !== (char === '}' ? '{' : '['))
                continue;
            try {
                candidates.push({
                    start: opening.start,
                    value: JSON.parse(text.slice(opening.start, i + 1)),
                });
            } catch {
                // 형식이 틀린 바깥 JSON이어도 완성된 내부 객체는 따로 검증한다
            }
        }
    }
    return candidates.sort((a, b) => a.start - b.start).map((c) => c.value);
}

const personaAndStyleSchema = z.object({
    persona: z.string(),
    style: z.string().nullish(),
});

/** 소개 다듬기에서 소개와 말투·행동을 함께 쓴 결과를 꺼낸다 */
export function parsePersonaAndStyle(text: string): {
    persona: string;
    style: string;
} {
    const parsed = jsonCandidates(text)
        .map((raw) => personaAndStyleSchema.safeParse(raw))
        .find((result) => result.success);
    if (!parsed?.success) throw new Error('모델 응답 형식이 다릅니다.');
    const persona = parsed.data.persona.trim().slice(0, PERSONA_MAX);
    if (!persona) throw new Error('모델이 빈 소개를 돌려줬습니다.');
    return {
        persona,
        style: (parsed.data.style ?? '').trim().slice(0, STYLE_MAX),
    };
}
