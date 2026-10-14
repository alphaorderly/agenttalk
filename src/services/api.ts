import type { ImageRequest, ImageResponse } from '@shared/images';
import type { RoomSync, RoomsResponse, StoredPreset } from '@shared/rooms';
import type { PresetRoom } from '@/types/chat';
import { modeActionPath, type ModeActionResponse } from '@shared/modes/action';
import type {
    RoomStatusRequest,
    RoomStatusResponse,
} from '@shared/room-status';
import { QueryClient, useMutation, useQuery } from '@tanstack/react-query';
import ky, { HTTPError } from 'ky';
import type {
    ChatRequest,
    ChatStreamEvent,
    ConnectionRequest,
    ModelsResponse,
    ModerateRequest,
    ModerateResponse,
    RewritePersonaRequest,
    RewriteStyleRequest,
    RewriteResponse,
    RewriteTopicRequest,
    GenerateAgentsRequest,
    CastingEvent,
    ProfileInput,
    ProfilesResponse,
    PublicProfile,
    TestRequest,
} from '@shared/providers';

export const queryClient = new QueryClient({
    defaultOptions: { queries: { refetchOnWindowFocus: false, retry: 1 } },
});

const api = ky.create({ prefixUrl: '/api', timeout: false, retry: 0 });

/* ---------------- 채팅방 저장 (서버 SQLite) ---------------- */

export function fetchRooms() {
    return api.get('rooms', { timeout: 30_000 }).json<RoomsResponse>();
}

/** keepalive는 페이지를 닫는 중에도 요청을 마치게 한다 (본문 64KB 이하만) */
export async function syncRoom(
    roomId: string,
    change: RoomSync,
    keepalive = false
) {
    await api.put(`rooms/${encodeURIComponent(roomId)}`, {
        json: change,
        keepalive,
    });
}

export async function deleteRoomOnServer(roomId: string) {
    await api.delete(`rooms/${encodeURIComponent(roomId)}`);
}

export async function saveOwnerStatus(roomId: string, status: unknown) {
    await api.put(`rooms/${encodeURIComponent(roomId)}/owner-status`, {
        json: status,
    });
}

export async function deleteOwnerStatus(roomId: string) {
    await api.delete(`rooms/${encodeURIComponent(roomId)}/owner-status`);
}

/* ---------------- 프리셋 ---------------- */

export type Preset = StoredPreset<PresetRoom>;
const PRESETS_KEY = ['presets'] as const;

export function usePresets() {
    return useQuery({
        queryKey: PRESETS_KEY,
        queryFn: () => api.get('presets').json<Preset[]>(),
    });
}

const invalidatePresets = () =>
    queryClient.invalidateQueries({ queryKey: PRESETS_KEY });

export function useCreatePreset() {
    return useMutation({
        mutationFn: (input: { name: string; room: PresetRoom }) =>
            api.post('presets', { json: input }).json<Preset>(),
        onSuccess: invalidatePresets,
    });
}

export function useRenamePreset() {
    return useMutation({
        mutationFn: ({ id, name }: { id: string; name: string }) =>
            api.put(`presets/${id}`, { json: { name } }).json<Preset>(),
        onSuccess: invalidatePresets,
    });
}

export function useDeletePreset() {
    return useMutation({
        mutationFn: (id: string) => api.delete(`presets/${id}`),
        onSuccess: invalidatePresets,
    });
}

/** 서버 오류 응답({ error })에서 메시지를 꺼낸다 */
export async function apiErrorMessage(err: unknown): Promise<string> {
    if (err instanceof HTTPError) {
        try {
            const body = (await err.response.clone().json()) as {
                error?: string;
            };
            if (body.error) return body.error;
        } catch {
            /* JSON 아님 */
        }
        return `${err.response.status} ${err.response.statusText}`;
    }
    if (err instanceof Error) return err.message;
    return String(err);
}

/* ---------------- 프로필 ---------------- */

const PROFILES_KEY = ['profiles'] as const;

export function useProfiles() {
    return useQuery({
        queryKey: PROFILES_KEY,
        queryFn: () => api.get('profiles').json<ProfilesResponse>(),
    });
}

const invalidateProfiles = () =>
    queryClient.invalidateQueries({ queryKey: PROFILES_KEY });

export function useSaveProfile() {
    return useMutation({
        mutationFn: ({
            id,
            input,
        }: {
            id: string | null;
            input: ProfileInput;
        }) =>
            id
                ? api
                      .put(`profiles/${id}`, { json: input })
                      .json<PublicProfile>()
                : api.post('profiles', { json: input }).json<PublicProfile>(),
        onSuccess: invalidateProfiles,
    });
}

export function useDeleteProfile() {
    return useMutation({
        mutationFn: (id: string) => api.delete(`profiles/${id}`),
        onSuccess: invalidateProfiles,
    });
}

export function useSetDefaultProfile() {
    return useMutation({
        mutationFn: (id: string) =>
            api.put('default-profile', { json: { id } }),
        onSuccess: invalidateProfiles,
    });
}

export function testProfile(req: TestRequest) {
    return api
        .post('test', { json: req })
        .json<{ ok: true; reply: string } | { ok: false; error: string }>();
}

/**
 * 프로바이더의 모델 목록. conn이 null이면(키가 아직 없으면) 조회하지 않는다.
 * 키는 메모리의 쿼리 캐시에만 머물고 짧게 유지된다.
 */
export function useModels(conn: ConnectionRequest | null) {
    return useQuery({
        queryKey: ['models', conn],
        queryFn: () =>
            api.post('models', { json: conn }).json<ModelsResponse>(),
        enabled: conn !== null,
        staleTime: 5 * 60_000,
        gcTime: 60_000,
        retry: 0,
    });
}

export function rewritePersona(
    req: RewritePersonaRequest,
    signal?: AbortSignal
) {
    return api
        .post('rewrite-persona', { json: req, signal })
        .json<RewriteResponse>();
}

export function rewriteStyle(req: RewriteStyleRequest, signal?: AbortSignal) {
    return api
        .post('rewrite-style', { json: req, signal })
        .json<RewriteResponse>();
}

export function rewriteTopic(req: RewriteTopicRequest, signal?: AbortSignal) {
    return api
        .post('rewrite-topic', { json: req, signal })
        .json<RewriteResponse>();
}

export function moderate(req: ModerateRequest, signal?: AbortSignal) {
    return api.post('moderate', { json: req, signal }).json<ModerateResponse>();
}

/** 모드가 서버에 맡기는 AI 작업 (server/modes에 등록한 것) */
export function runModeAction<T>(
    mode: string,
    action: string,
    req: unknown,
    signal?: AbortSignal
) {
    return api
        .post(modeActionPath(mode, action), { json: req, signal })
        .json<ModeActionResponse<T>>();
}

/** 인간 전용 읽기 요청. 참가자 생성/진행 요청과 공유하지 않는다. */
export function summarizeRoomStatus(
    req: RoomStatusRequest,
    signal: AbortSignal
) {
    return api
        .post('room-status', { json: req, signal })
        .json<RoomStatusResponse>();
}

/** OpenAI 이미지 생성. 결과는 서버에 저장되고 ID만 돌아온다 */
export function requestImage(req: ImageRequest, signal?: AbortSignal) {
    return api.post('images', { json: req, signal }).json<ImageResponse>();
}

/**
 * /api/generate-agents 의 NDJSON 스트림을 읽어 캐스팅 이벤트를 전달한다.
 * 요청 자체가 거절되면(검증 실패 등) 메시지를 담은 Error를 던진다. error 이벤트는 그대로 onEvent로 온다.
 */
export async function streamCasting(
    req: GenerateAgentsRequest,
    {
        signal,
        onEvent,
    }: { signal: AbortSignal; onEvent: (e: CastingEvent) => void }
): Promise<void> {
    await readNdjson<CastingEvent>(
        await post('generate-agents', req, signal),
        onEvent
    );
}

/* ---------------- 채팅 스트리밍 ---------------- */

/**
 * /api/chat 의 NDJSON 스트림을 읽어 이벤트를 콜백으로 전달한다.
 * 최종 텍스트를 반환하며, 프로바이더 오류는 Error로 던진다.
 */
export async function streamChat(
    req: ChatRequest,
    {
        signal,
        onEvent,
    }: { signal: AbortSignal; onEvent: (e: ChatStreamEvent) => void }
): Promise<string> {
    let full = '';
    await readNdjson<ChatStreamEvent>(await post('chat', req, signal), (e) => {
        if (e.type === 'error') throw new Error(e.message);
        if (e.type === 'delta') full += e.text;
        onEvent(e);
    });
    return full;
}

/** 스트리밍 요청. 서버가 거절하면 응답 본문의 메시지로 Error를 던진다 */
async function post(path: string, json: unknown, signal: AbortSignal) {
    try {
        return await api.post(path, { json, signal });
    } catch (err) {
        if (err instanceof HTTPError)
            throw new Error(await apiErrorMessage(err));
        throw err;
    }
}

/** NDJSON 응답을 한 줄씩 파싱해 onLine에 넘긴다. onLine이 throw 하면 읽기를 멈춘다 */
async function readNdjson<T>(res: Response, onLine: (value: T) => void) {
    const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
    let buf = '';
    const handle = (line: string) => {
        if (line.trim()) onLine(JSON.parse(line) as T);
    };
    for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += value;
        const lines = buf.split('\n');
        buf = lines.pop()!;
        lines.forEach(handle);
    }
    handle(buf);
}
