import {
    PERSONA_MAX,
    RELATIONS_MAX,
    STYLE_MAX,
    type GeneratedAgent,
    type TalkLevel,
} from '../../shared/providers.ts';
import type { DetailOutput, PlanOutput } from './schema.ts';

/** 정규화된 기획 멤버 */
export interface CastingSlot {
    name: string;
    emoji: string;
    concept: string;
    talk: TalkLevel;
}

const NAME_MAX = 26;
const CONCEPT_MAX = 300;
const SECRET_MAX = 2000;
const DEFAULT_EMOJI = '🙂';
const PICTOGRAPH = /\p{Extended_Pictographic}/u;

/** 첫 번째 글자 단위(grapheme)가 이모지면 그것을, 아니면 기본 이모지를 쓴다 */
export function firstEmoji(raw: string) {
    const first = [
        ...new Intl.Segmenter('ko', { granularity: 'grapheme' }).segment(
            raw.trim()
        ),
    ][0]?.segment;
    return first && PICTOGRAPH.test(first) ? first : DEFAULT_EMOJI;
}

/**
 * 기획 결과를 쓸 수 있는 명단으로 만든다.
 * - 이름·콘셉트가 빈 멤버는 버리고 요청 인원까지만 남긴다
 * - 기존 멤버나 서로 이름이 겹치면 숫자를 붙여 구분한다
 */
export function normalizePlan(
    plan: PlanOutput,
    existingNames: string[],
    count: number
): CastingSlot[] {
    const taken = new Set(existingNames.map((n) => n.trim().toLowerCase()));
    const slots: CastingSlot[] = [];
    for (const member of plan.members) {
        if (slots.length >= count) break;
        const base = member.name.trim().slice(0, NAME_MAX);
        const concept = member.concept.trim().slice(0, CONCEPT_MAX);
        if (!base || !concept) continue;
        let name = base;
        for (let n = 2; taken.has(name.toLowerCase()); n++)
            name = `${base}${n}`;
        taken.add(name.toLowerCase());
        slots.push({
            name,
            emoji: firstEmoji(member.emoji),
            concept,
            talk: member.talk,
        });
    }
    return slots;
}

/** 기획 멤버와 상세 결과를 합쳐 폼에 넣을 에이전트로 만든다. 소개가 비면 null */
export function toAgent(
    slot: CastingSlot,
    detail: DetailOutput
): GeneratedAgent | null {
    const persona = detail.persona.trim().slice(0, PERSONA_MAX);
    if (!persona) return null;
    return {
        name: slot.name,
        emoji: slot.emoji,
        persona,
        style: detail.style.trim().slice(0, STYLE_MAX),
        talk: slot.talk,
        secret: detail.secret.trim().slice(0, SECRET_MAX),
        relations: detail.relations.trim().slice(0, RELATIONS_MAX),
    };
}
