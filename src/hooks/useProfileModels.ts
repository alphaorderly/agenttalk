import { PROVIDERS } from '@shared/providers';
import { useModels, useProfiles } from '@services/api';

/**
 * 저장된 프로필(null이면 전역 기본 프로필)의 모델 선택지.
 * 키가 있는 프로필이면 프로바이더에서 실제 목록을 받아오고, 실패하면 추천 목록을 쓴다.
 * 같은 프로필을 쓰는 컴포넌트끼리는 쿼리 키가 같아 한 번만 조회된다.
 */
export function useProfileModels(profileId: string | null | undefined) {
    const { data } = useProfiles();
    const effectiveId = profileId ?? data?.defaultProfileId;
    const profile = data?.profiles.find((p) => p.id === effectiveId);
    const keyReady =
        !!profile &&
        (profile.hasKey || !PROVIDERS[profile.provider].keyRequired);

    const models = useModels(
        profile && keyReady
            ? {
                  provider: profile.provider,
                  baseURL: profile.baseURL,
                  profileId: profile.id,
              }
            : null
    );
    const options =
        models.data?.ok && models.data.models.length
            ? models.data.models
            : profile
              ? PROVIDERS[profile.provider].models
              : [];

    /** ModelPicker의 "상속" 선택지 문구 */
    const inheritLabel = !profile
        ? '프로필 없음'
        : !keyReady
          ? '🔒 프로필에 API 키 필요'
          : `기본 모델 (${profile.defaultModel})`;

    return { profile, keyReady, options, inheritLabel };
}
