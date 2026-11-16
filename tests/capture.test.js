import { describe, expect, it } from 'vitest';
import { buildPageTexts, figureCaptions, markFootnoteReference, ocrLineBox, regionBox, splitFootnotes, splitPages, textItemBox } from '../src/capture/pageModel.js';
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

describe('buildPageTexts mit Layoutbereichen', () => {
    const view = [0, 0, 595, 842];
    const line = (str, y, region) => ({ ...item(str, 72, y), region });
    const layoutPage = (number, regions, order, lines) => ({ number, view, items: lines, layout: { regions, order } });

    it('baut Seiten aus eingeschalteten Bereichen in Reihenfolge auf, Seiten ohne Layout wie bisher', () => {
        const pages = [
            layoutPage(1,
                [{ id: 'h', label: 'header', enabled: false }, { id: 'a', label: 'text', enabled: true }, { id: 'b', label: 'text', enabled: true }],
                ['h', 'b', 'a'],
                [line('Kopfzeile', 800, 'h'), line('Absatz A.', 700, 'a'), line('Absatz B.', 600, 'b')]),
            { number: 2, view, items: [item('Digitale Seite.', 72, 700)] },
        ];
        expect(buildPageTexts(pages, DEFAULT_OPTIONS)).toEqual(['Absatz B.\n\nAbsatz A.', 'Digitale Seite.']);
        pages[0].layout.regions[0].enabled = true;
        expect(buildPageTexts(pages, DEFAULT_OPTIONS)[0]).toBe('Kopfzeile\n\nAbsatz B.\n\nAbsatz A.');
    });

    it('verbindet Bereiche über die Seitengrenze', () => {
        const pages = [
            layoutPage(1, [{ id: 'a', label: 'text', enabled: true }], ['a'], [line('Ein Satz über die Seiten-', 100, 'a')]),
            layoutPage(2, [{ id: 'b', label: 'text', enabled: true }, { id: 'c', label: 'text', enabled: true }], ['b', 'c'],
                [line('grenze hinweg.', 750, 'b'), line('Weiter.', 700, 'c')]),
        ];
        const groups = [{ id: 'g', members: [{ page: 1, id: 'a' }, { page: 2, id: 'b' }] }];
        expect(buildPageTexts(pages, DEFAULT_OPTIONS, groups)).toEqual(['Ein Satz über die Seitengrenze hinweg.', 'Weiter.']);
    });

    it('baut Tabellen nur in Tabellenbereichen auf, dort schon ab 2 Spalten', () => {
        const cell = (str, x, y, region) => ({ ...item(str, x, y), region });
        const rows = region => [
            cell('Datum', 72, 700, region), cell('Betrag', 300, 700, region),
            cell('01.02.2024', 72, 685, region), cell('120.00', 300, 685, region),
            cell('15.03.2024', 72, 670, region), cell('80.50', 300, 670, region),
        ];
        const options = { ...DEFAULT_OPTIONS, tables: true };
        const asTable = layoutPage(1, [{ id: 't', label: 'table', enabled: true }], ['t'], rows('t'));
        const asText = layoutPage(1, [{ id: 'x', label: 'text', enabled: true }], ['x'], rows('x'));
        expect(buildPageTexts([asTable], options)[0]).toMatch(/^\| Datum \| Betrag \|\n\| --- \| --- \|/);
        expect(buildPageTexts([asText], options)[0]).not.toContain('|');
        expect(buildPageTexts([asTable], DEFAULT_OPTIONS)[0]).not.toContain('|');
    });
});

describe('Typ-gerechte Ausgabe (Etappe 2)', () => {
    const view = [0, 0, 595, 842];
    const line = (str, y, region) => ({ ...item(str, 72, y), region });
    const region = (id, label) => ({ id, label, enabled: true });
    const pages = () => [
        { number: 1, view, layout: {
            regions: [region('t', 'doc_title'), region('h', 'paragraph_title'), region('a', 'text'), region('f', 'footnote'), region('i', 'image'), region('s', 'seal')],
            order: ['t', 'h', 'i', 'a', 's', 'f'],
        }, items: [
            line('Einvernahme', 800, 't'), line('der Zeugin', 785, 't'),
            line('1. Personalien', 750, 'h'),
            line('xX#~', 720, 'i'),
            line('Die Zeugin erscheint.', 700, 'a'),
            line('Eingegangen', 600, 's'), line('12.03.2024', 585, 's'),
            line('1 Siehe Akten.', 100, 'f'),
        ] },
        { number: 2, view, layout: { regions: [region('b', 'text'), region('g', 'footnote')], order: ['b', 'g'] }, items: [
            line('Weiter im Text.', 700, 'b'), line('2 BGE 140 IV 1.', 100, 'g'),
        ] },
    ];

    it('lässt ohne Einstellungen alles wie bisher', () => {
        expect(buildPageTexts(pages(), DEFAULT_OPTIONS)[0]).toBe(
            'Einvernahme\nder Zeugin\n\n1. Personalien\n\nxX#~\n\nDie Zeugin erscheint.\n\nEingegangen\n12.03.2024\n\n1 Siehe Akten.');
    });

    it('kennzeichnet Titel als Überschrift (einzeilig) und setzt Platzhalter', () => {
        const options = { ...DEFAULT_OPTIONS, headings: true, placeholders: true };
        expect(buildPageTexts(pages(), options)[0]).toBe(
            '# Einvernahme der Zeugin\n\n## 1. Personalien\n\n[Abbildung]\n\nDie Zeugin erscheint.\n\n[Stempel: Eingegangen 12.03.2024]\n\n1 Siehe Akten.');
    });

    it('sammelt Fussnoten aller Seiten am Dokumentende', () => {
        const texts = buildPageTexts(pages(), { ...DEFAULT_OPTIONS, footnotes: 'dokument' });
        expect(texts[0]).not.toContain('Siehe Akten');
        expect(texts[1]).toBe('Weiter im Text.\n\n--- Fussnoten ---\n\n1 Siehe Akten.\n\n2 BGE 140 IV 1.');
    });

    it('lässt ausgeschaltete Fussnoten auch am Ende weg', () => {
        const p = pages();
        p[1].layout.regions[1].enabled = false;
        expect(buildPageTexts(p, { ...DEFAULT_OPTIONS, footnotes: 'dokument' })[1]).toBe('Weiter im Text.\n\n--- Fussnoten ---\n\n1 Siehe Akten.');
    });
});

describe('Markdown-Fussnoten und Bildunterschriften', () => {
    const view = [0, 0, 595, 842];
    const line = (str, y, region) => ({ ...item(str, 72, y), region });
    const region = (id, label, box = {}) => ({ id, label, enabled: true, x: 72, y: 0, w: 400, h: 20, ...box });

    it('zerlegt Fussnotenbereiche in einzelne Fussnoten', () => {
        expect(splitFootnotes('1 Siehe Akten.\n² BGE 140 IV 1,\nE. 3.2.\nohne Nummer')).toEqual([
            { number: '1', text: 'Siehe Akten.' },
            { number: '2', text: 'BGE 140 IV 1, E. 3.2. ohne Nummer' },
        ]);
        expect(splitFootnotes('Quelle: Akten')).toEqual([{ number: null, text: 'Quelle: Akten' }]);
    });

    it('findet Fussnotenzeichen nur, wo sie eindeutig sind', () => {
        expect(markFootnoteReference('Die Akten.1 Weiter', '1', '1')).toBe('Die Akten.[^1] Weiter');
        expect(markFootnoteReference('Die Zeugin² sagt', '2', '2')).toBe('Die Zeugin[^2] sagt');
        expect(markFootnoteReference('gemäss Art. 1 und Ziff. 3.1 am 12.03.2024', '1', '1')).toBeNull();
        expect(markFootnoteReference('Abschnitt12 folgt', '1', '1')).toBeNull();
    });

    const pages = () => [
        { number: 1, view, layout: { regions: [region('a', 'text'), region('f', 'footnote')], order: ['a', 'f'] }, items: [
            line('Die Zeugin erscheint.1 Sie sagt aus.', 700, 'a'), line('1 Siehe Akten.', 100, 'f'),
        ] },
        { number: 2, view, layout: { regions: [region('b', 'text'), region('g', 'footnote')], order: ['b', 'g'] }, items: [
            line('Weiter im Text²', 700, 'b'), line('2 BGE 140 IV 1.', 100, 'g'),
        ] },
    ];

    it('setzt [^n] an die Fundstelle und die Definitionen ans Dokumentende', () => {
        const texts = buildPageTexts(pages(), { ...DEFAULT_OPTIONS, footnotes: 'markdown' });
        expect(texts[0]).toBe('Die Zeugin erscheint.[^1] Sie sagt aus.');
        expect(texts[1]).toBe('Weiter im Text[^2]\n\n[^1]: Siehe Akten.\n\n[^2]: BGE 140 IV 1.');
    });

    it('macht doppelte Nummern eindeutig', () => {
        const p = pages();
        p[1].items = [line('Weiter im Text.1', 700, 'b'), line('1 Andere Quelle.', 100, 'g')];
        const texts = buildPageTexts(p, { ...DEFAULT_OPTIONS, footnotes: 'markdown' });
        expect(texts[0]).toBe('Die Zeugin erscheint.[^1] Sie sagt aus.');
        expect(texts[1]).toBe('Weiter im Text.[^2-1]\n\n[^1]: Siehe Akten.\n\n[^2-1]: Andere Quelle.');
    });

    it('ordnet Bildunterschriften dem nächsten Bild zu', () => {
        const regions = [
            region('i', 'image', { y: 100, h: 200 }),
            region('c', 'figure_title', { y: 305, h: 15 }),
            region('j', 'chart', { y: 400, h: 100 }),
            region('d', 'figure_title', { y: 380, h: 15 }),
            region('x', 'figure_title', { y: 700, h: 15 }),
        ];
        expect([...figureCaptions(regions)]).toEqual([['i', 'c'], ['j', 'd']]);
    });

    it('nimmt die Bildunterschrift in den Platzhalter', () => {
        const page = { number: 1, view, layout: {
            regions: [region('i', 'image', { y: 100, h: 200 }), region('c', 'figure_title', { y: 305, h: 15 }), region('a', 'text', { y: 400 })],
            order: ['i', 'c', 'a'],
        }, items: [line('xX#~', 600, 'i'), line('Abb. 1: Tatort', 530, 'c'), line('Text.', 430, 'a')] };
        expect(buildPageTexts([page], { ...DEFAULT_OPTIONS, placeholders: true })[0]).toBe('[Abbildung: Abb. 1: Tatort]\n\nText.');
        expect(buildPageTexts([page], DEFAULT_OPTIONS)[0]).toBe('xX#~\n\nAbb. 1: Tatort\n\nText.');
    });
});
