import { PROVIDERS } from '@shared/providers';
import { useProfiles } from '@services/api';

interface ProfileSelectProps {
    value: string | null;
    onChange: (id: string | null) => void;
    /** null 선택지에 표시할 문구 */
    inheritLabel: string;
    className?: string;
}

/** 저장된 프로바이더 프로필 중 하나를 고르는 select. 빈 값(null)은 상위 설정 상속. */
const ProfileSelect = ({
    value,
    onChange,
    inheritLabel,
    className,
}: ProfileSelectProps) => {
    const { data } = useProfiles();
    const profiles = data?.profiles ?? [];
    const missing = value !== null && !profiles.some((p) => p.id === value);

    return (
        <select
            className={className ?? 'field'}
            value={value ?? ''}
            onChange={(e) => onChange(e.target.value || null)}
        >
            <option value="">{inheritLabel}</option>
            {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                    {p.name} · {PROVIDERS[p.provider].label}
                </option>
            ))}
            {missing && data && <option value={value}>(삭제된 프로필)</option>}
        </select>
    );
};

export default ProfileSelect;
