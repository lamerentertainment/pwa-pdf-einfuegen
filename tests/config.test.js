// Die Freigaben stehen an drei Stellen: CSP (csp.js), HTTP-Header (firebase.json) und
// Torwächter-Regeln (sw-policy.js). Diese Tests verhindern, dass sie auseinanderlaufen.
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { CSP } from '../csp.js';
import catalog from '../models/catalog.json';

const firebase = JSON.parse(readFileSync(new URL('../firebase.json', import.meta.url), 'utf8'));
let policy;
beforeAll(async () => {
    await import('../public/sw-policy.js');
    policy = globalThis.swPolicy;
});

describe('Content Security Policy', () => {
    it('ist im HTTP-Header dieselbe wie im <meta>-Tag', () => {
        const header = firebase.hosting.headers
            .flatMap(rule => rule.headers)
            .find(h => h.key === 'Content-Security-Policy').value;
        expect(header).toBe(`${CSP}; frame-ancestors 'none'`);
    });

    it('erlaubt Verbindungen nur zur eigenen Website und zu Hugging Face', () => {
        const connect = CSP.split('; ').find(d => d.startsWith('connect-src')).split(' ').slice(1);
        expect(connect).toEqual(["'self'", 'https://huggingface.co', 'https://*.huggingface.co', 'https://*.hf.co']);
    });
});

describe('Modellkatalog', () => {
    const files = catalog.models.flatMap(m => m.files);

    it('hat eindeutige IDs und vollständige Angaben', () => {
        const ids = catalog.models.map(m => m.id);
        expect(new Set(ids).size).toBe(ids.length);
        for (const model of catalog.models) {
            expect(model.name && model.purpose && model.license && model.source).toBeTruthy();
            expect(model.files.length).toBeGreaterThan(0);
        }
    });

    it('pinnt jede Datei mit Revision, Grösse und SHA-256', () => {
        for (const file of files) {
            expect(file.sha256).toMatch(/^[0-9a-f]{64}$/);
            expect(file.size).toBeGreaterThan(0);
            // Eine Commit-Revision statt eines Branches wie "main"
            expect(file.url).toMatch(/\/resolve\/[0-9a-f]{40}\//);
        }
    });

    it('lädt nur von Zielen, die der Torwächter freigibt', () => {
        for (const file of files) {
            const verdict = policy.decide({ url: file.url, origin: 'https://app.example', method: 'GET', mode: 'verbunden' });
            expect(verdict.allow, file.url).toBe(true);
        }
    });
});

describe('Beispieldokumente', () => {
    it('liegen alle in public/beispiele', async () => {
        const { EXAMPLES } = await import('../src/capture/examples.js');
        const { statSync } = await import('node:fs');
        for (const example of EXAMPLES) {
            const size = statSync(new URL(`../public/beispiele/${example.file}`, import.meta.url)).size;
            expect(size, example.file).toBeGreaterThan(1000);
        }
    });
});

describe('Modellbeschreibungen', () => {
    it('sagen für jedes Modell, was es kann, was ohne es passiert und wann es wirkt', () => {
        for (const model of catalog.models) {
            expect(model.capabilities?.length, model.id).toBeGreaterThan(0);
            expect(model.without, model.id).toBeTruthy();
            expect(model.usage, model.id).toBeTruthy();
            if (model.requires) expect(catalog.models.some(m => m.id === model.requires), model.id).toBe(true);
        }
    });
});
