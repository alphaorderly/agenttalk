// @vitest-environment node
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ProfileStore } from './store';

const KEY = 'sk-test-1234567890abcdef';

describe('ProfileStore', () => {
    let dir: string;

    beforeEach(async () => {
        dir = await mkdtemp(path.join(tmpdir(), 'agenttalk-'));
    });
    afterEach(async () => {
        await rm(dir, { recursive: true, force: true });
    });

    const input = (apiKey?: string) => ({
        name: 'My OpenAI',
        provider: 'openai' as const,
        baseURL: '',
        defaultModel: 'gpt-5-mini',
        apiKey,
    });

    it('encrypts keys at rest and never exposes them publicly', async () => {
        const store = await ProfileStore.open(dir);
        const p = await store.create(input(KEY));

        expect(p).not.toHaveProperty('apiKey');
        expect(p).not.toHaveProperty('encryptedKey');
        expect(p.hasKey).toBe(true);
        expect(p.keyHint).toBe('••••cdef');

        const raw = await readFile(path.join(dir, 'profiles.json'), 'utf8');
        expect(raw).not.toContain(KEY);
        expect(JSON.stringify(store.list())).not.toContain(KEY);
        expect(store.resolve(p.id).apiKey).toBe(KEY);
    });

    it('writes data files with owner-only permissions', async () => {
        const store = await ProfileStore.open(dir);
        await store.create(input(KEY));
        if (process.platform === 'win32') return;
        expect((await stat(path.join(dir, 'profiles.json'))).mode & 0o777).toBe(
            0o600
        );
        expect((await stat(path.join(dir, 'secret.key'))).mode & 0o777).toBe(
            0o600
        );
    });

    it('persists across restarts and first profile becomes default', async () => {
        const a = await ProfileStore.open(dir);
        const p = await a.create(input(KEY));
        const b = await ProfileStore.open(dir);
        expect(b.list().defaultProfileId).toBe(p.id);
        expect(b.resolve(null).apiKey).toBe(KEY);
    });

    it('keeps the key when apiKey is omitted on update and clears it with empty string', async () => {
        const store = await ProfileStore.open(dir);
        const p = await store.create(input(KEY));
        await store.update(p.id, { ...input(), name: 'renamed' });
        expect(store.resolve(p.id).apiKey).toBe(KEY);
        await store.update(p.id, input(''));
        expect(store.resolve(p.id).apiKey).toBeUndefined();
    });

    it('rejects a ciphertext moved to another profile (AAD binding)', async () => {
        const store = await ProfileStore.open(dir);
        const a = await store.create(input(KEY));
        const b = await store.create(input('sk-other-key-000000'));
        const file = path.join(dir, 'profiles.json');
        const data = JSON.parse(await readFile(file, 'utf8'));
        data.profiles[1].encryptedKey = data.profiles[0].encryptedKey;
        await writeFile(file, JSON.stringify(data));
        const reopened = await ProfileStore.open(dir);
        expect(reopened.resolve(a.id).apiKey).toBe(KEY);
        expect(() => reopened.resolve(b.id)).toThrow();
    });

    it('stores default effort and keeps it when omitted on update', async () => {
        const store = await ProfileStore.open(dir);
        const p = await store.create({
            ...input(KEY),
            defaultReasoning: 'high',
        });
        expect(p.defaultReasoning).toBe('high');
        await store.update(p.id, { ...input(), name: 'renamed' });
        expect(store.resolve(p.id).defaultReasoning).toBe('high');
        await store.update(p.id, { ...input(), defaultReasoning: 'low' });
        const reopened = await ProfileStore.open(dir);
        expect(reopened.resolve(p.id).defaultReasoning).toBe('low');
    });

    it('remembers models that rejected web search across restarts until the profile is saved again', async () => {
        const a = await ProfileStore.open(dir);
        const p = await a.create(input(KEY));
        await a.markNoSearch(p.id, 'gpt-4.1-nano');
        await a.markNoSearch(p.id, 'gpt-4.1-nano');
        const b = await ProfileStore.open(dir);
        expect(b.resolve(p.id).noSearchModels).toEqual(['gpt-4.1-nano']);
        expect(b.list().profiles[0].noSearchModels).toEqual(['gpt-4.1-nano']);
        await b.update(p.id, input());
        expect(b.resolve(p.id).noSearchModels).toEqual([]);
        expect(b.resolve(p.id).apiKey).toBe(KEY);
    });

    it('loads profile files written before the web search record existed', async () => {
        const a = await ProfileStore.open(dir);
        const p = await a.create(input(KEY));
        const file = path.join(dir, 'profiles.json');
        const data = JSON.parse(await readFile(file, 'utf8'));
        delete data.profiles[0].noSearchModels;
        await writeFile(file, JSON.stringify(data));
        const b = await ProfileStore.open(dir);
        expect(b.resolve(p.id).noSearchModels).toEqual([]);
    });

    it('loads profile files written before effort existed', async () => {
        const a = await ProfileStore.open(dir);
        const p = await a.create(input(KEY));
        const file = path.join(dir, 'profiles.json');
        const data = JSON.parse(await readFile(file, 'utf8'));
        delete data.profiles[0].defaultReasoning;
        await writeFile(file, JSON.stringify(data));
        const b = await ProfileStore.open(dir);
        expect(b.resolve(p.id).defaultReasoning).toBe('provider-default');
        expect(b.resolve(p.id).apiKey).toBe(KEY);
    });

    it('refuses to load a corrupted file instead of overwriting it', async () => {
        await writeFile(
            path.join(dir, 'profiles.json'),
            '{"version":1,"profiles":"oops"}'
        );
        await expect(ProfileStore.open(dir)).rejects.toThrow(/형식/);
    });

    it('serializes concurrent writes without losing updates', async () => {
        const store = await ProfileStore.open(dir);
        await Promise.all(
            Array.from({ length: 10 }, (_, i) =>
                store.create({ ...input(), name: `p${i}` })
            )
        );
        const reopened = await ProfileStore.open(dir);
        expect(reopened.list().profiles).toHaveLength(10);
    });
});
