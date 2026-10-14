import { randomUUID } from 'node:crypto';
import { readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import {
    PROVIDER_IDS,
    REASONING_LEVELS,
    type ProfileInput,
    type ProfilesResponse,
    type PublicProfile,
} from '../shared/providers.ts';
import {
    decryptSecret,
    encryptSecret,
    ensurePrivateDir,
    loadMasterKey,
    tightenPermissions,
} from './secrets.ts';

const storedProfileSchema = z.object({
    id: z.string(),
    name: z.string(),
    provider: z.enum(PROVIDER_IDS),
    baseURL: z.string(),
    defaultModel: z.string(),
    /** 이전 버전 파일에는 없으므로 기본값으로 채운다 */
    defaultReasoning: z.enum(REASONING_LEVELS).default('provider-default'),
    /** 암호화된 API 키 (없으면 null) */
    encryptedKey: z.string().nullable(),
    keyHint: z.string(),
    /** 웹 검색 도구를 거절한 모델 ID (이전 버전 파일에는 없다) */
    noSearchModels: z.array(z.string()).default([]),
    createdAt: z.number(),
    updatedAt: z.number(),
});

const fileSchema = z.object({
    version: z.literal(1),
    defaultProfileId: z.string().nullable(),
    profiles: z.array(storedProfileSchema),
});

type StoredProfile = z.infer<typeof storedProfileSchema>;
type FileShape = z.infer<typeof fileSchema>;

export interface ResolvedProfile extends Omit<StoredProfile, 'encryptedKey'> {
    apiKey: string | undefined;
}

export class ProfileNotFoundError extends Error {}

function hintOf(apiKey: string) {
    return apiKey.length > 8 ? `••••${apiKey.slice(-4)}` : '••••';
}

function toPublic({ encryptedKey, ...p }: StoredProfile): PublicProfile {
    return { ...p, hasKey: encryptedKey !== null };
}

/**
 * 프로바이더 프로필을 JSON 파일에 저장한다.
 * - API 키는 AES-256-GCM으로 암호화되어 저장되고, 외부로는 keyHint만 노출된다.
 * - 쓰기는 임시 파일 → rename 으로 원자적으로 수행하며, 직렬화하여 경쟁 상태를 막는다.
 * - 파일이 손상되었으면 덮어쓰지 않고 오류를 낸다 (데이터 유실 방지).
 */
export class ProfileStore {
    private readonly file: string;
    private key!: Buffer;
    private data!: FileShape;
    private queue: Promise<unknown> = Promise.resolve();

    private constructor(dataDir: string) {
        this.file = path.join(dataDir, 'profiles.json');
    }

    static async open(dataDir: string) {
        const store = new ProfileStore(dataDir);
        await ensurePrivateDir(dataDir);
        store.key = await loadMasterKey(dataDir);
        store.data = await store.read();
        return store;
    }

    private async read(): Promise<FileShape> {
        let raw: string;
        try {
            raw = await readFile(this.file, 'utf8');
        } catch (err) {
            if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
                return { version: 1, defaultProfileId: null, profiles: [] };
            }
            throw err;
        }
        await tightenPermissions(this.file);
        const parsed = fileSchema.safeParse(JSON.parse(raw));
        if (!parsed.success) {
            throw new Error(
                `${this.file} 파일 형식이 올바르지 않습니다. 파일을 확인하거나 백업 후 삭제하세요.\n${parsed.error.message}`
            );
        }
        return parsed.data;
    }

    /** 변경 작업을 직렬화하고, 성공 시에만 디스크에 기록한다 */
    private mutate<T>(fn: (draft: FileShape) => T): Promise<T> {
        const run = async () => {
            const draft: FileShape = structuredClone(this.data);
            const result = fn(draft);
            await this.write(draft);
            this.data = draft;
            return result;
        };
        const next = this.queue.then(run, run);
        this.queue = next.catch(() => undefined);
        return next;
    }

    private async write(data: FileShape) {
        const tmp = `${this.file}.${process.pid}.${Date.now()}.tmp`;
        try {
            await writeFile(tmp, JSON.stringify(data, null, 2) + '\n', {
                mode: 0o600,
            });
            await rename(tmp, this.file);
        } catch (err) {
            await unlink(tmp).catch(() => undefined);
            throw err;
        }
    }

    list(): ProfilesResponse {
        return {
            profiles: this.data.profiles.map(toPublic),
            defaultProfileId: this.data.defaultProfileId,
        };
    }

    create(input: ProfileInput): Promise<PublicProfile> {
        return this.mutate((d) => {
            const now = Date.now();
            const id = randomUUID();
            const apiKey = input.apiKey || '';
            const profile: StoredProfile = {
                id,
                name: input.name,
                provider: input.provider,
                baseURL: input.baseURL,
                defaultModel: input.defaultModel,
                defaultReasoning: input.defaultReasoning ?? 'provider-default',
                encryptedKey: apiKey
                    ? encryptSecret(this.key, apiKey, id)
                    : null,
                keyHint: apiKey ? hintOf(apiKey) : '',
                noSearchModels: [],
                createdAt: now,
                updatedAt: now,
            };
            d.profiles.push(profile);
            d.defaultProfileId ??= id;
            return toPublic(profile);
        });
    }

    update(id: string, input: ProfileInput): Promise<PublicProfile> {
        return this.mutate((d) => {
            const p = d.profiles.find((x) => x.id === id);
            if (!p) throw new ProfileNotFoundError(id);
            p.name = input.name;
            p.provider = input.provider;
            p.baseURL = input.baseURL;
            p.defaultModel = input.defaultModel;
            if (input.defaultReasoning)
                p.defaultReasoning = input.defaultReasoning;
            if (input.apiKey !== undefined) {
                p.encryptedKey = input.apiKey
                    ? encryptSecret(this.key, input.apiKey, id)
                    : null;
                p.keyHint = input.apiKey ? hintOf(input.apiKey) : '';
            }
            // 접속 정보나 키가 바뀌었을 수 있으니 검색 지원 여부는 다시 확인한다
            p.noSearchModels = [];
            p.updatedAt = Date.now();
            return toPublic(p);
        });
    }

    /** 이 프로필의 모델이 웹 검색 도구를 거절했다고 기록한다. 다음부터는 검색 없이 부른다 */
    markNoSearch(id: string, model: string): Promise<void> {
        return this.mutate((d) => {
            const p = d.profiles.find((x) => x.id === id);
            if (!p) throw new ProfileNotFoundError(id);
            if (!p.noSearchModels.includes(model)) p.noSearchModels.push(model);
        });
    }

    remove(id: string): Promise<void> {
        return this.mutate((d) => {
            const before = d.profiles.length;
            d.profiles = d.profiles.filter((p) => p.id !== id);
            if (d.profiles.length === before)
                throw new ProfileNotFoundError(id);
            if (d.defaultProfileId === id)
                d.defaultProfileId = d.profiles[0]?.id ?? null;
        });
    }

    setDefault(id: string): Promise<void> {
        return this.mutate((d) => {
            if (!d.profiles.some((p) => p.id === id))
                throw new ProfileNotFoundError(id);
            d.defaultProfileId = id;
        });
    }

    /** 서버 내부 전용: 복호화된 키를 포함한 프로필. id가 null이면 기본 프로필. */
    resolve(id: string | null): ResolvedProfile {
        const targetId =
            id ?? this.data.defaultProfileId ?? this.data.profiles[0]?.id;
        const p = this.data.profiles.find((x) => x.id === targetId);
        if (!p) throw new ProfileNotFoundError(String(id));
        const { encryptedKey, ...rest } = p;
        return {
            ...rest,
            apiKey: encryptedKey
                ? decryptSecret(this.key, encryptedKey, p.id)
                : undefined,
        };
    }
}
