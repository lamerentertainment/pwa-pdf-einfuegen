import { describe, expect, it } from 'vitest';
import { formatBytes, modelSize, readWithProgress, sha256Hex } from '../src/models/modelStore.js';

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
