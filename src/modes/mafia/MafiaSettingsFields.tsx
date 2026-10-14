import { useId } from 'react';
import {
    FormRow,
    FormSection,
    Segmented,
    Stepper,
    Switch,
} from '@components/form/FormParts';
import { cn } from '@utils/cn/cn';
import type { ModeSettingsFieldsProps } from '../uiTypes';
import {
    DAY_TALK_OPTIONS,
    MAX_HELPERS,
    MAX_MAFIA,
    USER_ROLES,
    USER_ROLE_LABELS,
    ROLE_LABELS,
    ROLE_ORDER,
    gameSeats,
    playerCount,
    setupProblem,
} from './rules';
import type { MafiaRole, MafiaSetup } from './types';
import RoleGlyph from './RoleGlyph';

const DAY_TALK_LABELS = ['짧게', '보통', '길게'];

/** 인원을 정하는 특수 역할 (시민은 남는 자리) */
const COUNTED = [
    { role: 'mafia', min: 1, max: MAX_MAFIA, note: '밤마다 한 명을 노려요' },
    {
        role: 'doctor',
        min: 0,
        max: MAX_HELPERS,
        note: '밤마다 한 명을 지켜요',
    },
    {
        role: 'police',
        min: 0,
        max: MAX_HELPERS,
        note: '밤마다 한 명을 조사해요',
    },
] as const;

/** 마피아 게임 설정: 내 자리, 역할 구성, 배분 방식, 진행 */
const MafiaSettingsFields = ({
    value: setup,
    onChange,
    agents,
    error,
    live,
}: ModeSettingsFieldsProps<MafiaSetup>) => {
    const id = useId();
    const set = <K extends keyof MafiaSetup>(key: K, v: MafiaSetup[K]) =>
        onChange({ ...setup, [key]: v });
    const agentCount = agents.length;
    const players = playerCount(setup, agentCount);
    const problem = setupProblem(setup, agents) ?? error;
    const manual = setup.roleAssignment === 'manual';
    const counts: Record<MafiaRole, number> = {
        mafia: setup.mafia,
        doctor: +setup.doctor,
        police: +setup.police,
        citizen: 0,
    };
    counts.citizen = Math.max(
        0,
        players - counts.mafia - counts.doctor - counts.police
    );

    return (
        <FormSection
            title="마피아 게임"
            description={
                live
                    ? '지금 게임이 진행 중이에요. 바꾼 설정은 다음 판부터 적용돼요.'
                    : undefined
            }
        >
            <div className="flex flex-col gap-2">
                <FormRow label="내 자리">
                    <Segmented
                        label="내 자리"
                        value={setup.userRole}
                        onChange={(v) => set('userRole', v)}
                        options={USER_ROLES.map((r) => ({
                            value: r,
                            label: USER_ROLE_LABELS[r].label,
                        }))}
                    />
                </FormRow>
                <p className="text-xs leading-relaxed text-neutral-500">
                    {USER_ROLE_LABELS[setup.userRole].hint}
                </p>
            </div>

            <div className="flex flex-col gap-2">
                <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[13px] font-medium text-neutral-800">
                        역할 구성
                    </span>
                    <span className="text-xs text-neutral-500 tabular-nums">
                        참가자 {players}명
                        {setup.userRole === 'player' && ' (나 포함)'}
                    </span>
                </div>
                <ul className="divide-y divide-neutral-100 rounded-lg border border-neutral-200">
                    {COUNTED.map(({ role, min, max, note }) => (
                        <li
                            key={role}
                            className="flex items-center gap-3 px-3 py-2"
                        >
                            <RoleGlyph role={role} className="size-6" />
                            <div className="min-w-0 flex-1">
                                <div className="text-sm font-medium text-neutral-900">
                                    {ROLE_LABELS[role]}
                                </div>
                                <div className="text-xs text-neutral-500">
                                    {note}
                                </div>
                            </div>
                            <Stepper
                                label={`${ROLE_LABELS[role]} 수`}
                                value={counts[role]}
                                min={min}
                                max={max}
                                onChange={(n) => set(role, n)}
                            />
                        </li>
                    ))}
                    <li className="flex items-center gap-3 px-3 py-2">
                        <RoleGlyph role="citizen" className="size-6" />
                        <div className="min-w-0 flex-1">
                            <div className="text-sm font-medium text-neutral-900">
                                {ROLE_LABELS.citizen}
                            </div>
                            <div className="text-xs text-neutral-500">
                                남은 자리는 모두 시민이에요
                            </div>
                        </div>
                        <span className="w-[98px] text-center text-sm font-semibold text-neutral-900 tabular-nums">
                            {counts.citizen}
                        </span>
                    </li>
                </ul>
                {problem && (
                    <p className="text-xs text-red-600" role="alert">
                        {problem}
                    </p>
                )}
            </div>

            <div className="flex flex-col gap-2">
                <FormRow
                    label="역할 배분"
                    htmlFor={`${id}-assign`}
                    description={
                        manual
                            ? '위 인원에 맞춰 참가자마다 역할을 정해 주세요.'
                            : '게임을 시작할 때 무작위로 나눠요.'
                    }
                >
                    <select
                        id={`${id}-assign`}
                        className="field w-auto py-1.5"
                        value={setup.roleAssignment ?? 'random'}
                        onChange={(e) =>
                            set(
                                'roleAssignment',
                                e.target.value as 'random' | 'manual'
                            )
                        }
                    >
                        <option value="random">자동 (무작위)</option>
                        <option value="manual">수동 지정</option>
                    </select>
                </FormRow>
                {manual && (
                    <ul className="divide-y divide-neutral-100 rounded-lg border border-neutral-200">
                        {gameSeats(setup, agents).map((seat) => {
                            const role = setup.assignedRoles?.[seat.id];
                            return (
                                <li
                                    key={seat.id}
                                    className="flex items-center gap-3 px-3 py-1.5"
                                >
                                    {role ? (
                                        <RoleGlyph
                                            role={role}
                                            className="size-5"
                                        />
                                    ) : (
                                        <span className="size-5 shrink-0 rounded-full border border-dashed border-neutral-300" />
                                    )}
                                    <label
                                        htmlFor={`${id}-${seat.id}`}
                                        className="min-w-0 flex-1 truncate text-sm text-neutral-800"
                                    >
                                        {seat.name}
                                        <span className="sr-only">의 역할</span>
                                    </label>
                                    <select
                                        id={`${id}-${seat.id}`}
                                        className={cn(
                                            'field w-28 py-1',
                                            !role && 'text-neutral-400'
                                        )}
                                        value={role ?? ''}
                                        onChange={(e) => {
                                            const assignedRoles = {
                                                ...setup.assignedRoles,
                                            };
                                            if (e.target.value)
                                                assignedRoles[seat.id] = e
                                                    .target.value as MafiaRole;
                                            else delete assignedRoles[seat.id];
                                            set('assignedRoles', assignedRoles);
                                        }}
                                    >
                                        <option value="">선택</option>
                                        {ROLE_ORDER.map((r) => (
                                            <option key={r} value={r}>
                                                {ROLE_LABELS[r]}
                                            </option>
                                        ))}
                                    </select>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </div>

            <FormRow
                label="낮 토론 길이"
                description="에이전트가 낮에 말하는 최대 횟수예요. 내가 말하면 다시 세요."
            >
                <Segmented
                    label="낮 토론 길이"
                    value={setup.dayTalk}
                    onChange={(v) => set('dayTalk', v)}
                    options={DAY_TALK_OPTIONS.map((n, i) => ({
                        value: n,
                        label: `${DAY_TALK_LABELS[i]} · ${n}`,
                    }))}
                />
            </FormRow>

            <FormRow
                label="죽으면 역할 공개"
                htmlFor={`${id}-reveal`}
                description="처형되거나 밤에 당한 사람의 역할을 모두에게 알려요."
            >
                <Switch
                    id={`${id}-reveal`}
                    label="죽으면 역할 공개"
                    checked={setup.reveal}
                    onChange={(v) => set('reveal', v)}
                />
            </FormRow>

            <FormRow
                label="처형 전 찬반 투표"
                htmlFor={`${id}-verdict`}
                description="가장 많은 표를 받은 사람의 최후의 한마디를 들은 뒤, 처형할지 찬반으로 한 번 더 정해요. 찬성이 더 많아야 처형해요."
            >
                <Switch
                    id={`${id}-verdict`}
                    label="처형 전 찬반 투표"
                    checked={setup.verdict !== false}
                    onChange={(v) => set('verdict', v)}
                />
            </FormRow>
        </FormSection>
    );
};

export default MafiaSettingsFields;
