import {
    createCipheriv,
    createDecipheriv,
    randomBytes,
    scryptSync,
} from 'node:crypto';
import { chmod, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * API 키 암호화 (AES-256-GCM).
 *
 * 마스터 키 우선순위:
 *  1. 환경변수 AGENTTALK_SECRET (임의의 문자열 → scrypt로 32바이트 키 유도)
 *  2. <dataDir>/secret.key (없으면 무작위 32바이트로 생성, 권한 0600)
 *
 * 암호문 형식: "v1:<iv>:<tag>:<ciphertext>" (모두 base64url)
 * 프로필 ID를 AAD로 묶어서, 암호문을 다른 프로필로 옮겨 붙이면 복호화가 실패한다.
 */

const ALGO = 'aes-256-gcm';
const KEY_FILE = 'secret.key';

export async function loadMasterKey(dataDir: string): Promise<Buffer> {
    const fromEnv = process.env.AGENTTALK_SECRET;
    if (fromEnv) {
        if (fromEnv.length < 16) {
            throw new Error('AGENTTALK_SECRET은 16자 이상이어야 합니다.');
        }
        return scryptSync(fromEnv, 'agenttalk.master-key.v1', 32);
    }

    await ensurePrivateDir(dataDir);
    const file = path.join(dataDir, KEY_FILE);
    try {
        const raw = (await readFile(file, 'utf8')).trim();
        const key = Buffer.from(raw, 'base64');
        if (key.length !== 32)
            throw new Error(`${file} 형식이 올바르지 않습니다.`);
        await tightenPermissions(file);
        return key;
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
        const key = randomBytes(32);
        // 'wx' : 이미 있으면 실패 → 동시에 두 프로세스가 만들어도 덮어쓰지 않는다
        await writeFile(file, key.toString('base64') + '\n', {
            mode: 0o600,
            flag: 'wx',
        });
        return key;
    }
}

export function encryptSecret(
    key: Buffer,
    plaintext: string,
    aad: string
): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv(ALGO, key, iv);
    cipher.setAAD(Buffer.from(aad, 'utf8'));
    const ct = Buffer.concat([
        cipher.update(plaintext, 'utf8'),
        cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    return ['v1', iv, tag, ct]
        .map((p) => (typeof p === 'string' ? p : p.toString('base64url')))
        .join(':');
}

export function decryptSecret(key: Buffer, blob: string, aad: string): string {
    const [version, iv, tag, ct] = blob.split(':');
    if (version !== 'v1' || !iv || !tag || ct === undefined) {
        throw new Error('지원하지 않는 암호문 형식입니다.');
    }
    const decipher = createDecipheriv(ALGO, key, Buffer.from(iv, 'base64url'));
    decipher.setAAD(Buffer.from(aad, 'utf8'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([
        decipher.update(Buffer.from(ct, 'base64url')),
        decipher.final(),
    ]).toString('utf8');
}

export async function ensurePrivateDir(dir: string) {
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await tightenPermissions(dir, 0o700);
}

/** 그룹/기타 사용자 권한이 열려 있으면 소유자 전용으로 좁힌다 (Windows에서는 무시됨) */
export async function tightenPermissions(file: string, mode = 0o600) {
    if (process.platform === 'win32') return;
    const s = await stat(file);
    if ((s.mode & 0o077) !== 0) {
        await chmod(file, mode);
        console.warn(
            `[agenttalk] ${file} 권한을 ${mode.toString(8)}으로 조정했습니다.`
        );
    }
}
