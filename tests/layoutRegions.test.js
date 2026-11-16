import { describe, expect, it } from 'vitest';
import {
    createLayout, groupOf, joinAcross, layoutPageText, mergeGroups, moveInOrder, orderFromClicks, orderRegions, REST_ID,
} from '../src/capture/layoutRegions.js';

const rect = (id, x, y, w, h, label = 'text') => ({ id, label, x, y, w, h });

describe('orderRegions', () => {
    it('liest Spalten links vor rechts, innerhalb oben vor unten', () => {
        const regions = [
            rect('title', 50, 40, 500, 30),
            rect('right1', 320, 100, 230, 200), rect('left1', 50, 100, 230, 120),
            rect('left2', 50, 240, 230, 60), rect('foot', 50, 780, 500, 20),
        ];
        expect(orderRegions(regions)).toEqual(['title', 'left1', 'left2', 'right1', 'foot']);
    });

    it('ordnet einspaltige Seiten von oben nach unten', () => {
        expect(orderRegions([rect('b', 50, 300, 400, 50), rect('a', 50, 100, 400, 50)])).toEqual(['a', 'b']);
    });
});

describe('createLayout', () => {
    it('ordnet Zeilen dem kleinsten passenden Bereich zu und schaltet Kopfzeilen aus', () => {
        const regionBoxes = [
            { label: 'header', score: 0.9, x: 50, y: 20, w: 500, h: 20 },
            { label: 'text', score: 0.95, x: 50, y: 100, w: 500, h: 300 },
            { label: 'paragraph_title', score: 0.9, x: 50, y: 100, w: 200, h: 20 },
        ];
        const lines = [
            { x: 60, y: 25, w: 100, h: 10 }, // Kopfzeile
            { x: 60, y: 102, w: 100, h: 12 }, // Titel (liegt auch im Textblock)
            { x: 60, y: 200, w: 300, h: 12 }, // Text
            { x: 60, y: 600, w: 300, h: 12 }, // ausserhalb aller Bereiche
        ];
        const { layout, lineRegions } = createLayout(regionBoxes, lines);
        expect(lineRegions).toEqual(['r0', 'r2', 'r1', REST_ID]);
        expect(layout.regions.find(r => r.id === 'r0').enabled).toBe(false);
        expect(layout.regions.find(r => r.id === REST_ID)).toMatchObject({ enabled: true, y: 600 });
        expect(layout.order).toHaveLength(4);
    });
});

describe('Reihenfolge ändern', () => {
    it('verschiebt einen Bereich', () => {
        expect(moveInOrder(['a', 'b', 'c'], 'c', -1)).toEqual(['a', 'c', 'b']);
        expect(moveInOrder(['a', 'b', 'c'], 'a', -1)).toEqual(['a', 'b', 'c']);
    });

    it('übernimmt die Klickfolge und hängt den Rest an', () => {
        expect(orderFromClicks(['a', 'b', 'c', 'd'], ['c', 'a'])).toEqual(['c', 'a', 'b', 'd']);
    });
});

describe('joinAcross', () => {
    it('fügt ein getrenntes Wort zusammen, sonst neue Zeile', () => {
        expect(joinAcross('als Buch-', 'halterin tätig')).toBe('als Buchhalterin tätig');
        expect(joinAcross('Ende.', 'Anfang')).toBe('Ende.\nAnfang');
        expect(joinAcross('', 'x')).toBe('x');
    });
});

describe('Verbinden und Seitentext', () => {
    const pages = {
        1: { layout: { regions: [{ id: 'a', enabled: true }, { id: 'b', enabled: true }, { id: 'h', enabled: false }], order: ['h', 'a', 'b'] } },
        2: { layout: { regions: [{ id: 'c', enabled: true }, { id: 'd', enabled: true }], order: ['c', 'd'] } },
    };
    const texts = { '1:a': 'Erster Absatz.', '1:b': 'Ein Absatz über die Seiten-', '1:h': 'Kopfzeile', '2:c': 'grenze hinweg.', '2:d': 'Zweite Seite.' };
    const regionText = (p, id) => texts[`${p}:${id}`];
    const pageOf = n => pages[n];
    const orderOfPage = n => pages[n].layout.order;

    it('lässt ausgeschaltete Bereiche weg', () => {
        expect(layoutPageText(1, pageOf, [], regionText)).toBe('Erster Absatz.\n\nEin Absatz über die Seiten-');
    });

    it('verbindet Bereiche über eine Seitengrenze an der Stelle des ersten Mitglieds', () => {
        const groups = mergeGroups([], [{ page: 2, id: 'c' }, { page: 1, id: 'b' }], orderOfPage, 'g1');
        expect(groups[0].members).toEqual([{ page: 1, id: 'b' }, { page: 2, id: 'c' }]);
        expect(layoutPageText(1, pageOf, groups, regionText)).toBe('Erster Absatz.\n\nEin Absatz über die Seitengrenze hinweg.');
        expect(layoutPageText(2, pageOf, groups, regionText)).toBe('Zweite Seite.');
        expect(groupOf(groups, 2, 'c').id).toBe('g1');
    });

    it('fasst bestehende Gruppen beim erneuten Verbinden zusammen', () => {
        let groups = mergeGroups([], [{ page: 1, id: 'a' }, { page: 1, id: 'b' }], orderOfPage, 'g1');
        groups = mergeGroups(groups, [{ page: 1, id: 'b' }, { page: 2, id: 'd' }], orderOfPage, 'g2');
        expect(groups).toHaveLength(1);
        expect(groups[0].members.map(m => `${m.page}:${m.id}`)).toEqual(['1:a', '1:b', '2:d']);
    });
});

describe('Nebeneinander zusammenlegen', () => {
    it('baut Bereiche derselben Seite gemeinsam auf', () => {
        const pages = { 1: { layout: { regions: [{ id: 'l', enabled: true }, { id: 'v', enabled: true }, { id: 'x', enabled: true }], order: ['l', 'v', 'x'] } } };
        const groups = mergeGroups([], [{ page: 1, id: 'l' }, { page: 1, id: 'v' }], n => pages[n].layout.order, 'g', 'nebeneinander');
        const text = layoutPageText(1, n => pages[n], groups, (p, id) => `[${id}]`, (p, ids) => `[${ids.join('+')}]`);
        expect(groups[0].mode).toBe('nebeneinander');
        expect(text).toBe('[l+v]\n\n[x]');
    });
});
