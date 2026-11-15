import { describe, expect, it } from 'vitest';
import { buildPageTexts, ocrLineBox, regionBox, splitPages, textItemBox } from '../src/capture/pageModel.js';
import { joinPages } from '../src/capture/joinPages.js';
import { DEFAULT_OPTIONS } from '../src/capture/options.js';

// pdf.js-Viewport bei Massstab 1 für eine ungedrehte A4-Seite: y wird gespiegelt
const viewport = {
    convertToViewportPoint: (x, y) => [x, 842 - y],
};

const item = (str, x, y, width = str.length * 6, height = 12) => ({ str, transform: [12, 0, 0, 12, x, y], width, height });

describe('Boxen', () => {
    it('rechnet OCR-Zeilen von Bildpixeln in Punkte um', () => {
        const box = ocrLineBox({ x: 150, y: 300, w: 600, h: 30, text: 'Ich', score: 0.7 }, 150 / 72);
        expect(box.x).toBeCloseTo(72);
        expect(box.y).toBeCloseTo(144);
        expect(box.w).toBeCloseTo(288);
        expect(box.h).toBeCloseTo(14.4);
        expect(box).toMatchObject({ text: 'Ich', score: 0.7 });
    });

    it('legt Textelemente mit Ursprung oben links an', () => {
        const box = textItemBox(item('Hallo', 72, 700, 30, 12), viewport);
        expect(box).toEqual({ x: 72, y: 130, w: 30, h: 12, text: 'Hallo' });
    });

    it('nimmt die Schriftgrösse, wenn ein Element keine Höhe hat', () => {
        expect(textItemBox(item('x', 0, 0, 6, 0), viewport).h).toBe(12);
    });

    it('rechnet Layoutbereiche um', () => {
        expect(regionBox({ label: 'text', score: 0.9, x: 20, y: 40, w: 200, h: 100 }, 2))
            .toEqual({ label: 'text', score: 0.9, x: 10, y: 20, w: 100, h: 50 });
    });
});

describe('splitPages', () => {
    const marker = n => `--- PWA_PDF_SEITE ${n} ---`;

    it('teilt in Seiten, auch mit leeren Seiten', () => {
        const text = [marker(1), '', 'Eins', '', marker(2), '', marker(3), '', 'Drei'].join('\n');
        expect(splitPages(text, 3)).toEqual(['Eins', '', 'Drei']);
    });

    it('lehnt eine unpassende Seitenzahl ab', () => {
        expect(splitPages(`${marker(1)}\n\nEins`, 2)).toBeNull();
        expect(splitPages(`${marker(2)}\n\nZwei`, 1)).toBeNull();
    });
});

describe('buildPageTexts', () => {
    const view = [0, 0, 595, 842];
    const page = lines => ({ view, items: lines.map((l, i) => item(l, 72, 700 - i * 14)) });

    it('liefert einen Text pro Seite', () => {
        const texts = buildPageTexts([page(['Erste Seite.']), page([]), page(['Dritte Seite.'])], DEFAULT_OPTIONS);
        expect(texts).toEqual(['Erste Seite.', '', 'Dritte Seite.']);
    });

    it('bleibt korrekt, wenn ein Dokument selbst eine Trennerzeile enthält', () => {
        const texts = buildPageTexts([page(['--- PWA_PDF_SEITE 7 ---']), page(['Zwei'])], DEFAULT_OPTIONS);
        expect(texts).toHaveLength(2);
        expect(texts[1]).toBe('Zwei');
    });
});

describe('joinPages', () => {
    const pages = [{ number: 1, text: 'Eins ' }, { number: 2, text: '' }, { number: 3, text: 'Drei' }];

    it('fügt die Seiten ohne leere Seiten zusammen', () => {
        expect(joinPages(pages)).toBe('Eins\n\nDrei');
    });

    it('setzt auf Wunsch Seitenmarker', () => {
        expect(joinPages(pages, { pageMarkers: true })).toBe('--- Seite 1 ---\n\nEins\n\n--- Seite 2 ---\n\n--- Seite 3 ---\n\nDrei');
    });
});
