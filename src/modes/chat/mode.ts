import { defineMode } from '../core';

/** 일반 대화: 진행 모델이 흐름을 보고 다음 화자를 정한다. 모든 훅이 기본 동작이다 */
export const chatMode = defineMode({ id: 'chat' });
