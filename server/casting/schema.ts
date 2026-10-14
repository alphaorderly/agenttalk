import { z } from 'zod';
import { TALK_LEVELS } from '../../shared/providers.ts';

/*
 * 모델 구조화 출력 스키마.
 * 프로바이더별 JSON 스키마 제약(min/max 등) 지원이 달라 형태만 정하고, 인원·길이는 normalize에서 맞춘다.
 */

/** 1단계 기획: 전체 신규 멤버의 뼈대 */
export const planSchema = z.object({
    members: z.array(
        z.object({
            name: z.string(),
            emoji: z.string(),
            /** 상세화 단계에 넘길 캐릭터 콘셉트 (직업·성격·이 대화에서 맡을 입장) */
            concept: z.string(),
            talk: z.enum(TALK_LEVELS),
        })
    ),
});

/** 2단계 상세화: 한 멤버의 소개·말투·관계·비밀 */
export const detailSchema = z.object({
    persona: z.string(),
    style: z.string(),
    relations: z.string(),
    secret: z.string(),
});

export type PlanOutput = z.infer<typeof planSchema>;
export type DetailOutput = z.infer<typeof detailSchema>;
