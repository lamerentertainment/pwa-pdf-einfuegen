import { describe, expect, it } from 'vitest';
import { reactive } from 'vue';
import { replacePage } from '../src/capture/documentStore.js';
import { buildPageTexts } from '../src/capture/pageModel.js';
import { DEFAULT_OPTIONS } from '../src/capture/options.js';

const view = [0, 0, 595, 842];
const item = (str, x, y) => ({ str, transform: [12, 0, 0, 12, x, y], width: str.length * 6, height: 12 });
const page = (number, lines, extra = {}) => ({
    number, view, width: 595, height: 842, layout: null, source: 'text', boxes: [],
    items: lines.map((l, i) => item(l, 72, 700 - i * 14)), ...extra,
});

function state(pages, layoutGroups = []) {
    const s = reactive({ pages, layoutGroups, options: { ...DEFAULT_OPTIONS } });
    buildPageTexts(s.pages, s.options).forEach((t, i) => { s.pages[i].text = t; s.pages[i].originalText = t; });
    return s;
}

describe('replacePage', () => {
    it('setzt die neu erfasste Seite mit neuem Text ein', () => {
        const s = state([page(1, ['Eins']), page(2, ['Zwie (Textebene)']), page(3, ['Drei'])]);
        replacePage(s, page(2, ['Zwei (erkannt)'], { source: 'ocr', dpi: 300 }));
        expect(s.pages.map(p => p.text)).toEqual(['Eins', 'Zwei (erkannt)', 'Drei']);
        expect(s.pages[1]).toMatchObject({ source: 'ocr', dpi: 300, originalText: 'Zwei (erkannt)' });
    });

    it('überschreibt Bearbeitungen der Seite, aber nicht die anderer Seiten', () => {
        const s = state([page(1, ['Eins']), page(2, ['Zwei'])]);
        s.pages[0].text = 'Eins, bearbeitet';
        s.pages[1].text = 'Zwei, bearbeitet';
        replacePage(s, page(2, ['Zwei neu']));
        expect(s.pages[0].text).toBe('Eins, bearbeitet');
        expect(s.pages[1].text).toBe('Zwei neu');
    });

    it('entfernt Eigenschaften der alten Erfassung (Layout, Auflösung)', () => {
        const s = state([page(1, ['Eins'], { source: 'ocr-layout', dpi: 300 })]);
        replacePage(s, page(1, ['Eins']));
        expect(s.pages[0].dpi).toBeUndefined();
        expect(s.pages[0].source).toBe('text');
    });

    it('löst Verbindungen zu Bereichen der alten Seite', () => {
        const groups = [
            { id: 'a', mode: 'folge', members: [{ page: 1, id: 'r1' }, { page: 2, id: 'r2' }] },
            { id: 'b', mode: 'folge', members: [{ page: 1, id: 'r3' }, { page: 3, id: 'r4' }, { page: 2, id: 'r5' }] },
            { id: 'c', mode: 'folge', members: [{ page: 1, id: 'r6' }, { page: 3, id: 'r7' }] },
        ];
        const s = state([page(1, ['Eins']), page(2, ['Zwei']), page(3, ['Drei'])], groups);
        replacePage(s, page(2, ['Zwei']));
        expect(s.layoutGroups.map(g => g.id)).toEqual(['b', 'c']);
        expect(s.layoutGroups[0].members).toHaveLength(2);
    });

    it('meldet eine unbekannte Seite', () => {
        const s = state([page(1, ['Eins'])]);
        expect(() => replacePage(s, page(5, ['x']))).toThrow();
    });
});
