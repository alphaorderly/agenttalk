import { zodResolver } from '@hookform/resolvers/zod';
import { useDebounce } from '@uidotdev/usehooks';
import { useEffect, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import toast from 'react-hot-toast';
import {
    PROVIDERS,
    profileInputSchema,
    type ProfileInput,
    type ProviderId,
    type PublicProfile,
} from '@shared/providers';
import {
    apiErrorMessage,
    testProfile,
    useModels,
    useSaveProfile,
} from '@services/api';
import { cn } from '@utils/cn/cn';
import EffortPicker from '../EffortPicker';
import ModelPicker from '../ModelPicker';
import ProviderPicker from './ProviderPicker';

interface ProfileFormProps {
    profile: PublicProfile | null;
    onDone: () => void;
}

const ProfileForm = ({ profile, onDone }: ProfileFormProps) => {
    const save = useSaveProfile();
    const [clearKey, setClearKey] = useState(false);
    const [test, setTest] = useState<{
        state: 'idle' | 'busy' | 'ok' | 'fail';
        text: string;
    }>({
        state: 'idle',
        text: '',
    });

    const initialProvider: ProviderId = profile?.provider ?? 'openai';
    const {
        register,
        control,
        handleSubmit,
        getValues,
        setValue,
        setError,
        resetField,
        formState: { errors, dirtyFields },
    } = useForm<ProfileInput>({
        resolver: zodResolver(profileInputSchema),
        defaultValues: {
            name: profile?.name ?? PROVIDERS[initialProvider].label,
            provider: initialProvider,
            baseURL:
                profile?.baseURL ?? PROVIDERS[initialProvider].defaultBaseURL,
            defaultModel:
                profile?.defaultModel ??
                PROVIDERS[initialProvider].models[0] ??
                '',
            defaultReasoning: profile?.defaultReasoning ?? 'provider-default',
            apiKey: '',
        },
    });

    const provider = useWatch({ control, name: 'provider' });
    const info = PROVIDERS[provider];
    const hasStoredKey = !!profile?.hasKey && !clearKey;
    // 저장된 키는 같은 프로바이더일 때만 재사용된다 (서버도 동일 규칙)
    const storedKeyUsable = hasStoredKey && profile!.provider === provider;

    /* ----- 키가 준비되면 모델 피커 활성화 + 프로바이더에서 모델 목록 조회 ----- */
    const typedKey = (useWatch({ control, name: 'apiKey' }) ?? '').trim();
    const baseURL = useWatch({ control, name: 'baseURL' }).trim();
    const keyReady = !!typedKey || storedKeyUsable || !info.keyRequired;
    const debouncedKey = useDebounce(typedKey, 500);
    const debouncedBaseURL = useDebounce(baseURL, 500);
    const baseURLOk =
        debouncedBaseURL === ''
            ? !info.baseURLRequired
            : URL.canParse(debouncedBaseURL);
    const modelsQuery = useModels(
        keyReady && baseURLOk
            ? {
                  provider,
                  baseURL: debouncedBaseURL,
                  apiKey: debouncedKey || undefined,
                  profileId: storedKeyUsable ? profile!.id : undefined,
              }
            : null
    );
    const fetched = modelsQuery.data?.ok ? modelsQuery.data.models : null;
    const modelOptions = fetched?.length ? fetched : info.models;

    // 목록을 받아왔는데 현재 모델이 그 계정에 없으면, 추천 모델 중 사용 가능한 것(없으면 첫 번째)으로 맞춘다
    useEffect(() => {
        if (!fetched?.length) return;
        const current = getValues('defaultModel');
        if (fetched.includes(current) || dirtyFields.defaultModel) return;
        const preferred =
            PROVIDERS[getValues('provider')].models.find((m) =>
                fetched.includes(m)
            ) ?? fetched[0];
        setValue('defaultModel', preferred);
    }, [fetched, getValues, setValue, dirtyFields.defaultModel]);

    /** 프로바이더를 바꾸면 이름/URL/모델을 그 프로바이더 기본값으로 맞춘다 (사용자가 직접 고친 값은 유지) */
    const changeProvider = (next: ProviderId) => {
        const prev = PROVIDERS[getValues('provider')];
        const p = PROVIDERS[next];
        setValue('provider', next);
        if (!dirtyFields.name || getValues('name') === prev.label)
            setValue('name', p.label);
        if (
            !getValues('baseURL') ||
            getValues('baseURL') === prev.defaultBaseURL
        ) {
            setValue('baseURL', p.defaultBaseURL);
        }
        // 사용자가 고른 모델 상태도 초기화해야 새 목록에서 자동 선택된다
        resetField('defaultModel', { defaultValue: p.models[0] ?? '' });
        setTest({ state: 'idle', text: '' });
    };

    /** 수정 시: 키 입력이 비었으면 undefined(기존 키 유지), "키 삭제"를 눌렀으면 빈 문자열 */
    const keyPayload = (typed: string | undefined) => {
        if (typed) return typed;
        if (!profile) return undefined;
        return clearKey ? '' : undefined;
    };

    const onSubmit = handleSubmit(async (values) => {
        if (!keyReady) {
            setError('apiKey', { message: 'API 키를 입력하세요' });
            return;
        }
        try {
            await save.mutateAsync({
                id: profile?.id ?? null,
                input: { ...values, apiKey: keyPayload(values.apiKey) },
            });
            toast.success('프로필을 저장했습니다.');
            onDone();
        } catch (err) {
            toast.error(await apiErrorMessage(err));
        }
    });

    const runTest = async () => {
        const v = getValues();
        setTest({ state: 'busy', text: '확인 중…' });
        try {
            const res = await testProfile({
                profileId: storedKeyUsable ? profile!.id : undefined,
                provider: v.provider,
                baseURL: v.baseURL,
                model: v.defaultModel,
                reasoning: v.defaultReasoning,
                apiKey: v.apiKey || undefined,
            });
            setTest(
                res.ok
                    ? { state: 'ok', text: `연결 성공 · "${res.reply}"` }
                    : { state: 'fail', text: res.error }
            );
        } catch (err) {
            setTest({ state: 'fail', text: await apiErrorMessage(err) });
        }
    };

    return (
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
            <Controller
                control={control}
                name="provider"
                render={({ field }) => (
                    <ProviderPicker
                        value={field.value}
                        onChange={changeProvider}
                    />
                )}
            />

            <div className="grid gap-3 sm:grid-cols-2">
                <label className="label">
                    프로필 이름
                    <input className="field" {...register('name')} />
                    {errors.name && (
                        <small className="font-normal text-red-500">
                            {errors.name.message}
                        </small>
                    )}
                </label>
                <div className="label">
                    기본 모델
                    <Controller
                        control={control}
                        name="defaultModel"
                        render={({ field }) => (
                            <ModelPicker
                                // 프로바이더가 바뀌면 "직접 입력" 상태 초기화
                                key={provider}
                                value={field.value}
                                onChange={field.onChange}
                                models={modelOptions}
                                disabled={!keyReady}
                            />
                        )}
                    />
                    <ModelStatus
                        keyReady={keyReady}
                        loading={modelsQuery.isFetching}
                        count={fetched?.length ?? null}
                        error={
                            modelsQuery.data && !modelsQuery.data.ok
                                ? modelsQuery.data.error
                                : modelsQuery.error
                                  ? '서버에 연결할 수 없습니다'
                                  : null
                        }
                    />
                    {errors.defaultModel && (
                        <small className="font-normal text-red-500">
                            {errors.defaultModel.message}
                        </small>
                    )}
                </div>
            </div>

            <div className="label">
                기본 Effort (추론 강도)
                <Controller
                    control={control}
                    name="defaultReasoning"
                    render={({ field }) => (
                        <EffortPicker
                            value={field.value ?? 'provider-default'}
                            onChange={(v) =>
                                field.onChange(v ?? 'provider-default')
                            }
                        />
                    )}
                />
                <small className="font-normal text-neutral-500">
                    이 프로필을 쓰는 모든 대화의 기본값이에요. 방·에이전트·AI
                    도우미에서 따로 바꿀 수 있고, 추론을 지원하지 않는
                    모델에서는 무시돼요.
                </small>
            </div>

            <label className="label">
                <span className="flex items-center justify-between">
                    API Key {info.keyRequired ? '' : '(선택)'}
                    {hasStoredKey && (
                        <button
                            type="button"
                            className="text-xs font-normal text-red-500 hover:underline"
                            onClick={() => setClearKey(true)}
                        >
                            저장된 키 삭제
                        </button>
                    )}
                </span>
                <input
                    className="field"
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    placeholder={
                        hasStoredKey
                            ? `저장된 키 유지 (${profile!.keyHint}) — 바꾸려면 새 키 입력`
                            : clearKey
                              ? '저장 시 키가 삭제됩니다'
                              : info.keyPlaceholder
                    }
                    {...register('apiKey')}
                />
                {errors.apiKey && (
                    <small className="font-normal text-red-500">
                        {errors.apiKey.message}
                    </small>
                )}
                <small className="font-normal text-neutral-500">
                    키는 로컬 서버의 <code>data/profiles.json</code>에
                    AES-256-GCM으로 암호화되어 저장되고, 브라우저로 다시
                    전송되지 않습니다.
                </small>
            </label>

            <label className="label">
                Base URL {info.baseURLRequired ? '' : '(선택)'}
                <input
                    className="field"
                    placeholder={
                        info.defaultBaseURL || '비워두면 공식 엔드포인트 사용'
                    }
                    autoComplete="off"
                    {...register('baseURL')}
                />
                {errors.baseURL && (
                    <small className="font-normal text-red-500">
                        {errors.baseURL.message}
                    </small>
                )}
            </label>

            <div className="flex flex-wrap items-center gap-2">
                <button
                    type="button"
                    className="btn-ghost"
                    onClick={runTest}
                    disabled={test.state === 'busy'}
                >
                    연결 테스트
                </button>
                <span
                    className={cn(
                        'min-w-0 flex-1 text-xs break-words',
                        test.state === 'ok' && 'text-green-600',
                        test.state === 'fail' && 'text-red-500',
                        test.state === 'busy' && 'text-neutral-500'
                    )}
                >
                    {test.text}
                </span>
                <button type="button" className="btn-ghost" onClick={onDone}>
                    취소
                </button>
                <button
                    type="submit"
                    className="btn-primary"
                    disabled={save.isPending}
                >
                    저장
                </button>
            </div>
        </form>
    );
};

const ModelStatus = ({
    keyReady,
    loading,
    count,
    error,
}: {
    keyReady: boolean;
    loading: boolean;
    count: number | null;
    error: string | null;
}) => {
    const [text, tone] = !keyReady
        ? ['🔒 API 키를 입력하면 모델을 고를 수 있어요', 'text-neutral-500']
        : loading
          ? ['모델 목록 불러오는 중…', 'text-neutral-500']
          : error
            ? [
                  `목록을 불러오지 못해 추천 모델을 보여줘요 · ${error}`,
                  'text-amber-600',
              ]
            : count !== null
              ? [`이 키로 쓸 수 있는 모델 ${count}개`, 'text-green-600']
              : ['', ''];
    return (
        <small className={cn('min-h-4 font-normal break-words', tone)}>
            {text}
        </small>
    );
};

export default ProfileForm;
