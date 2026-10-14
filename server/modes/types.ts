import type { z } from 'zod';
import type { ReasoningLevel } from '../../shared/providers.ts';

/** 어떤 AI 도우미 모델로 돌릴지. 모드 작업 요청에는 반드시 들어 있어야 한다 */
export interface ModeActionTarget {
    profileId: string | null;
    model: string;
    reasoning: ReasoningLevel | null;
}

/**
 * 모드가 서버에 맡기는 AI 작업 하나 (예: 마피아 게임의 엔딩 연출).
 * 서버는 요청을 검증하고 instructions·prompt로 AI 도우미를 부른 뒤, parse 결과에 via를 붙여 돌려준다.
 */
export interface ModeAction<Req extends ModeActionTarget, Res extends object> {
    schema: z.ZodType<Req>;
    instructions: string;
    prompt: (req: Req) => string;
    /** 모델 출력을 응답으로 바꾼다. 쓸 수 없는 출력이면 throw */
    parse: (text: string) => Res;
}

/** 타입을 유지한 채 작업을 정의한다 */
export const defineModeAction = <
    Req extends ModeActionTarget,
    Res extends object,
>(
    action: ModeAction<Req, Res>
) => action;
