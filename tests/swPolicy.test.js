import { beforeAll, describe, expect, it } from 'vitest';

let policy;
beforeAll(async () => {
    await import('../public/sw-policy.js');
    policy = globalThis.swPolicy;
});

const ORIGIN = 'https://app.example';
const HF = 'https://huggingface.co/PaddlePaddle/x/resolve/abc/inference.onnx';
const decide = (url, mode, method = 'GET') => policy.decide({ url, origin: ORIGIN, method, mode });

describe('Modus', () => {
    it('ist ohne gespeicherten Zustand lokal', () => {
        expect(policy.effectiveMode(undefined, 0).mode).toBe('lokal');
        expect(policy.effectiveMode(null, 0).mode).toBe('lokal');
    });

    it('fällt nach Ablauf der Zeit auf lokal zurück', () => {
        const state = policy.modeState('verbunden', 1000, 10);
        expect(state.until).toBe(1000 + 10 * 60000);
        expect(policy.effectiveMode(state, state.until - 1).mode).toBe('verbunden');
        expect(policy.effectiveMode(state, state.until).mode).toBe('lokal');
    });

    it('begrenzt die Verbindungsdauer', () => {
        expect(policy.modeState('verbunden', 0, 99999).until).toBe(policy.MAX_MINUTES * 60000);
        expect(policy.modeState('verbunden', 0, 0).until).toBe(policy.DEFAULT_MINUTES * 60000);
        expect(policy.modeState('verbunden', 0, 'x').until).toBe(policy.DEFAULT_MINUTES * 60000);
    });

    it('behandelt unbekannte Modi als lokal', () => {
        expect(policy.modeState('irgendwas', 0, 10)).toEqual({ mode: 'lokal', until: null });
        expect(policy.effectiveMode({ mode: 'verbunden' }, 0).mode).toBe('lokal');
    });
});

describe('Lokal-Modus', () => {
    it.each([
        `${ORIGIN}/version.json`,
        `${ORIGIN}/assets/neu.js`,
        HF,
        'https://example.com/tracker.gif',
    ])('blockiert %s', url => {
        expect(decide(url, 'lokal').allow).toBe(false);
    });
});

describe('Verbunden-Modus', () => {
    it.each([
        [`${ORIGIN}/version.json`, 'update-pruefung'],
        [`${ORIGIN}/sw.js`, 'app-update'],
        [HF, 'modell'],
        ['https://us.aws.cdn.hf.co/xet-bridge-us/abc', 'modell'],
        ['https://cdn-lfs.huggingface.co/repos/x', 'modell'],
    ])('erlaubt %s', (url, purpose) => {
        const verdict = decide(url, 'verbunden');
        expect(verdict.allow).toBe(true);
        expect(verdict.purpose).toBe(purpose);
    });

    it.each([
        'https://example.com/',
        'https://huggingface.co.evil.example/x',
        'https://evilhuggingface.co/x',
        'https://hf.co.evil.example/x',
        'http://huggingface.co/x',
    ])('blockiert fremdes Ziel %s', url => {
        expect(decide(url, 'verbunden').allow).toBe(false);
    });

    it('lässt die App keine Daten senden', () => {
        expect(decide(`${ORIGIN}/upload`, 'verbunden', 'POST').allow).toBe(false);
        expect(decide(HF, 'verbunden', 'PUT').allow).toBe(false);
        expect(decide(HF, 'verbunden', 'HEAD').allow).toBe(true);
    });
});

describe('Interne KI (Intranet)', () => {
    const BASE = 'https://aiacoder-v001.kt.lunet.ch';

    it('ist im Lokal-Modus gesperrt, auch die Prüfung', () => {
        expect(decide(`${BASE}/health`, 'lokal').allow).toBe(false);
        expect(decide(`${BASE}/api/chat/completions`, 'lokal', 'POST').allow).toBe(false);
    });

    it('erlaubt im Verbunden-Modus die Prüfung und das Senden an die Textschnittstelle', () => {
        expect(decide(`${BASE}/health`, 'verbunden')).toMatchObject({ allow: true, purpose: 'intern-pruefung' });
        expect(decide(`${BASE}/api/models`, 'verbunden')).toMatchObject({ allow: true, purpose: 'intern-pruefung' });
        expect(decide(`${BASE}/api/chat/completions`, 'verbunden', 'POST')).toMatchObject({ allow: true, purpose: 'intern-ki' });
    });

    it('sendet nur an die Textschnittstelle und ruft diese nicht ab', () => {
        expect(decide(`${BASE}/health`, 'verbunden', 'POST').allow).toBe(false);
        expect(decide(`${BASE}/api/models`, 'verbunden', 'DELETE').allow).toBe(false);
        expect(decide(`${BASE}/api/chat/completions`, 'verbunden', 'GET').allow).toBe(false);
    });

    it.each([
        `${BASE}/api/v1/files/`,
        `${BASE}/ollama/api/generate`,
        `${BASE}/`,
        'https://aiacoder-v001.kt.lunet.ch.evil.example/api/chat/completions',
        'http://aiacoder-v001.kt.lunet.ch/api/chat/completions',
    ])('blockiert alles andere: %s', url => {
        expect(decide(url, 'verbunden', 'POST').allow).toBe(false);
        expect(decide(url, 'verbunden', 'GET').allow).toBe(false);
    });
});

describe('Prüfung der internen KI direkt von der Seite', () => {
    const HEALTH = 'https://aiacoder-v001.kt.lunet.ch/health';
    const pass = (url, mode, method = 'GET') => policy.passThrough({ url, method, mode });

    it('lässt nur den Abruf von /health im Modus «verbunden» vorbei', () => {
        expect(pass(HEALTH, 'verbunden')).toBe(true);
        expect(pass(HEALTH, 'lokal')).toBe(false);
        expect(pass(HEALTH, undefined)).toBe(false);
        expect(pass(HEALTH, 'verbunden', 'POST')).toBe(false);
    });

    it.each([
        'https://aiacoder-v001.kt.lunet.ch/api/models',
        'https://aiacoder-v001.kt.lunet.ch/api/chat/completions',
        'https://aiacoder-v001.kt.lunet.ch/health?x=1',
        'https://aiacoder-v001.kt.lunet.ch/health/db',
        'https://aiacoder-v001.kt.lunet.ch.evil.example/health',
        'http://aiacoder-v001.kt.lunet.ch/health',
        `${ORIGIN}/health`,
        'kein url',
    ])('alles andere geht durch den Torwächter: %s', url => {
        expect(pass(url, 'verbunden')).toBe(false);
    });
});
