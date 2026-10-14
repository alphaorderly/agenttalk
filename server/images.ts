import { createOpenAI } from '@ai-sdk/openai';
import { generateImage } from 'ai';
import { randomUUID } from 'node:crypto';
import { readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { IMAGE_ID, type ImageRequest } from '../shared/images.ts';
import { ensurePrivateDir } from './secrets.ts';
import type { ResolvedProfile } from './store.ts';

/** 생성한 이미지를 data/images/<id>.webp 로 보관한다. 브라우저 저장소에는 ID만 남긴다. */
export class ImageStore {
    private constructor(private readonly dir: string) {}

    static async open(dataDir: string) {
        const dir = path.join(dataDir, 'images');
        await ensurePrivateDir(dir);
        return new ImageStore(dir);
    }

    private file(id: string) {
        if (!IMAGE_ID.test(id)) throw new Error('잘못된 이미지 ID입니다.');
        return path.join(this.dir, `${id}.webp`);
    }

    async save(data: Uint8Array): Promise<string> {
        const id = randomUUID();
        const file = this.file(id);
        const tmp = `${file}.${process.pid}.tmp`;
        try {
            await writeFile(tmp, data, { mode: 0o600 });
            await rename(tmp, file);
        } catch (err) {
            await unlink(tmp).catch(() => undefined);
            throw err;
        }
        return id;
    }

    /** 없으면 null */
    async read(id: string): Promise<Buffer | null> {
        try {
            return await readFile(this.file(id));
        } catch (err) {
            if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
            throw err;
        }
    }
}

/** 이미지 생성은 OpenAI 이미지 API만 지원한다 */
export function assertImageProfile(profile: ResolvedProfile) {
    if (profile.provider !== 'openai')
        throw new Error(
            '이미지 생성에는 OpenAI 프로필이 필요합니다. 설정 → 이미지 생성에서 OpenAI API 키를 추가하세요.'
        );
    if (!profile.apiKey)
        throw new Error('이미지 생성용 OpenAI 프로필에 API 키가 없습니다.');
}

/** OpenAI 이미지 API 호출. reference가 있으면 그 이미지를 참고해 편집한다 */
export async function createImage(
    profile: ResolvedProfile,
    req: ImageRequest,
    reference: Uint8Array | null,
    signal: AbortSignal
): Promise<Uint8Array> {
    assertImageProfile(profile);
    const openai = createOpenAI({
        apiKey: profile.apiKey,
        baseURL: profile.baseURL || undefined,
    });
    const { image } = await generateImage({
        model: openai.image(req.model),
        prompt: reference
            ? { text: req.prompt, images: [reference] }
            : req.prompt,
        size: req.size === 'auto' ? undefined : req.size,
        providerOptions: {
            openai: {
                quality: req.quality,
                outputFormat: 'webp',
                outputCompression: 85,
            },
        },
        maxRetries: 1,
        abortSignal: AbortSignal.any([signal, AbortSignal.timeout(180_000)]),
    });
    return image.uint8Array;
}
