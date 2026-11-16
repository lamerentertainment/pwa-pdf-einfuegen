import { describe, expect, it } from 'vitest';
import { allFiles, componentsOf, formatBytes, models, modelSize, readWithProgress, sha256Hex } from '../src/models/modelStore.js';

describe('sha256Hex', () => {
    it('berechnet die bekannte Prüfsumme', async () => {
        const bytes = new TextEncoder().encode('abc');
        expect(await sha256Hex(bytes)).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    });
});

describe('readWithProgress', () => {
    it('setzt die Teile zusammen und meldet den Fortschritt', async () => {
        const parts = [new Uint8Array([1, 2]), new Uint8Array([3]), new Uint8Array([4, 5, 6])];
        const stream = new ReadableStream({
            start(controller) {
                for (const part of parts) controller.enqueue(part);
                controller.close();
            },
        });
        const seen = [];
        const result = await readWithProgress(new Response(stream), n => seen.push(n));
        expect([...result]).toEqual([1, 2, 3, 4, 5, 6]);
        expect(seen).toEqual([2, 3, 6]);
    });
});

describe('Grössen', () => {
    it('summiert die Dateien eines Modells', () => {
        expect(modelSize({ files: [{ size: 10 }, { size: 5 }] })).toBe(15);
    });

    it.each([
        [0, '0 MB'],
        [500, '1 kB'],
        [6817, '7 kB'],
        [4826518, '4.8 MB'],
        [129736329, '130 MB'],
        [2.5e9, '2.5 GB'],
    ])('formatiert %d als %s', (bytes, text) => {
        expect(formatBytes(bytes)).toBe(text);
    });
});

describe('hashStream', () => {
    it('berechnet SHA-256 Stück für Stück wie über den ganzen Inhalt', async () => {
        const parts = ['a', 'b', 'c'].map(c => new TextEncoder().encode(c));
        const stream = new ReadableStream({ start(c) { parts.forEach(p => c.enqueue(p)); c.close(); } });
        const seen = [];
        const { hashStream } = await import('../src/models/modelStore.js');
        expect(await hashStream(stream, n => seen.push(n))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
        expect(seen).toEqual([1, 2, 3]);
    });
});

describe('Bestandteile', () => {
    it('stellt die Laufzeit vor die Dateien eines Sprachmodells, nicht bei der Texterkennung', () => {
        const llm = models.find(m => m.stage === 3);
        const ocr = models.find(m => m.stage === 1);
        expect(componentsOf(llm).map(c => c.id)).toEqual(['llm-laufzeit']);
        expect(allFiles(llm)[0].url).toMatch(/^\/vendor\//);
        expect(allFiles(llm)).toHaveLength(llm.files.length + 2);
        expect(allFiles(ocr)).toEqual(ocr.files);
    });
});

describe('Löschen mit gemeinsamer Laufzeit', () => {
    // Einfacher Ersatz für die Cache Storage API
    function fakeCaches(urls) {
        const store = new Set(urls);
        const cache = {
            match: async url => (store.has(url) ? new Response('x') : undefined),
            delete: async url => store.delete(url),
        };
        return { store, api: { open: async () => cache } };
    }

    it('behält die Laufzeit, solange ein anderes Sprachmodell sie braucht, und löscht sie mit dem letzten', async () => {
        const { remove } = await import('../src/models/modelStore.js');
        const [a, b] = models.filter(m => m.stage === 3);
        const runtime = componentsOf(a)[0].files.map(f => f.url);
        const { store, api } = fakeCaches([...allFiles(a), ...b.files].map(f => f.url));
        globalThis.caches = api;
        try {
            await remove(a);
            expect(runtime.every(u => store.has(u))).toBe(true);
            expect(a.files.some(f => store.has(f.url))).toBe(false);
            await remove(b);
            expect(store.size).toBe(0);
        } finally {
            delete globalThis.caches;
        }
    });
});
