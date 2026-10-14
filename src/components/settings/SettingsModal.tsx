import { useAtom, useSetAtom } from 'jotai';
import {
    ArrowLeft,
    BookMarked,
    Bot,
    MessageSquarePlus,
    ImageIcon,
    KeyRound,
    Pencil,
    Plus,
    Star,
    Trash2,
    UserRound,
} from 'lucide-react';
import { useState } from 'react';
import toast from 'react-hot-toast';
import { DEFAULT_IMAGE_MODEL, IMAGE_MODELS } from '@shared/images';
import {
    PROVIDERS,
    REASONING_LABELS,
    type PublicProfile,
} from '@shared/providers';
import {
    apiErrorMessage,
    useDeletePreset,
    useDeleteProfile,
    usePresets,
    useProfiles,
    useRenamePreset,
    useSaveProfile,
    useModels,
    useSetDefaultProfile,
} from '@services/api';
import { ensurePortraits, resolveImageProfile } from '@services/images';
import { fromPreset } from '@utils/preset/preset';
import { formatListTime } from '@utils/time/time';
import {
    assistantSettingsAtom,
    createRoom,
    currentRoomIdAtom,
    imageSettingsAtom,
    modalAtom,
    moderatorSettingsAtom,
    roomStatusSettingsAtom,
    userLocationAtom,
    userNameAtom,
    type SettingsSection,
} from '@stores/chat';
import { useProfileModels } from '@hooks/useProfileModels';
import { cn } from '@utils/cn/cn';
import EffortPicker from '../EffortPicker';
import Modal, { ModalBody, type ModalNavItem } from '../Modal';
import ModelPicker from '../ModelPicker';
import ProfileSelect from '../ProfileSelect';
import ProfileForm from './ProfileForm';
import { ProviderMark } from './ProviderPicker';

const SECTIONS: ModalNavItem<SettingsSection>[] = [
    {
        id: 'general',
        label: '내 정보',
        icon: UserRound,
        hint: '에이전트가 나를 부르는 이름과 시간·장소 감각에 쓰여요.',
    },
    {
        id: 'profiles',
        label: '프로바이더',
        icon: KeyRound,
        hint: 'LLM API 키와 기본 모델. ★ 표시가 전역 기본 프로필이에요.',
    },
    {
        id: 'assistants',
        label: 'AI 도우미',
        icon: Bot,
        hint: '대화 진행, 방 메모, 다듬기에 각각 쓸 모델을 골라요.',
    },
    {
        id: 'images',
        label: '이미지 생성',
        icon: ImageIcon,
        hint: '표정 아이콘과 에이전트가 보내는 사진에 쓰는 OpenAI 이미지 API.',
    },
    {
        id: 'presets',
        label: '프리셋',
        icon: BookMarked,
        hint: '저장해 둔 방 설정과 멤버. 채팅방 설정 아래쪽의 "프리셋으로 저장"으로 추가해요.',
    },
];

type ProfileView = { profile: PublicProfile | null } | null;

const SettingsModal = () => {
    const [modal, setModal] = useAtom(modalAtom);
    const open = modal?.type === 'settings';
    const section: SettingsSection = (open && modal.section) || 'general';
    const [editing, setEditing] = useState<ProfileView>(null);

    const close = () => {
        setModal(null);
        setEditing(null);
    };
    const select = (id: SettingsSection) => {
        setEditing(null);
        setModal({ type: 'settings', section: id });
    };

    return (
        <Modal
            open={open}
            onClose={close}
            title="설정"
            nav={{ items: SECTIONS, active: section, onSelect: select }}
        >
            <ModalBody>
                {section === 'general' && <GeneralSection />}
                {section === 'profiles' &&
                    (editing ? (
                        <>
                            <button
                                type="button"
                                className="-mt-1 flex w-fit items-center gap-1 text-sm text-neutral-500 hover:text-neutral-800"
                                onClick={() => setEditing(null)}
                            >
                                <ArrowLeft size={15} /> 프로필 목록
                            </button>
                            <h4 className="text-[15px] font-bold">
                                {editing.profile
                                    ? '프로필 수정'
                                    : '새 프로바이더 프로필'}
                            </h4>
                            <ProfileForm
                                profile={editing.profile}
                                onDone={() => setEditing(null)}
                            />
                        </>
                    ) : (
                        <ProfilesSection
                            onEdit={(profile) => setEditing({ profile })}
                        />
                    ))}
                {section === 'assistants' && <AssistantSection />}
                {section === 'images' && <ImageSection />}
                {section === 'presets' && <PresetSection onClose={close} />}
            </ModalBody>
        </Modal>
    );
};

const GeneralSection = () => {
    const [userName, setUserName] = useAtom(userNameAtom);
    const [location, setLocation] = useAtom(userLocationAtom);
    return (
        <div className="flex max-w-md flex-col gap-4">
            <label className="label">
                내 이름
                <input
                    className="field"
                    value={userName}
                    onChange={(e) => setUserName(e.target.value)}
                    onBlur={() => !userName.trim() && setUserName('나')}
                />
            </label>
            <label className="label">
                내 지역 (선택)
                <input
                    className="field"
                    value={location}
                    maxLength={60}
                    placeholder="예: 부산"
                    onChange={(e) => setLocation(e.target.value)}
                />
                <span className="text-xs font-normal text-neutral-500">
                    에이전트가 "오늘 7시"처럼 시간·장소를 말할 때와 웹 검색에
                    참고해요.
                </span>
            </label>
        </div>
    );
};

const ProfilesSection = ({
    onEdit,
}: {
    onEdit: (p: PublicProfile | null) => void;
}) => {
    const { data, isLoading, error } = useProfiles();
    const setDefault = useSetDefaultProfile();
    const remove = useDeleteProfile();

    const onDelete = async (p: PublicProfile) => {
        if (
            !confirm(
                `"${p.name}" 프로필을 삭제할까요? 저장된 API 키도 함께 삭제됩니다.`
            )
        )
            return;
        try {
            await remove.mutateAsync(p.id);
        } catch (err) {
            toast.error(await apiErrorMessage(err));
        }
    };

    return (
        <section className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-neutral-500">
                    채팅방이나 에이전트별로 다른 프로필을 지정할 수도 있어요.
                </p>
                <button
                    type="button"
                    className="btn-ghost flex shrink-0 items-center gap-1"
                    onClick={() => onEdit(null)}
                >
                    <Plus size={15} /> 추가
                </button>
            </div>

            {isLoading && (
                <p className="py-6 text-center text-sm text-neutral-500">
                    불러오는 중…
                </p>
            )}
            {error && <ServerError />}
            {data && data.profiles.length === 0 && (
                <button
                    type="button"
                    onClick={() => onEdit(null)}
                    className="rounded-xl border-2 border-dashed border-neutral-300 py-8 text-sm text-neutral-500 hover:bg-neutral-50"
                >
                    아직 프로필이 없어요. 눌러서 OpenAI, Anthropic, Gemini 등을
                    연결하세요.
                </button>
            )}

            <ul className="flex flex-col gap-2">
                {data?.profiles.map((p) => {
                    const isDefault = p.id === data.defaultProfileId;
                    return (
                        <li
                            key={p.id}
                            className={cn(
                                'flex items-center gap-3 rounded-xl border px-3 py-2.5',
                                isDefault
                                    ? 'bg-kakao/10 border-yellow-400'
                                    : 'border-neutral-200'
                            )}
                        >
                            <ProviderMark provider={p.provider} />
                            <div className="min-w-0 flex-1">
                                <div className="truncate text-sm font-semibold">
                                    {p.name}
                                </div>
                                <div className="truncate text-xs text-neutral-500">
                                    {PROVIDERS[p.provider].label} ·{' '}
                                    {p.defaultModel} ·{' '}
                                    {p.defaultReasoning !==
                                        'provider-default' &&
                                        `effort ${REASONING_LABELS[p.defaultReasoning]} · `}
                                    {p.hasKey ? `키 ${p.keyHint}` : '키 없음'}
                                </div>
                                {!!p.noSearchModels?.length && (
                                    <div
                                        className="truncate text-xs text-neutral-400"
                                        title="이 모델들은 웹 검색 도구를 거절해 검색 없이 불러요. 프로필을 수정해 저장하면 다시 확인해요."
                                    >
                                        웹 검색 불가:{' '}
                                        {p.noSearchModels.join(', ')}
                                    </div>
                                )}
                            </div>
                            <button
                                type="button"
                                className={cn(
                                    'icon-btn',
                                    isDefault
                                        ? 'text-yellow-500'
                                        : 'text-neutral-300'
                                )}
                                title={
                                    isDefault ? '기본 프로필' : '기본으로 설정'
                                }
                                onClick={() =>
                                    !isDefault && setDefault.mutate(p.id)
                                }
                            >
                                <Star
                                    size={18}
                                    fill={isDefault ? 'currentColor' : 'none'}
                                />
                            </button>
                            <button
                                type="button"
                                className="icon-btn"
                                title="수정"
                                onClick={() => onEdit(p)}
                            >
                                <Pencil size={16} />
                            </button>
                            <button
                                type="button"
                                className="icon-btn text-red-400"
                                title="삭제"
                                onClick={() => onDelete(p)}
                            >
                                <Trash2 size={16} />
                            </button>
                        </li>
                    );
                })}
            </ul>
        </section>
    );
};

const ServerError = () => (
    <p className="rounded-lg bg-red-50 p-3 text-sm text-red-600">
        API 서버에 연결할 수 없습니다. <code>yarn dev</code>로 서버가 함께 실행
        중인지 확인하세요.
    </p>
);

/** 보조 AI 작업별 프로필/모델/effort 선택 */
const AssistantSection = () => (
    <section className="flex flex-col gap-3">
        <ModelChoiceRow
            atom={moderatorSettingsAtom}
            title="대화 진행 (방 관리)"
            description="대화 흐름을 보고 다음에 누가, 얼마 뒤에 말할지와 언제 멈출지 정해요. 매 발언마다 호출되니 빠르고 저렴한 모델이 좋아요."
        />
        <ModelChoiceRow
            atom={roomStatusSettingsAtom}
            title="방 메모"
            description="승인된 OpenAI API로 대화·귓속말·비밀 설정을 읽고, 나만 보는 메모에 중요한 내용만 정리해요. 참가자에게 전달되지 않아요."
        />
        <ModelChoiceRow
            atom={assistantSettingsAtom}
            title="다듬기 · 에이전트 생성"
            description="에이전트 설명이나 대화 주제를 ✨로 자세하게 다시 쓰고, 주제와 현재 멤버를 보고 새 에이전트를 자동으로 만들 때 이 모델을 써요."
        />
    </section>
);

const ModelChoiceRow = ({
    atom,
    title,
    description,
}: {
    atom: typeof assistantSettingsAtom;
    title: string;
    description: string;
}) => {
    const [choice, setChoice] = useAtom(atom);
    const { options, keyReady, inheritLabel } = useProfileModels(
        choice.profileId
    );

    return (
        <div className="flex flex-col gap-2 rounded-xl border border-neutral-200 p-3">
            <div>
                <div className="text-sm font-semibold">{title}</div>
                <p className="text-xs text-neutral-500">{description}</p>
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
                <ProfileSelect
                    value={choice.profileId}
                    onChange={(profileId) =>
                        // 프로필이 바뀌면 이전 프로필의 모델은 의미가 없으므로 초기화
                        setChoice((c) => ({ ...c, profileId, model: '' }))
                    }
                    inheritLabel="기본 프로필 (★)"
                />
                <ModelPicker
                    key={choice.profileId ?? 'default'}
                    value={choice.model}
                    onChange={(model) => setChoice((c) => ({ ...c, model }))}
                    models={options}
                    disabled={!keyReady}
                    inheritLabel={inheritLabel}
                />
                <EffortPicker
                    value={choice.reasoning ?? null}
                    onChange={(reasoning) =>
                        setChoice((c) => ({ ...c, reasoning }))
                    }
                    inheritLabel="Effort: 프로필 기본값"
                    prefixed
                />
            </div>
        </div>
    );
};

/** 이미지 생성: OpenAI 키(프로필)와 이미지 모델 */
const ImageSection = () => {
    const [settings, setSettings] = useAtom(imageSettingsAtom);
    const { data, error } = useProfiles();
    const openaiProfiles =
        data?.profiles.filter((p) => p.provider === 'openai') ?? [];
    const active = resolveImageProfile(settings, data);
    const chosenMissing =
        !!settings.profileId &&
        !openaiProfiles.some((p) => p.id === settings.profileId);
    // 키가 있는 OpenAI 프로필로 실제 사용할 수 있는 이미지 모델 목록을 받아온다
    const models = useModels(
        active
            ? {
                  provider: active.provider,
                  baseURL: active.baseURL,
                  profileId: active.id,
                  kind: 'image',
              }
            : null
    );
    const imageModels =
        models.data?.ok && models.data.models.length
            ? models.data.models
            : IMAGE_MODELS;

    return (
        <section className="flex flex-col gap-4">
            {error && <ServerError />}
            <div
                className={cn(
                    'rounded-xl px-3 py-2.5 text-sm',
                    active
                        ? 'bg-emerald-50 text-emerald-800'
                        : 'bg-amber-50 text-amber-800'
                )}
                role="status"
            >
                {active
                    ? `사용 중: ${active.name} · 키 ${active.keyHint} · ${settings.model || DEFAULT_IMAGE_MODEL}`
                    : '이미지를 만들려면 OpenAI API 키가 필요해요. 아래에서 키를 추가하세요.'}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
                <label className="label">
                    OpenAI 프로필
                    <select
                        className="field"
                        value={settings.profileId ?? ''}
                        onChange={(e) =>
                            setSettings((s) => ({
                                ...s,
                                profileId: e.target.value || null,
                            }))
                        }
                    >
                        <option value="">자동 (키가 있는 OpenAI 프로필)</option>
                        {openaiProfiles.map((p) => (
                            <option key={p.id} value={p.id}>
                                {p.name}
                                {p.hasKey ? ` · ${p.keyHint}` : ' · 키 없음'}
                            </option>
                        ))}
                        {chosenMissing && (
                            <option value={settings.profileId!}>
                                (삭제된 프로필)
                            </option>
                        )}
                    </select>
                </label>
                <label className="label">
                    이미지 모델
                    <ModelPicker
                        key={active?.id ?? 'none'}
                        value={settings.model}
                        onChange={(model) =>
                            setSettings((s) => ({ ...s, model }))
                        }
                        models={imageModels}
                        disabled={!active}
                        inheritLabel={`기본 (${DEFAULT_IMAGE_MODEL})`}
                    />
                    {models.isFetching && (
                        <span className="text-xs font-normal text-neutral-500">
                            OpenAI에서 모델 목록을 불러오는 중…
                        </span>
                    )}
                    {models.data && !models.data.ok && (
                        <span className="text-xs font-normal text-amber-700">
                            목록을 불러오지 못해 추천 모델을 보여줘요 ·{' '}
                            {models.data.error}
                        </span>
                    )}
                </label>
            </div>

            <OpenAIKeyForm
                onCreated={(id) =>
                    setSettings((s) => ({ ...s, profileId: id }))
                }
            />

            <div className="rounded-xl bg-neutral-50 px-3 py-2.5 text-xs leading-relaxed text-neutral-600">
                <p className="mb-1 font-semibold text-neutral-700">
                    어디에 쓰이나요?
                </p>
                <ul className="list-disc space-y-0.5 pl-4">
                    <li>
                        채팅방 설정 → 이미지 · 표정에서 표정 기능을 켜면 각
                        에이전트의 얼굴 아이콘을 만들고, 대화 중 표정이 바뀌면
                        같은 얼굴을 참고해 새 표정을 만들어요.
                    </li>
                    <li>
                        에이전트별로 "이미지 생성"을 켜면 에이전트가 직접
                        프롬프트를 써서 사진을 보낼 수 있어요.
                    </li>
                    <li>
                        이미지는 이 컴퓨터의 data/images 폴더에 저장되고, 생성할
                        때마다 OpenAI 요금이 청구돼요.
                    </li>
                </ul>
            </div>
        </section>
    );
};

/** 저장된 프리셋 관리: 방 만들기 · 이름 바꾸기 · 삭제 */
const PresetSection = ({ onClose }: { onClose: () => void }) => {
    const { data, isLoading, error } = usePresets();
    const rename = useRenamePreset();
    const remove = useDeletePreset();
    const setCurrentRoomId = useSetAtom(currentRoomIdAtom);

    const run = async (fn: () => Promise<unknown>) => {
        try {
            await fn();
        } catch (err) {
            toast.error(await apiErrorMessage(err));
        }
    };

    return (
        <section className="flex flex-col gap-2">
            {isLoading && (
                <p className="py-6 text-center text-sm text-neutral-500">
                    불러오는 중…
                </p>
            )}
            {error && <ServerError />}
            {data && data.length === 0 && (
                <p className="rounded-xl border-2 border-dashed border-neutral-300 px-4 py-8 text-center text-sm text-neutral-500">
                    아직 프리셋이 없어요. 채팅방 설정 아래쪽의 "프리셋으로
                    저장"을 누르면 대화 기록 없이 방 설정과 멤버를 저장해요.
                </p>
            )}
            <ul className="flex flex-col gap-2">
                {data?.map((preset) => (
                    <li
                        key={preset.id}
                        className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-neutral-200 px-3 py-2.5"
                    >
                        <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-semibold">
                                {preset.name}
                            </div>
                            <div className="truncate text-xs text-neutral-500">
                                {preset.room.name} · 멤버{' '}
                                {preset.room.agents.length}명
                                {preset.room.expressions?.enabled &&
                                    ' · 표정 켜짐'}{' '}
                                · {formatListTime(preset.updatedAt)}
                            </div>
                        </div>
                        <button
                            type="button"
                            className="btn-ghost flex items-center gap-1 py-1.5 text-xs"
                            onClick={() => {
                                const room = createRoom(
                                    fromPreset(preset.room)
                                );
                                setCurrentRoomId(room.id);
                                if (room.expressions?.enabled)
                                    void ensurePortraits(room.id);
                                toast.success(
                                    `"${preset.name}"으로 새 방을 만들었어요.`
                                );
                                onClose();
                            }}
                        >
                            <MessageSquarePlus size={14} /> 방 만들기
                        </button>
                        <button
                            type="button"
                            className="icon-btn"
                            title="이름 바꾸기"
                            onClick={() => {
                                const name = prompt(
                                    '프리셋 이름',
                                    preset.name
                                )?.trim();
                                if (name && name !== preset.name)
                                    void run(() =>
                                        rename.mutateAsync({
                                            id: preset.id,
                                            name: name.slice(0, 60),
                                        })
                                    );
                            }}
                        >
                            <Pencil size={16} />
                        </button>
                        <button
                            type="button"
                            className="icon-btn text-red-400"
                            title="삭제"
                            onClick={() => {
                                if (
                                    confirm(
                                        `"${preset.name}" 프리셋을 삭제할까요? 이 프리셋으로 만든 방은 그대로 남아요.`
                                    )
                                )
                                    void run(() =>
                                        remove.mutateAsync(preset.id)
                                    );
                            }}
                        >
                            <Trash2 size={16} />
                        </button>
                    </li>
                ))}
            </ul>
        </section>
    );
};

/** OpenAI 키만 입력해 이미지용 프로필을 바로 만든다 */
const OpenAIKeyForm = ({ onCreated }: { onCreated: (id: string) => void }) => {
    const save = useSaveProfile();
    const [apiKey, setApiKey] = useState('');

    const submit = async () => {
        const key = apiKey.trim();
        if (!key) return;
        try {
            const profile = await save.mutateAsync({
                id: null,
                input: {
                    name: 'OpenAI',
                    provider: 'openai',
                    baseURL: '',
                    defaultModel: PROVIDERS.openai.models[0],
                    apiKey: key,
                },
            });
            setApiKey('');
            onCreated(profile.id);
            toast.success('OpenAI 키를 추가했어요.');
        } catch (err) {
            toast.error(await apiErrorMessage(err));
        }
    };

    return (
        <div className="flex flex-col gap-1.5 rounded-xl border border-neutral-200 p-3">
            <div className="text-sm font-semibold">OpenAI API 키 추가</div>
            <p className="text-xs text-neutral-500">
                새 OpenAI 프로필로 암호화해 저장해요. 채팅 모델로도 쓸 수
                있어요.
            </p>
            <div className="flex gap-2">
                <input
                    type="password"
                    className="field"
                    autoComplete="off"
                    placeholder={PROVIDERS.openai.keyPlaceholder}
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                            e.preventDefault();
                            void submit();
                        }
                    }}
                />
                <button
                    type="button"
                    className="btn-primary shrink-0"
                    disabled={!apiKey.trim() || save.isPending}
                    onClick={() => void submit()}
                >
                    추가
                </button>
            </div>
        </div>
    );
};

export default SettingsModal;
