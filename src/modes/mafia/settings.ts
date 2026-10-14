import { z } from 'zod';
import type { ModeSettingsEditor } from '../uiTypes';
import MafiaSettingsFields from './MafiaSettingsFields';
import {
    MAX_HELPERS,
    MAX_MAFIA,
    USER_ROLES,
    ROLE_ORDER,
    defaultMafiaCount,
    defaultMafiaSetup,
    playerCount,
    setupProblem,
} from './rules';
import type { MafiaSetup } from './types';

/** 방 설정 화면의 마피아 게임 설정 (room.mafia) */
export const mafiaSettings: ModeSettingsEditor<MafiaSetup> = {
    schema: z.object({
        userRole: z.enum(USER_ROLES),
        roleAssignment: z.enum(['random', 'manual']).optional(),
        assignedRoles: z.record(z.string(), z.enum(ROLE_ORDER)).optional(),
        mafia: z.number().int().min(1).max(MAX_MAFIA),
        doctor: z.number().int().min(0).max(MAX_HELPERS),
        police: z.number().int().min(0).max(MAX_HELPERS),
        reveal: z.boolean(),
        dayTalk: z.number().int().min(2).max(40),
        verdict: z.boolean().optional(),
    }),
    defaults: defaultMafiaSetup,
    // 이전 버전은 의사·경찰을 켜고 끄는 boolean으로 저장했고, 찬반 투표 설정이 없었다
    load: (setup) => ({
        ...setup,
        doctor: +setup.doctor,
        police: +setup.police,
        verdict: setup.verdict !== false,
    }),
    problem: setupProblem,
    fit: (setup, agentCount) =>
        setup.roleAssignment === 'manual'
            ? setup
            : {
                  ...setup,
                  mafia: defaultMafiaCount(playerCount(setup, agentCount)),
              },
    Fields: MafiaSettingsFields,
};
