import toast from 'react-hot-toast';
import {
    DEFAULT_EXPRESSION,
    DEFAULT_IMAGE_MODEL,
    EXPRESSIONS,
    isExpression,
    type ImageRequest,
} from '@shared/images';
import type { ProfilesResponse, PublicProfile } from '@shared/providers';
import type { Agent, Room } from '@/types/chat';
import {
    faceJobsAtom,
    imageSettingsAtom,
    roomsAtom,
    store,
    updateRoom,
    type ImageSettings,
} from '@stores/chat';
import { expressionsOn } from '@utils/face/face';
import { apiErrorMessage, queryClient, requestImage } from './api';

export { currentFace, expressionsOn } from '@utils/face/face';

export const IMAGE_SETUP_HINT =
    '설정 → 이미지 생성에서 OpenAI API 키를 추가하세요.';

/** 이미지 생성에 쓸 OpenAI 프로필. 지정하지 않았으면 기본 프로필 → 첫 OpenAI 프로필 순 */
export function resolveImageProfile(
    settings: ImageSettings,
    data: ProfilesResponse | undefined
): PublicProfile | undefined {
    if (!data) return undefined;
    const usable = (p: PublicProfile) => p.provider === 'openai' && p.hasKey;
    if (settings.profileId) {
        const chosen = data.profiles.find((p) => p.id === settings.profileId);
        return chosen && usable(chosen) ? chosen : undefined;
    }
    const fallback = data.profiles.find((p) => p.id === data.defaultProfileId);
    return fallback && usable(fallback) ? fallback : data.profiles.find(usable);
}

/** 지금 이미지를 만들 수 있으면 요청 대상, 아니면 null */
export function imageTarget() {
    const settings = store.get(imageSettingsAtom);
    const profile = resolveImageProfile(
        settings,
        queryClient.getQueryData<ProfilesResponse>(['profiles'])
    );
    return profile
        ? {
              profileId: profile.id,
              model: settings.model.trim() || DEFAULT_IMAGE_MODEL,
          }
        : null;
}

async function generate(
    req: Omit<ImageRequest, 'profileId' | 'model'>,
    signal?: AbortSignal
): Promise<string> {
    const target = imageTarget();
    if (!target) throw new Error(IMAGE_SETUP_HINT);
    let res;
    try {
        res = await requestImage({ ...target, ...req }, signal);
    } catch (err) {
        throw new Error(await apiErrorMessage(err));
    }
    if (!res.ok) throw new Error(res.error);
    return res.id;
}

const getRoom = (roomId: string) =>
    store.get(roomsAtom).find((r) => r.id === roomId);

const jobKey = (roomId: string, agentId: string) => `${roomId}:${agentId}`;

function setJob(key: string, label: string | null) {
    store.set(faceJobsAtom, (prev) => {
        const next = { ...prev };
        if (label === null) delete next[key];
        else next[key] = label;
        return next;
    });
}

function patchAgent(roomId: string, agentId: string, fn: (a: Agent) => Agent) {
    updateRoom(roomId, (r) => ({
        ...r,
        agents: r.agents.map((a) => (a.id === agentId ? fn(a) : a)),
    }));
}

/** 기본 얼굴: 이름과 공개 설명만 쓴다 (비밀 정보는 이미지 API로 보내지 않는다) */
export function portraitPrompt(room: Room, agent: Agent) {
    const style =
        room.expressions?.style.trim() ||
        'clean, warm semi-realistic digital illustration with soft lighting';
    return [
        `Square profile picture for a group chat app, showing a fictional character named "${agent.name}".`,
        agent.persona.trim() &&
            `Character description (use it for age, look, vibe and outfit): ${agent.persona.trim().slice(0, 1500)}`,
        `Art style: ${style}.`,
        `Extreme close-up headshot: the face fills most of the frame, cropped from the top of the head (hair may be cut off) to just below the chin. No shoulders, torso or hands. Facing the viewer, centered, ${EXPRESSIONS[DEFAULT_EXPRESSION]}.`,
        'It will be shown as a tiny chat avatar, so make the face large, clear and easy to read.',
        `Simple plain background tinted ${agent.color}.`,
        'No text, letters, logos, watermark or frame.',
    ]
        .filter(Boolean)
        .join('\n');
}

export function expressionPrompt(expression: string) {
    return [
        'Edit the reference portrait.',
        'Keep exactly the same character: same face shape and facial features, hairstyle, hair color, skin tone, clothing, art style, framing and background.',
        `Change only the facial expression to ${EXPRESSIONS[expression]}. A natural slight head tilt is fine.`,
        'Keep the tight close-up crop where the face fills the frame. Do not zoom out or show shoulders, body or hands.',
        'No text, letters, logos, watermark or frame.',
    ].join('\n');
}

const portraitJobs = new Map<string, Promise<void>>();

function makePortrait(roomId: string, agentId: string) {
    const key = jobKey(roomId, agentId);
    const running = portraitJobs.get(key);
    if (running) return running;
    const job = (async () => {
        const room = getRoom(roomId);
        const agent = room?.agents.find((a) => a.id === agentId);
        if (!room?.expressions || !agent) return;
        setJob(key, '얼굴 만드는 중…');
        try {
            const id = await generate({
                prompt: portraitPrompt(room, agent),
                quality: room.expressions.quality,
                size: room.expressions.size,
            });
            // 새 얼굴이 생기면 예전 얼굴로 만든 표정은 쓰지 않는다
            patchAgent(roomId, agentId, (a) => ({
                ...a,
                portrait: id,
                faces: { [DEFAULT_EXPRESSION]: id },
                expression: DEFAULT_EXPRESSION,
            }));
        } finally {
            setJob(key, null);
        }
    })();
    portraitJobs.set(key, job);
    void job.catch(() => undefined).finally(() => portraitJobs.delete(key));
    return job;
}

/**
 * 얼굴이 없는 에이전트(와 force로 고른 에이전트)의 기본 얼굴을 만들어 아이콘을 바꾼다.
 * 비용과 속도를 위해 두 명씩 동시에 만든다.
 */
export async function ensurePortraits(roomId: string, force: string[] = []) {
    const room = getRoom(roomId);
    if (!room || !expressionsOn(room)) return;
    const targets = room.agents.filter(
        (a) => force.includes(a.id) || !a.portrait
    );
    if (!targets.length) return;
    if (!imageTarget()) {
        toast.error(`표정 기능을 쓰려면 ${IMAGE_SETUP_HINT}`);
        return;
    }
    const queue = [...targets];
    const errors: string[] = [];
    const worker = async () => {
        for (let agent = queue.shift(); agent; agent = queue.shift()) {
            try {
                await makePortrait(roomId, agent.id);
            } catch (err) {
                errors.push(
                    `${agent.name}: ${err instanceof Error ? err.message : String(err)}`
                );
            }
        }
    };
    await Promise.all([worker(), worker()]);
    if (errors.length) toast.error(`얼굴 생성 실패 · ${errors[0]}`);
}

const expressionJobs = new Map<string, Promise<string | null>>();
/** 에이전트별 마지막으로 요청된 표정. 늦게 끝난 이전 표정이 덮어쓰지 않게 한다 */
const latestExpression = new Map<string, string>();

/**
 * 대화 중 표정이 바뀌었을 때 호출한다.
 * - 이미 만든 표정이면 바로 바꾸고 null을 돌려준다 (다음 말풍선부터 새 얼굴).
 * - 처음 보는 표정이면 기본 얼굴을 참고해 새로 만들고, 다 되면 그 얼굴 ID로 resolve 한다.
 *   그동안의 말풍선은 이전 얼굴로 보내고, 호출한 쪽이 끝난 뒤 바꿔 붙일 수 있다.
 */
export function changeExpression(
    roomId: string,
    agentId: string,
    expression: string
): Promise<string | null> | null {
    const room = getRoom(roomId);
    const agent = room?.agents.find((a) => a.id === agentId);
    if (!room?.expressions?.enabled || !agent?.portrait) return null;
    if (!isExpression(expression)) return null;
    const key = jobKey(roomId, agentId);
    latestExpression.set(key, expression);
    if ((agent.expression ?? DEFAULT_EXPRESSION) === expression) return null;
    const cached =
        expression === DEFAULT_EXPRESSION
            ? agent.portrait
            : agent.faces?.[expression];
    if (cached) {
        patchAgent(roomId, agentId, (a) => ({ ...a, expression }));
        return null;
    }
    if (!imageTarget()) return null;

    const jobId = `${key}:${expression}`;
    const running = expressionJobs.get(jobId);
    if (running) return running;
    const reference = agent.portrait;
    const { quality, size } = room.expressions;
    const job = (async () => {
        setJob(key, `${expression} 표정 만드는 중…`);
        try {
            const id = await generate({
                prompt: expressionPrompt(expression),
                quality,
                size,
                reference,
            });
            const fresh = getRoom(roomId)?.agents.find((a) => a.id === agentId);
            // 그사이 얼굴을 새로 만들었으면 이전 얼굴 기준의 표정은 버린다
            if (!fresh || fresh.portrait !== reference) return null;
            patchAgent(roomId, agentId, (a) => ({
                ...a,
                faces: { ...a.faces, [expression]: id },
                ...(latestExpression.get(key) === expression && { expression }),
            }));
            return id;
        } catch (err) {
            toast.error(
                `${agent.name} 표정 생성 실패: ${err instanceof Error ? err.message : String(err)}`
            );
            return null;
        } finally {
            setJob(key, null);
        }
    })();
    expressionJobs.set(jobId, job);
    void job.finally(() => expressionJobs.delete(jobId));
    return job;
}

/** 지정한 말풍선들의 얼굴을 바꾼다 (표정 이미지가 늦게 완성된 경우) */
export function setMessageFace(roomId: string, ids: string[], face: string) {
    if (!ids.length) return;
    updateRoom(roomId, (r) => ({
        ...r,
        messages: r.messages.map((m) =>
            ids.includes(m.id) ? { ...m, face } : m
        ),
    }));
}

/** 에이전트가 직접 쓴 프롬프트로 이미지를 만든다 */
export function createAgentImage(
    prompt: string,
    quality: NonNullable<Agent['imageGen']>['quality'],
    signal?: AbortSignal
) {
    return generate({ prompt, quality, size: 'auto' }, signal);
}

/** 에이전트가 지금 이미지를 보낼 수 있는지 (설정 + OpenAI 키) */
export function canAgentDraw(agent: Agent) {
    return !!agent.imageGen?.enabled && !!imageTarget();
}
