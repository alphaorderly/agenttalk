import { z } from 'zod';

/** OpenAI 이미지 생성 품질. 높을수록 느리고 비싸다 */
export const IMAGE_QUALITIES = ['low', 'medium', 'high'] as const;
export type ImageQuality = (typeof IMAGE_QUALITIES)[number];
export const IMAGE_QUALITY_LABELS: Record<ImageQuality, string> = {
    low: '낮음 (빠름 · 저렴)',
    medium: '보통',
    high: '높음 (느림 · 비쌈)',
};

/** OpenAI gpt-image 계열이 공통으로 지원하는 해상도. auto는 모델이 정한다 */
export const IMAGE_SIZES = [
    '1024x1024',
    '1536x1024',
    '1024x1536',
    'auto',
] as const;
export type ImageSize = (typeof IMAGE_SIZES)[number];
export const IMAGE_SIZE_LABELS: Record<ImageSize, string> = {
    '1024x1024': '1024×1024 (정사각형)',
    '1536x1024': '1536×1024 (가로)',
    '1024x1536': '1024×1536 (세로)',
    auto: '자동',
};

/** 추천 이미지 모델. 사용자가 다른 모델 ID를 직접 입력할 수도 있다 */
export const IMAGE_MODELS = [
    'gpt-image-2',
    'gpt-image-1.5',
    'gpt-image-1',
    'gpt-image-1-mini',
];
export const DEFAULT_IMAGE_MODEL = 'gpt-image-2';

/**
 * 표정 기능에서 쓸 수 있는 표정. 목록을 고정해 두면 같은 표정 이미지를 다시 쓸 수 있어
 * 대화가 길어져도 생성 비용이 계속 늘지 않는다.
 */
export const EXPRESSIONS: Record<string, string> = {
    기본: 'a neutral, relaxed expression',
    기쁨: 'a happy, warm smile',
    웃음: 'laughing out loud, eyes squinting with joy',
    신남: 'excited and thrilled, wide bright eyes',
    슬픔: 'a sad expression, slightly teary eyes',
    화남: 'an angry expression, furrowed brows',
    짜증: 'an annoyed, irritated expression',
    놀람: 'a surprised expression, raised eyebrows and open mouth',
    당황: 'a flustered, embarrassed expression with an awkward smile',
    걱정: 'a worried, anxious expression',
    의심: 'a suspicious, skeptical look with narrowed eyes',
    진지: 'a serious, focused expression',
    부끄러움: 'a shy, bashful expression with blushing cheeks',
    피곤: 'a tired, sleepy expression',
    자신만만: 'a confident, smug grin',
    삐짐: 'a sulky, pouting expression',
};
export const DEFAULT_EXPRESSION = '기본';
export const isExpression = (value: string) =>
    Object.prototype.hasOwnProperty.call(EXPRESSIONS, value);

/** 서버가 저장한 이미지 파일 ID (UUID) */
export const IMAGE_ID =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const imageRequestSchema = z.object({
    /** null 이면 기본 프로필. OpenAI 프로필이어야 한다 */
    profileId: z.string().max(64).nullable(),
    model: z.string().trim().min(1).max(100),
    prompt: z.string().trim().min(1).max(4000),
    quality: z.enum(IMAGE_QUALITIES),
    size: z.enum(IMAGE_SIZES),
    /** 있으면 이 이미지를 참고해 편집한다 (같은 얼굴 유지) */
    reference: z.string().regex(IMAGE_ID).optional(),
});

export type ImageRequest = z.infer<typeof imageRequestSchema>;

export type ImageResponse =
    | { ok: true; id: string; via: string }
    | { ok: false; error: string };

export const imageUrl = (id: string) => `/api/images/${id}`;
