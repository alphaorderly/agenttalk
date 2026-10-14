import { mafiaEndingRequestSchema } from '../../../shared/modes/mafia-ending.ts';
import { defineModeAction } from '../types.ts';
import {
    MAFIA_ENDING_INSTRUCTIONS,
    mafiaEndingPrompt,
    parseMafiaEnding,
} from './ending.ts';

/** 마피아 모드의 서버 작업 */
export const mafiaActions = {
    /** 끝난 게임의 엔딩 장면을 연출 모델이 짠다 */
    ending: defineModeAction({
        schema: mafiaEndingRequestSchema,
        instructions: MAFIA_ENDING_INSTRUCTIONS,
        prompt: mafiaEndingPrompt,
        parse: parseMafiaEnding,
    }),
};
