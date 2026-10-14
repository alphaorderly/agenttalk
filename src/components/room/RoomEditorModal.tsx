import { zodResolver } from '@hookform/resolvers/zod';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import {
    BookmarkPlus,
    ImageIcon,
    Loader2,
    MessageSquareText,
    Plus,
    RefreshCw,
    Settings2,
    Users,
    X,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import toast from 'react-hot-toast';
import {
    Controller,
    useFieldArray,
    useForm,
    useWatch,
    type Control,
    type FieldErrors,
    type UseFormReturn,
} from 'react-hook-form';
import { z } from 'zod';
import {
    DEFAULT_EXPRESSION,
    IMAGE_QUALITIES,
    IMAGE_QUALITY_LABELS,
    IMAGE_SIZES,
    IMAGE_SIZE_LABELS,
} from '@shared/images';
import {
    MAX_AGENTS,
    PERSONA_MAX,
    REASONING_LEVELS,
    RELATIONS_MAX,
    STYLE_MAX,
    TALK_LABELS,
    TALK_LEVELS,
} from '@shared/providers';
import {
    apiErrorMessage,
    rewritePersona,
    rewriteStyle,
    rewriteTopic,
    useCreatePreset,
    usePresets,
    useProfiles,
} from '@services/api';
import { useAiRewrite } from '@hooks/useAiRewrite';
import { useProfileModels } from '@hooks/useProfileModels';
import { stopConversation } from '@services/conversation';
import {
    IMAGE_SETUP_HINT,
    ensurePortraits,
    resolveImageProfile,
} from '@services/images';
import {
    createRoom,
    currentRoomIdAtom,
    faceJobsAtom,
    imageSettingsAtom,
    modalAtom,
    newAgent,
    roomsAtom,
} from '@stores/chat';
import type { Agent, PresetRoom, Room, RoomMode } from '@/types/chat';
import { fromPreset, toPresetRoom } from '@utils/preset/preset';
import { MODE_IDS, modeOf, modeStateOf, shareIntroductionsOf } from '@/modes';
import {
    MODE_UI,
    hasSettings,
    modeSettingsOf,
    modeSettingsShape,
    modeUiOf,
    settingsEditorOf,
    type SettingsMode,
} from '@/modes/ui';
import { currentFace } from '@utils/face/face';
import { Avatar } from '../Avatar';
import { FormRow, FormSection, Segmented } from '../form/FormParts';
import EffortPicker from '../EffortPicker';
import Modal, { ModalBody, ModalFooter, type ModalNavItem } from '../Modal';
import ModelPicker from '../ModelPicker';
import ProfileSelect from '../ProfileSelect';
import AgentGenerator from './AgentGenerator';
import { FEELING_MAX } from '@utils/mind/mind';
import RewriteActions from '../RewriteActions';

const roomFormSchema = z
    .object({
        name: z.string().trim().min(1, '방 이름을 입력하세요').max(60),
        mode: z.enum(MODE_IDS as [RoomMode, ...RoomMode[]]),
        shareIntroductions: z.enum(['default', 'public', 'private']),
        // 모드별 설정 (예: mafia). 방 종류를 바꿔도 각 모드의 설정은 남는다
        ...modeSettingsShape,
        topic: z.string().trim().max(2000),
        castingRules: z.string().trim().max(2000),
        profileId: z.string().nullable(),
        model: z.string().trim().max(200),
        reasoning: z.enum(REASONING_LEVELS).nullable(),
        expressions: z.object({
            enabled: z.boolean(),
            quality: z.enum(IMAGE_QUALITIES),
            size: z.enum(IMAGE_SIZES),
            style: z.string().trim().max(300),
        }),
        agents: z
            .array(
                z.object({
                    id: z.string(),
                    name: z.string().trim().min(1, '이름 필요').max(30),
                    emoji: z.string().trim().max(8),
                    color: z.string(),
                    persona: z.string().trim().max(PERSONA_MAX),
                    style: z.string().trim().max(STYLE_MAX),
                    talk: z.enum(TALK_LEVELS),
                    secret: z.string().trim().max(2000),
                    relations: z.string().trim().max(RELATIONS_MAX),
                    feeling: z.string().trim().max(FEELING_MAX),
                    memories: z.array(z.string()),
                    profileId: z.string().nullable(),
                    model: z.string().trim().max(200),
                    reasoning: z.enum(REASONING_LEVELS).nullable(),
                    imageGen: z.object({
                        enabled: z.boolean(),
                        quality: z.enum(IMAGE_QUALITIES),
                    }),
                })
            )
            .min(1, '에이전트가 한 명 이상 필요합니다')
            .max(MAX_AGENTS, `에이전트는 최대 ${MAX_AGENTS}명까지예요`),
    })
    .superRefine((form, ctx) => {
        if (!hasSettings(form.mode)) return;
        const problem = settingsEditorOf(form.mode).problem?.(
            form[form.mode],
            form.agents
        );
        if (problem)
            ctx.addIssue({
                code: 'custom',
                message: problem,
                path: [form.mode],
            });
    });

export type RoomForm = z.infer<typeof roomFormSchema>;

const DEFAULT_EXPRESSIONS: RoomForm['expressions'] = {
    enabled: false,
    quality: 'low',
    size: '1024x1024',
    style: '',
};

function toForm(room: PresetRoom | undefined): RoomForm {
    if (!room) {
        return {
            name: '',
            mode: 'chat',
            shareIntroductions: 'default',
            ...modeSettingsOf(undefined, 2),
            topic: '',
            castingRules: '',
            profileId: null,
            model: '',
            reasoning: null,
            expressions: DEFAULT_EXPRESSIONS,
            agents: [newAgent(0), newAgent(1)],
        };
    }
    const { name, topic, profileId, agents } = room;
    return {
        name,
        mode: room.mode ?? 'chat',
        shareIntroductions:
            room.shareIntroductions === undefined
                ? 'default'
                : room.shareIntroductions
                  ? 'public'
                  : 'private',
        ...modeSettingsOf(room, agents.length),
        topic,
        castingRules: room.castingRules ?? '',
        profileId,
        // 이전 버전에서 저장된 방에는 model/effort 필드가 없다
        model: room.model ?? '',
        reasoning: room.reasoning ?? null,
        expressions: { ...DEFAULT_EXPRESSIONS, ...room.expressions },
        agents: agents.map((a) => ({
            ...a,
            style: a.style ?? '',
            talk: a.talk ?? 'normal',
            secret: a.secret ?? '',
            relations: a.relations ?? '',
            feeling: a.feeling ?? '',
            memories: a.memories ?? [],
            reasoning: a.reasoning ?? null,
            imageGen: a.imageGen ?? { enabled: false, quality: 'low' },
        })),
    };
}

/** 폼의 세 가지 선택을 저장 형식으로 바꾼다. 기본값은 고정하지 않고 모드를 따른다 */
function roomSettings(values: RoomForm) {
    return {
        ...values,
        shareIntroductions:
            values.shareIntroductions === 'default'
                ? undefined
                : values.shareIntroductions === 'public',
    };
}

type Section = 'basics' | 'agents' | 'images' | 'manage';

const SECTIONS: ModalNavItem<Section>[] = [
    {
        id: 'basics',
        label: '기본 정보',
        icon: MessageSquareText,
        hint: '방 이름, 대화 상황, 방 전체에 쓸 기본 모델.',
    },
    {
        id: 'agents',
        label: '에이전트',
        icon: Users,
        hint: '멤버의 소개·말투·비밀과 모델. 자동 생성도 할 수 있어요.',
    },
    {
        id: 'images',
        label: '이미지 · 표정',
        icon: ImageIcon,
        hint: '표정 아이콘과 에이전트별 사진 보내기.',
    },
    {
        id: 'manage',
        label: '관리',
        icon: Settings2,
        hint: '대화 기록 비우기, 방 삭제.',
    },
];

/** 오류가 있는 첫 섹션 */
function errorSection(errors: FieldErrors<RoomForm>): Section | null {
    if (
        errors.name ||
        errors.topic ||
        errors.model ||
        MODE_IDS.some((id) => hasSettings(id) && errors[id])
    )
        return 'basics';
    if (errors.agents || errors.castingRules) return 'agents';
    if (errors.expressions) return 'images';
    return null;
}

const RoomEditorModal = () => {
    const [modal, setModal] = useAtom(modalAtom);
    const open = modal?.type === 'room';
    const roomId = open ? modal.roomId : null;
    const [section, setSection] = useState<Section>('basics');
    const [alerts, setAlerts] = useState<Section | null>(null);
    const items = SECTIONS.filter((s) => s.id !== 'manage' || roomId).map(
        (s) => ({ ...s, alert: alerts === s.id })
    );
    const close = () => {
        setModal(null);
        setSection('basics');
        setAlerts(null);
    };

    return (
        <Modal
            open={open}
            onClose={close}
            title={roomId ? '채팅방 설정' : '새 채팅방'}
            nav={{ items, active: section, onSelect: setSection }}
        >
            {/* key로 방이 바뀔 때마다 폼을 새로 초기화 */}
            <RoomEditorForm
                key={roomId ?? 'new'}
                roomId={roomId}
                section={section}
                onInvalid={(target) => {
                    setAlerts(target);
                    if (target) setSection(target);
                }}
                onClose={close}
            />
        </Modal>
    );
};

const RoomEditorForm = ({
    roomId,
    section,
    onInvalid,
    onClose,
}: {
    roomId: string | null;
    section: Section;
    onInvalid: (section: Section | null) => void;
    onClose: () => void;
}) => {
    const [rooms, setRooms] = useAtom(roomsAtom);
    const setCurrentRoomId = useSetAtom(currentRoomIdAtom);
    const room = rooms.find((r) => r.id === roomId);

    const {
        register,
        control,
        handleSubmit,
        getValues,
        setValue,
        reset,
        formState: { errors },
    } = useForm<RoomForm>({
        resolver: zodResolver(roomFormSchema),
        defaultValues: toForm(room),
    });
    const { fields, append, remove } = useFieldArray({
        control,
        name: 'agents',
        keyName: 'key',
    });

    /** 폼에 없는 얼굴 이미지 정보의 출처 (기존 방 또는 불러온 프리셋의 에이전트) */
    const [faceSource, setFaceSource] = useState(
        () => new Map<string, Agent>(room?.agents.map((a) => [a.id, a]))
    );
    /** 불러온 프리셋의 자동 반응 설정 (새 방에만 쓴다) */
    const [presetAutoReply, setPresetAutoReply] = useState<boolean>();
    const createPreset = useCreatePreset();

    const buildAgents = (values: RoomForm): Agent[] =>
        values.agents.map((a) => {
            const prev = faceSource.get(a.id);
            return {
                ...(prev && {
                    portrait: prev.portrait,
                    faces: prev.faces,
                    expression: prev.expression,
                }),
                ...a,
                emoji: a.emoji || '🙂',
            };
        });

    const loadPreset = (preset: PresetRoom) => {
        const data = fromPreset(preset);
        reset(toForm(data));
        setFaceSource(new Map(data.agents.map((a) => [a.id, a])));
        setPresetAutoReply(data.autoReply);
        onInvalid(null);
    };

    /** 저장하지 않은 수정까지 포함한 지금 설정을 프리셋으로 남긴다 (대화 기록 제외) */
    const savePreset = handleSubmit(
        async (values) => {
            onInvalid(null);
            const name = prompt('프리셋 이름', values.name)?.trim();
            if (!name) return;
            try {
                await createPreset.mutateAsync({
                    name: name.slice(0, 60),
                    room: toPresetRoom({
                        ...roomSettings(values),
                        autoReply: room ? room.autoReply : presetAutoReply,
                        agents: buildAgents(values),
                    }),
                });
                toast.success(`"${name}" 프리셋으로 저장했어요.`);
            } catch (err) {
                toast.error(await apiErrorMessage(err));
            }
        },
        (errs) => onInvalid(errorSection(errs))
    );

    const onSubmit = handleSubmit(
        (values) => {
            onInvalid(null);
            const agents = buildAgents(values);
            const settings = roomSettings(values);
            // 이전 공개 설정으로 생성 중인 메모·발언을 저장 뒤에 전달하지 않도록 취소한다
            if (
                room &&
                shareIntroductionsOf(room) !== shareIntroductionsOf(settings)
            )
                stopConversation(room.id);
            let id = room?.id;
            if (room) {
                setRooms((prev) =>
                    prev.map((r) => {
                        if (r.id !== room.id) return r;
                        // 이전 버전의 발언 순서/최대 발언/대기 필드는 진행 모델로 대체되어 버린다
                        const { id, messages, updatedAt, autoReply } = r;
                        return {
                            id,
                            messages,
                            updatedAt,
                            autoReply,
                            // 모드 진행 상태(예: 게임)는 그대로 둔다 (바뀐 모드 설정은 다음 판부터)
                            ...modeStateOf(r),
                            ...settings,
                            agents: agents.map((a) =>
                                keepLiveMind(a, faceSource.get(a.id), r)
                            ),
                        };
                    })
                );
            } else {
                id = createRoom({
                    ...settings,
                    autoReply: presetAutoReply,
                    agents,
                }).id;
                setCurrentRoomId(id);
            }
            // 표정 기능을 켰으면 얼굴이 없는 에이전트의 아이콘을 바로 만든다
            if (id && values.expressions.enabled) void ensurePortraits(id);
            onClose();
        },
        (errs) => onInvalid(errorSection(errs))
    );

    const clearMessages = () => {
        if (!room || !confirm('이 방의 대화 내용을 모두 지울까요?')) return;
        stopConversation(room.id);
        setRooms((prev) =>
            prev.map((r) => (r.id === room.id ? { ...r, messages: [] } : r))
        );
        onClose();
    };

    const deleteRoom = () => {
        if (!room || !confirm(`"${room.name}" 방을 삭제할까요?`)) return;
        stopConversation(room.id);
        setRooms((prev) => prev.filter((r) => r.id !== room.id));
        setCurrentRoomId((cur) => (cur === room.id ? null : cur));
        onClose();
    };

    // 섹션을 옮겨도 입력이 사라지지 않도록 모두 렌더링하고 보이는 것만 바꾼다
    const show = (id: Section) => (section === id ? undefined : 'hidden');

    return (
        <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col">
            <ModalBody>
                <div className={show('basics')}>
                    <div className="flex flex-col gap-6">
                        {!room && <PresetLoader onLoad={loadPreset} />}
                        <FormSection>
                            <ModeField
                                control={control}
                                getValues={getValues}
                                setValue={setValue}
                                fresh={!room}
                            />
                            <label className="label">
                                방 이름
                                <input
                                    className="field"
                                    autoFocus
                                    {...register('name')}
                                />
                                {errors.name && (
                                    <small className="font-normal text-red-500">
                                        {errors.name.message}
                                    </small>
                                )}
                            </label>

                            <TopicField
                                control={control}
                                register={register}
                                getValues={getValues}
                                setValue={setValue}
                            />
                        </FormSection>

                        <ModeSettingsField
                            control={control}
                            setValue={setValue}
                            errors={errors}
                            live={!!room && modeOf(room).isLive(room)}
                        />

                        <FormSection title="대화">
                            <IntroductionSharingField control={control} />
                        </FormSection>

                        <FormSection
                            title="기본 모델"
                            description="에이전트에서 따로 정하지 않으면 이 값을 써요."
                        >
                            <RoomModelFields
                                control={control}
                                setValue={setValue}
                            />
                        </FormSection>
                    </div>
                </div>

                <div className={show('agents')}>
                    <div className="flex flex-col gap-4">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <h3 className="text-[15px] font-bold">
                                멤버{' '}
                                <span className="font-normal text-neutral-500">
                                    ({fields.length}명)
                                </span>
                            </h3>
                            <div className="flex flex-wrap items-center justify-end gap-1.5">
                                <AgentGenerator
                                    control={control}
                                    getValues={getValues}
                                    castingInput={() => {
                                        const form = getValues();
                                        return {
                                            roomName: form.name,
                                            topic: form.topic,
                                            castingRules: form.castingRules,
                                            modeContext:
                                                modeOf(form).castingContext ??
                                                undefined,
                                            shareIntroductions:
                                                shareIntroductionsOf(
                                                    roomSettings(form)
                                                ),
                                        };
                                    }}
                                    onReplace={(removeIds, add) => {
                                        remove(
                                            getValues('agents')
                                                .map((a, i) =>
                                                    removeIds.includes(a.id)
                                                        ? i
                                                        : -1
                                                )
                                                .filter((i) => i >= 0)
                                        );
                                        append(add);
                                    }}
                                />
                                <button
                                    type="button"
                                    className="btn-ghost flex items-center gap-1"
                                    disabled={fields.length >= MAX_AGENTS}
                                    onClick={() =>
                                        append(newAgent(fields.length))
                                    }
                                >
                                    <Plus size={15} /> 에이전트 추가
                                </button>
                            </div>
                        </div>

                        <label className="label -mt-1 text-xs font-normal text-neutral-500">
                            자동 생성 규칙 (선택)
                            <textarea
                                className="field resize-y text-sm"
                                rows={2}
                                placeholder="예: 일상 직업과 취미가 다른 참가자. 모두 20대, 반말 위주. 의심 많은 사람과 낙관적인 사람을 섞는다"
                                {...register('castingRules')}
                            />
                        </label>
                        {errors.agents?.root && (
                            <small className="-mt-2 text-red-500">
                                {errors.agents.root.message}
                            </small>
                        )}
                        {errors.agents?.message && (
                            <small className="-mt-2 text-red-500">
                                {errors.agents.message}
                            </small>
                        )}

                        <div className="flex flex-col gap-2.5">
                            {fields.map((field, index) => (
                                <div
                                    key={field.key}
                                    className="flex gap-2 rounded-xl border border-neutral-200 bg-neutral-50 p-2.5"
                                >
                                    <div className="flex flex-col gap-1.5">
                                        <input
                                            className="field h-10 w-12 px-0 text-center text-xl"
                                            maxLength={8}
                                            title="이모지"
                                            {...register(
                                                `agents.${index}.emoji`
                                            )}
                                        />
                                        <input
                                            type="color"
                                            className="h-7 w-12 cursor-pointer rounded border-0 bg-transparent p-0"
                                            title="프로필 색"
                                            {...register(
                                                `agents.${index}.color`
                                            )}
                                        />
                                    </div>
                                    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                                        <div className="flex flex-wrap gap-1.5">
                                            <input
                                                className="field min-w-24 flex-1"
                                                placeholder="이름"
                                                {...register(
                                                    `agents.${index}.name`
                                                )}
                                            />
                                            <Controller
                                                control={control}
                                                name={`agents.${index}.profileId`}
                                                render={({ field: f }) => (
                                                    <ProfileSelect
                                                        value={f.value}
                                                        onChange={f.onChange}
                                                        inheritLabel="방 프로필 사용"
                                                        className="field min-w-36 flex-1"
                                                    />
                                                )}
                                            />
                                            <AgentModelInput
                                                control={control}
                                                index={index}
                                            />
                                            <Controller
                                                control={control}
                                                name={`agents.${index}.reasoning`}
                                                render={({ field: f }) => (
                                                    <EffortPicker
                                                        value={f.value}
                                                        onChange={f.onChange}
                                                        inheritLabel="Effort: 방 설정"
                                                        prefixed
                                                        className="w-auto min-w-32 flex-1"
                                                    />
                                                )}
                                            />
                                            <button
                                                type="button"
                                                className="icon-btn"
                                                title="삭제"
                                                onClick={() => remove(index)}
                                            >
                                                <X size={16} />
                                            </button>
                                        </div>
                                        <PersonaField
                                            control={control}
                                            index={index}
                                            register={register}
                                            getValues={getValues}
                                            setValue={setValue}
                                        />
                                        <StyleField
                                            control={control}
                                            index={index}
                                            register={register}
                                            getValues={getValues}
                                            setValue={setValue}
                                        />
                                        <DetailsField
                                            control={control}
                                            register={register}
                                            name={`agents.${index}.relations`}
                                            summary="🤝 관계·요즘"
                                            placeholder="예: 민수와는 입사 동기라 편하게 놀리는 사이. 영희한테 지난주 커피 빚짐. 요즘 이사 준비로 피곤함. 이 멤버의 프롬프트에만 들어가요"
                                        />
                                        <DetailsField
                                            control={control}
                                            register={register}
                                            name={`agents.${index}.feeling`}
                                            summary="💭 지금 감정"
                                            placeholder="예: 갇힌 게 무서워서 누구도 못 믿겠음. 대화하면서 이 멤버가 스스로 바꿔 가요. 이 멤버의 프롬프트에만 들어가요"
                                        />
                                        <MemoriesField
                                            control={control}
                                            index={index}
                                            setValue={setValue}
                                        />
                                        <DetailsField
                                            control={control}
                                            register={register}
                                            name={`agents.${index}.secret`}
                                            summary="🔒 나만 아는 것 (비밀)"
                                            placeholder="예: 너는 마피아다. 같은 편은 능청이. 민수와는 몰래 사귀는 중. 다른 멤버, 진행 모델, AI 도우미에게는 보이지 않아요"
                                        />
                                        {errors.agents?.[index]?.name && (
                                            <small className="text-red-500">
                                                {
                                                    errors.agents[index]?.name
                                                        ?.message
                                                }
                                            </small>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                <div className={show('images')}>
                    <ImageFields
                        control={control}
                        register={register}
                        fieldKeys={fields.map((f) => f.key)}
                        room={room}
                    />
                </div>

                {room && (
                    <div className={show('manage')}>
                        <div className="flex flex-col gap-3">
                            <DangerRow
                                title="대화 비우기"
                                description="이 방의 메시지를 모두 지워요. 멤버와 설정, 얼굴 이미지는 그대로예요."
                                action="대화 비우기"
                                onClick={clearMessages}
                            />
                            <DangerRow
                                title="방 삭제"
                                description="방과 대화 기록을 모두 지워요. 되돌릴 수 없어요."
                                action="방 삭제"
                                onClick={deleteRoom}
                            />
                        </div>
                    </div>
                )}
            </ModalBody>
            <ModalFooter>
                <button
                    type="button"
                    className="btn-ghost flex items-center gap-1.5"
                    disabled={createPreset.isPending}
                    title="대화 기록 없이 지금 방 설정과 멤버를 프리셋으로 저장해요"
                    onClick={() => void savePreset()}
                >
                    <BookmarkPlus size={15} /> 프리셋으로 저장
                </button>
                <div className="flex-1" />
                <button type="button" className="btn-ghost" onClick={onClose}>
                    취소
                </button>
                <button type="submit" className="btn-primary">
                    저장
                </button>
            </ModalFooter>
        </form>
    );
};

/** 새 방을 저장된 프리셋으로 채운다 */
const PresetLoader = ({ onLoad }: { onLoad: (room: PresetRoom) => void }) => {
    const { data } = usePresets();
    const [picked, setPicked] = useState('');
    if (!data?.length) return null;
    return (
        <FormRow
            label="프리셋에서 시작"
            htmlFor="room-preset"
            description="고르면 방 설정과 멤버가 프리셋 내용으로 바뀌어요."
        >
            <select
                id="room-preset"
                className="field w-56"
                value={picked}
                onChange={(e) => {
                    const preset = data.find((p) => p.id === e.target.value);
                    setPicked(e.target.value);
                    if (preset) onLoad(preset.room);
                }}
            >
                <option value="">빈 방으로 시작</option>
                {data.map((p) => (
                    <option key={p.id} value={p.id}>
                        {p.name} · {p.room.agents.length}명
                    </option>
                ))}
            </select>
        </FormRow>
    );
};

const DangerRow = ({
    title,
    description,
    action,
    onClick,
}: {
    title: string;
    description: string;
    action: string;
    onClick: () => void;
}) => (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-red-100 p-3">
        <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold">{title}</div>
            <p className="text-xs text-neutral-500">{description}</p>
        </div>
        <button
            type="button"
            className="btn-danger border border-red-200"
            onClick={onClick}
        >
            {action}
        </button>
    </div>
);

/** 방의 표정 기능과 에이전트별 사진 보내기 설정 */
const ImageFields = ({
    control,
    register,
    fieldKeys,
    room,
}: {
    control: Control<RoomForm>;
    register: Form['register'];
    fieldKeys: string[];
    room: Room | undefined;
}) => {
    const settings = useAtomValue(imageSettingsAtom);
    const { data } = useProfiles();
    const ready = !!resolveImageProfile(settings, data);
    const jobs = useAtomValue(faceJobsAtom);
    const enabled = useWatch({ control, name: 'expressions.enabled' });
    const agents = useWatch({ control, name: 'agents' });
    const savedOn = !!room?.expressions?.enabled;

    return (
        <div className="flex flex-col gap-5">
            {!ready && (
                <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    이미지 기능을 쓰려면 {IMAGE_SETUP_HINT}
                </p>
            )}

            <section className="flex flex-col gap-3 rounded-xl border border-neutral-200 p-3">
                <label className="flex cursor-pointer items-start gap-3">
                    <input
                        type="checkbox"
                        className="mt-0.5 size-4 accent-yellow-500"
                        {...register('expressions.enabled')}
                    />
                    <span className="flex-1">
                        <span className="block text-sm font-semibold">
                            표정 기능
                        </span>
                        <span className="block text-xs text-neutral-500">
                            저장하면 바로 각 에이전트의 얼굴을 만들어 아이콘을
                            바꿔요. 대화하며 기분이 바뀌면 같은 얼굴을 참고해 새
                            표정을 만들고, 그다음 말풍선부터 그 얼굴로 보여요.
                            한 번 만든 표정은 다시 써요.
                        </span>
                    </span>
                </label>
                <div className="grid gap-3 sm:grid-cols-2">
                    <label className="label">
                        품질
                        <select
                            className="field"
                            disabled={!enabled}
                            {...register('expressions.quality')}
                        >
                            {IMAGE_QUALITIES.map((q) => (
                                <option key={q} value={q}>
                                    {IMAGE_QUALITY_LABELS[q]}
                                </option>
                            ))}
                        </select>
                    </label>
                    <label className="label">
                        해상도
                        <select
                            className="field"
                            disabled={!enabled}
                            {...register('expressions.size')}
                        >
                            {IMAGE_SIZES.map((size) => (
                                <option key={size} value={size}>
                                    {IMAGE_SIZE_LABELS[size]}
                                </option>
                            ))}
                        </select>
                    </label>
                    <label className="label sm:col-span-2">
                        그림체 (선택)
                        <input
                            className="field"
                            disabled={!enabled}
                            maxLength={300}
                            placeholder="예: 지브리풍 수채화 / 3D 픽사 스타일 / 실사 증명사진"
                            {...register('expressions.style')}
                        />
                    </label>
                </div>
            </section>

            <section className="flex flex-col gap-2">
                <div>
                    <h3 className="text-[15px] font-bold">에이전트별 이미지</h3>
                    <p className="text-xs text-neutral-500">
                        사진 보내기를 켜면 에이전트가 직접 프롬프트를 써서 자기
                        얼굴이 아닌 사진·그림을 대화에 보낼 수 있어요. 한 번의
                        대화 진행에서 최대 2장까지예요.
                    </p>
                </div>
                <ul className="flex flex-col divide-y divide-neutral-100 rounded-xl border border-neutral-200">
                    {fieldKeys.map((key, index) => {
                        const agent = agents[index];
                        if (!agent) return null;
                        const saved = room?.agents.find(
                            (a) => a.id === agent.id
                        );
                        const face =
                            enabled && saved ? currentFace(saved) : undefined;
                        const job = room
                            ? jobs[`${room.id}:${agent.id}`]
                            : undefined;
                        return (
                            <li
                                key={key}
                                className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2"
                            >
                                <Avatar
                                    emoji={agent.emoji || '🙂'}
                                    color={agent.color}
                                    image={face}
                                />
                                <div className="min-w-0 flex-1">
                                    <div className="truncate text-sm font-semibold">
                                        {agent.name || '이름 없음'}
                                    </div>
                                    <div className="truncate text-[11px] text-neutral-500">
                                        {job ? (
                                            <span className="inline-flex items-center gap-1 text-violet-600">
                                                <Loader2
                                                    size={11}
                                                    className="animate-spin"
                                                />
                                                {job}
                                            </span>
                                        ) : !enabled ? (
                                            '이모지 아이콘'
                                        ) : saved?.portrait ? (
                                            `표정: ${saved.expression ?? DEFAULT_EXPRESSION} · 만든 표정 ${Object.keys(saved.faces ?? {}).length}개`
                                        ) : (
                                            '저장하면 얼굴을 만들어요'
                                        )}
                                    </div>
                                </div>
                                <label className="flex items-center gap-1.5 text-xs text-neutral-700">
                                    <input
                                        type="checkbox"
                                        className="size-4 accent-yellow-500"
                                        {...register(
                                            `agents.${index}.imageGen.enabled`
                                        )}
                                    />
                                    사진 보내기
                                </label>
                                <select
                                    className="field w-auto py-1.5 text-xs"
                                    title="이 에이전트가 보내는 사진의 품질"
                                    disabled={!agent.imageGen?.enabled}
                                    {...register(
                                        `agents.${index}.imageGen.quality`
                                    )}
                                >
                                    {IMAGE_QUALITIES.map((q) => (
                                        <option key={q} value={q}>
                                            품질 {IMAGE_QUALITY_LABELS[q]}
                                        </option>
                                    ))}
                                </select>
                                {room && savedOn && saved?.portrait && (
                                    <button
                                        type="button"
                                        className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-neutral-600 hover:bg-black/5 disabled:opacity-50"
                                        disabled={!!job || !ready}
                                        title="저장된 설명으로 얼굴을 다시 만들어요. 만든 표정은 초기화돼요."
                                        onClick={() =>
                                            void ensurePortraits(room.id, [
                                                agent.id,
                                            ])
                                        }
                                    >
                                        <RefreshCw size={12} /> 얼굴 다시
                                    </button>
                                )}
                            </li>
                        );
                    })}
                </ul>
            </section>
        </div>
    );
};

type Form = UseFormReturn<RoomForm>;

/** 방 기본 AI: 프로필 · 모델 · effort. 에이전트가 따로 정하지 않으면 이 값을 쓴다. */
const RoomModelFields = ({
    control,
    setValue,
}: {
    control: Control<RoomForm>;
    setValue: Form['setValue'];
}) => {
    const roomProfileId = useWatch({ control, name: 'profileId' });
    const { profile, keyReady, options, inheritLabel } =
        useProfileModels(roomProfileId);

    return (
        <div className="grid gap-3 sm:grid-cols-3">
            <label className="label">
                프로필
                <Controller
                    control={control}
                    name="profileId"
                    render={({ field }) => (
                        <ProfileSelect
                            value={field.value}
                            onChange={(id) => {
                                field.onChange(id);
                                // 모델 ID는 프로바이더마다 다르므로 프로필이 바뀌면 초기화
                                setValue('model', '');
                            }}
                            inheritLabel="전역 기본 프로필 (★)"
                        />
                    )}
                />
            </label>
            <div className="label">
                모델
                <Controller
                    control={control}
                    name="model"
                    render={({ field }) => (
                        <ModelPicker
                            key={profile?.id}
                            value={field.value}
                            onChange={field.onChange}
                            models={options}
                            disabled={!keyReady}
                            inheritLabel={inheritLabel}
                        />
                    )}
                />
            </div>
            <label className="label">
                Effort
                <Controller
                    control={control}
                    name="reasoning"
                    render={({ field }) => (
                        <EffortPicker
                            value={field.value}
                            onChange={field.onChange}
                            inheritLabel="프로필 기본값"
                        />
                    )}
                />
            </label>
        </div>
    );
};

/** 에이전트에 적용될 프로필(에이전트 → 방 → 전역 기본)의 모델 선택. 비우면 방 모델을 따른다. */
const AgentModelInput = ({
    control,
    index,
}: {
    control: Control<RoomForm>;
    index: number;
}) => {
    const { data } = useProfiles();
    const agentProfileId = useWatch({
        control,
        name: `agents.${index}.profileId`,
    });
    const roomProfileId = useWatch({ control, name: 'profileId' });
    const roomModel = useWatch({ control, name: 'model' });
    const { profile, keyReady, options, inheritLabel } = useProfileModels(
        agentProfileId ?? roomProfileId ?? data?.defaultProfileId
    );
    // 자기 프로필을 따로 고른 에이전트는 방 모델을 물려받지 않는다 (엔진과 같은 규칙)
    const label =
        keyReady && !agentProfileId && roomModel
            ? `방 모델 (${roomModel})`
            : inheritLabel;

    return (
        <Controller
            control={control}
            name={`agents.${index}.model`}
            render={({ field }) => (
                <ModelPicker
                    key={profile?.id}
                    className="min-w-36 flex-1"
                    value={field.value}
                    onChange={field.onChange}
                    models={options}
                    disabled={!keyReady}
                    inheritLabel={label}
                />
            )}
        />
    );
};

/** 대화 주제/상황 입력 + AI 도우미 모델로 다듬기 (되돌리기 가능) */
const TopicField = ({
    control,
    register,
    getValues,
    setValue,
}: {
    control: Control<RoomForm>;
    register: Form['register'];
    getValues: Form['getValues'];
    setValue: Form['setValue'];
}) => {
    const topic = useWatch({ control, name: 'topic' });
    const ui = modeUiOf(useWatch({ control, name: 'mode' }));
    const ai = useAiRewrite((text) =>
        setValue('topic', text, { shouldDirty: true, shouldValidate: true })
    );

    const run = () => {
        const form = getValues();
        return ai.rewrite(form.topic, (model) =>
            rewriteTopic({
                ...model,
                roomName: form.name,
                brief: form.topic,
                members: form.agents.map((a) => ({
                    name: a.name,
                    persona: a.persona,
                })),
            })
        );
    };

    return (
        <div className="label">
            {ui.topicLabel}
            <textarea
                className="field resize-y disabled:bg-neutral-100"
                rows={ai.canUndo ? 4 : 2}
                disabled={ai.busy}
                placeholder={ui.topicPlaceholder}
                {...register('topic')}
            />
            <RewriteActions
                busy={ai.busy}
                keyReady={ai.keyReady}
                canUndo={ai.canUndo}
                empty={!topic?.trim()}
                onRewrite={run}
                onUndo={ai.undo}
            />
        </div>
    );
};

/** 방 종류 (일반 대화, 마피아 게임 …) */
const ModeField = ({
    control,
    getValues,
    setValue,
    fresh,
}: {
    control: Control<RoomForm>;
    getValues: Form['getValues'];
    setValue: Form['setValue'];
    /** 새 방이면 모드를 고를 때 빈 칸을 그 모드의 예시로 채운다 */
    fresh: boolean;
}) => {
    const mode = useWatch({ control, name: 'mode' });
    const pick = (next: RoomMode) => {
        setValue('mode', next, { shouldDirty: true, shouldValidate: true });
        if (!fresh) return;
        const form = getValues();
        const starter = MODE_UI[next].starter;
        if (starter) {
            if (!form.name.trim()) setValue('name', starter.name);
            if (!form.topic.trim()) setValue('topic', starter.topic);
            if (!form.castingRules.trim())
                setValue('castingRules', starter.castingRules);
        }
        const fit = hasSettings(next) && settingsEditorOf(next).fit;
        if (fit && hasSettings(next))
            setValue(next, fit(form[next], form.agents.length));
    };
    return (
        <div className="flex flex-col gap-2">
            <FormRow label="방 종류">
                <Segmented
                    label="방 종류"
                    value={mode}
                    onChange={pick}
                    options={MODE_IDS.map((id) => ({
                        value: id,
                        label: MODE_UI[id].label,
                    }))}
                />
            </FormRow>
            <p className="text-xs leading-relaxed text-neutral-500">
                {modeUiOf(mode).editorHint}
            </p>
        </div>
    );
};

/** 서로의 소개 공개 여부. 기본값 선택은 모드를 바꾸어도 새 모드의 기본값을 따른다 */
const IntroductionSharingField = ({
    control,
}: {
    control: Control<RoomForm>;
}) => {
    const mode = useWatch({ control, name: 'mode' });
    const defaultPublic = modeOf({ mode }).defaultShareIntroductions;
    return (
        <Controller
            control={control}
            name="shareIntroductions"
            render={({ field }) => (
                <FormRow
                    label="서로의 소개 공개"
                    htmlFor="room-share-intro"
                    description="공개하면 서로의 소개 첫 문장(최대 80자)을 미리 알고, 비공개면 이름만 알아요. 말투·행동과 비밀 정보는 언제나 각자만 봐요."
                >
                    <select
                        id="room-share-intro"
                        className="field w-44"
                        {...field}
                    >
                        <option value="default">
                            모드 기본값 ({defaultPublic ? '공개' : '비공개'})
                        </option>
                        <option value="public">공개</option>
                        <option value="private">비공개</option>
                    </select>
                </FormRow>
            )}
        />
    );
};

/** 고른 모드의 설정 칸 (설정이 없는 모드면 아무것도 없다) */
const ModeSettingsField = ({
    control,
    ...props
}: Omit<SettingsFieldsProps, 'mode'>) => {
    const mode = useWatch({ control, name: 'mode' });
    if (!hasSettings(mode)) return null;
    // 모드마다 설정 칸이 달라서 모드가 바뀌면 새로 그린다
    return (
        <SettingsFields key={mode} mode={mode} control={control} {...props} />
    );
};

interface SettingsFieldsProps {
    mode: SettingsMode;
    control: Control<RoomForm>;
    setValue: Form['setValue'];
    errors: FieldErrors<RoomForm>;
    live: boolean;
}

const SettingsFields = ({
    mode,
    control,
    setValue,
    errors,
    live,
}: SettingsFieldsProps) => {
    const value = useWatch({ control, name: mode });
    const agents = useWatch({ control, name: 'agents' });
    const { Fields } = settingsEditorOf(mode);
    return (
        <Fields
            value={value}
            onChange={(next) =>
                setValue(mode, next, {
                    shouldDirty: true,
                    shouldValidate: true,
                })
            }
            agents={agents}
            error={errors[mode]?.message}
            live={live}
        />
    );
};

/** 에이전트 칸 위의 작은 이름표 */
const FieldLabel = ({ children }: { children: ReactNode }) => (
    <span className="text-xs text-neutral-500">{children}</span>
);

/**
 * 캐릭터 소개 입력 + AI 도우미 모델로 다듬기 (되돌리기 가능).
 * 말투·행동이 비어 있으면 다듬을 때 말투·행동도 함께 채운다.
 */
const PersonaField = ({
    control,
    index,
    register,
    getValues,
    setValue,
}: {
    control: Control<RoomForm>;
    index: number;
    register: Form['register'];
    getValues: Form['getValues'];
    setValue: Form['setValue'];
}) => {
    const brief = useWatch({ control, name: `agents.${index}.persona` });
    const ai = useAiRewrite<{ persona: string; style: string }>((v) => {
        setValue(`agents.${index}.persona`, v.persona, { shouldDirty: true });
        setValue(`agents.${index}.style`, v.style, { shouldDirty: true });
    });

    const run = () => {
        const form = getValues();
        const agent = form.agents[index];
        const current = { persona: agent.persona, style: agent.style };
        return ai.rewrite(
            current,
            (model) =>
                rewritePersona({
                    ...model,
                    agentName: agent.name.trim() || '이름없음',
                    brief: agent.persona,
                    style: agent.style,
                    roomName: form.name,
                    topic: form.topic,
                    others: form.agents
                        .filter((_, i) => i !== index)
                        .map((a) => ({
                            name: a.name,
                            persona: a.persona,
                            style: a.style,
                        })),
                }),
            (res) => ({
                persona: res.text,
                style: res.style ?? current.style,
            })
        );
    };

    return (
        <div className="flex flex-col gap-1">
            <FieldLabel>소개</FieldLabel>
            <textarea
                className="field resize-y disabled:bg-neutral-100"
                rows={ai.canUndo ? 4 : 2}
                disabled={ai.busy}
                placeholder="어떤 사람인지. 성격, 직업/역할, 이 주제에 대한 입장 (예: 츤데레 고양이 집사, 회식 반대파). 짧게 적고 ✨를 누르면 자세히 써 줘요"
                {...register(`agents.${index}.persona`)}
            />
            <RewriteActions
                busy={ai.busy}
                keyReady={ai.keyReady}
                canUndo={ai.canUndo}
                empty={!brief?.trim()}
                onRewrite={run}
                onUndo={ai.undo}
            />
        </div>
    );
};

/** 말투·행동 입력 + 말수 선택 + AI 도우미 모델로 다듬기. 비어 있으면 기본 단톡방 말투 */
const StyleField = ({
    control,
    index,
    register,
    getValues,
    setValue,
}: {
    control: Control<RoomForm>;
    index: number;
    register: Form['register'];
    getValues: Form['getValues'];
    setValue: Form['setValue'];
}) => {
    const style = useWatch({ control, name: `agents.${index}.style` });
    const persona = useWatch({ control, name: `agents.${index}.persona` });
    const ai = useAiRewrite((text) =>
        setValue(`agents.${index}.style`, text, { shouldDirty: true })
    );

    const run = () => {
        const form = getValues();
        const agent = form.agents[index];
        return ai.rewrite(agent.style, (model) =>
            rewriteStyle({
                ...model,
                agentName: agent.name.trim() || '이름없음',
                brief: agent.style,
                persona: agent.persona,
                roomName: form.name,
                topic: form.topic,
                others: form.agents
                    .filter((_, i) => i !== index)
                    .map((a) => ({ name: a.name, style: a.style })),
            })
        );
    };

    return (
        <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between gap-2">
                <FieldLabel>말투·행동</FieldLabel>
                <Controller
                    control={control}
                    name={`agents.${index}.talk`}
                    render={({ field: f }) => (
                        <div
                            className="flex overflow-hidden rounded-md border border-neutral-200 text-xs"
                            role="radiogroup"
                            aria-label="말수"
                            title="진행 모델이 이 에이전트를 얼마나 자주 고를지"
                        >
                            {TALK_LEVELS.map((level) => (
                                <button
                                    key={level}
                                    type="button"
                                    role="radio"
                                    aria-checked={f.value === level}
                                    className={
                                        f.value === level
                                            ? 'bg-violet-100 px-2 py-0.5 font-semibold text-violet-700'
                                            : 'px-2 py-0.5 text-neutral-500 hover:bg-black/5'
                                    }
                                    onClick={() => f.onChange(level)}
                                >
                                    {TALK_LABELS[level]}
                                </button>
                            ))}
                        </div>
                    )}
                />
            </div>
            <textarea
                className="field resize-y disabled:bg-neutral-100"
                rows={ai.canUndo ? 4 : 2}
                disabled={ai.busy}
                placeholder="예: 반말, 한두 마디, 잘 따지고 듦, 긴장하면 말이 빨라짐. 비워 두면 소개만 보고 말투를 정해요. ✨를 누르면 소개에 맞게 써 줘요"
                {...register(`agents.${index}.style`)}
            />
            <RewriteActions
                busy={ai.busy}
                keyReady={ai.keyReady}
                canUndo={ai.canUndo}
                empty={!style?.trim() && !persona?.trim()}
                onRewrite={run}
                onUndo={ai.undo}
            />
        </div>
    );
};

/** 이 에이전트 프롬프트에만 들어가는 접이식 칸(관계·요즘, 비밀). 비어 있으면 접어 둔다 */
const DetailsField = ({
    control,
    register,
    name,
    summary,
    placeholder,
}: {
    control: Control<RoomForm>;
    register: Form['register'];
    name:
        | `agents.${number}.relations`
        | `agents.${number}.secret`
        | `agents.${number}.feeling`;
    summary: string;
    placeholder: string;
}) => {
    const value = useWatch({ control, name });
    // 처음 열 때만 내용 유무로 펼침 여부를 정하고, 이후 열고 닫기는 사용자에게 맡긴다
    const [initialOpen] = useState(() => !!value?.trim());
    return (
        <details className="text-xs text-neutral-500" open={initialOpen}>
            <summary className="cursor-pointer select-none">{summary}</summary>
            <textarea
                className="field mt-1 resize-y"
                rows={2}
                placeholder={placeholder}
                {...register(name)}
            />
        </details>
    );
};

/**
 * 편집기를 연 사이 대화로 바뀐 감정·기억은, 사용자가 편집기에서 고치지 않았으면 최신 것을 지킨다
 * @param opened 편집기를 열 때의 에이전트
 */
function keepLiveMind(agent: Agent, opened: Agent | undefined, live: Room) {
    const now = live.agents.find((a) => a.id === agent.id);
    if (!opened || !now) return agent;
    const memories = opened.memories ?? [];
    const memoriesSame =
        agent.memories?.length === memories.length &&
        agent.memories.every((m, i) => m === memories[i]);
    return {
        ...agent,
        feeling:
            (agent.feeling ?? '') === (opened.feeling ?? '').trim()
                ? now.feeling
                : agent.feeling,
        memories: memoriesSame ? now.memories : agent.memories,
    };
}

/** 이 멤버가 대화하며 쌓은 기억. 직접 쓰지는 않고 필요 없는 것만 지운다 */
const MemoriesField = ({
    control,
    index,
    setValue,
}: {
    control: Control<RoomForm>;
    index: number;
    setValue: Form['setValue'];
}) => {
    const memories = useWatch({ control, name: `agents.${index}.memories` });
    if (!memories?.length) return null;
    const set = (next: string[]) =>
        setValue(`agents.${index}.memories`, next, { shouldDirty: true });
    return (
        <details className="text-xs text-neutral-500">
            <summary className="cursor-pointer select-none">
                🧠 기억 {memories.length}개
            </summary>
            <ul className="mt-1 flex flex-col gap-1">
                {memories.map((memory, i) => (
                    <li
                        key={`${i}-${memory}`}
                        className="flex items-start gap-1.5 rounded bg-neutral-50 px-2 py-1 text-neutral-700"
                    >
                        <span className="min-w-0 flex-1 break-words">
                            {memory}
                        </span>
                        <button
                            type="button"
                            className="shrink-0 text-neutral-400 hover:text-red-500"
                            aria-label="이 기억 지우기"
                            onClick={() =>
                                set(memories.filter((_, j) => j !== i))
                            }
                        >
                            <X size={12} />
                        </button>
                    </li>
                ))}
            </ul>
            <button
                type="button"
                className="mt-1 text-neutral-400 underline hover:text-red-500"
                onClick={() => set([])}
            >
                모두 지우기
            </button>
        </details>
    );
};

export default RoomEditorModal;
