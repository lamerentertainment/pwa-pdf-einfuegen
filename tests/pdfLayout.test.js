import { describe, it, expect } from 'vitest';
import { reconstructPageText, reconstructDocumentText, UNCERTAIN_MARK } from '../src/capture/pdfLayout.js';

// 10pt font, 5pt per char
const item = (str, x, y) => ({ str, width: str.length * 5, height: 10, transform: [1, 0, 0, 1, x, y] });

describe('reconstructPageText', () => {
    it('reads two columns top to bottom, left before right', () => {
        const text = reconstructPageText([
            item('Links eins', 50, 700), item('Rechts eins', 300, 700),
            item('Links zwei', 50, 688), item('Rechts zwei', 300, 688),
            item('Links drei', 50, 676), item('Rechts drei', 300, 676),
        ]);
        expect(text.indexOf('Links drei')).toBeLessThan(text.indexOf('Rechts eins'));
        expect(text.indexOf('Links eins')).toBeLessThan(text.indexOf('Links zwei'));
    });

    it('keeps a full-width heading above two columns', () => {
        const text = reconstructPageText([
            item('Titel ueber die ganze Seite hinweg und weiter nach rechts', 50, 750),
            item('Links eins', 50, 700), item('Rechts eins', 300, 700),
            item('Links zwei', 50, 688), item('Rechts zwei', 300, 688),
        ]);
        expect(text.startsWith('Titel')).toBe(true);
        expect(text.indexOf('Links zwei')).toBeLessThan(text.indexOf('Rechts eins'));
    });

    it('keeps words of one line together with single spaces', () => {
        expect(reconstructPageText([item('Hallo', 50, 700), item('Welt', 80, 700)])).toBe('Hallo Welt');
    });

    it('returns empty string without text', () => {
        expect(reconstructPageText([])).toBe('');
    });
});

describe('reconstructDocumentText', () => {
    const view = [0, 0, 600, 800];
    const page = (n, body) => ({
        view,
        items: [
            item('Muster AG Vertrag', 50, 780),
            ...body,
            item(`Seite ${n} von 3`, 250, 20),
        ],
    });

    it('keeps the header on page one, drops it on later pages along with page numbers', () => {
        const text = reconstructDocumentText([
            page(1, [item('Erster Absatz', 50, 600)]),
            page(2, [item('Zweiter Absatz', 50, 600)]),
            page(3, [item('Dritter Absatz', 50, 600)]),
        ]);
        expect(text).toBe('Muster AG Vertrag\n\nErster Absatz\n\nZweiter Absatz\n\nDritter Absatz');
    });

    it('keeps a unique line in the margin', () => {
        const text = reconstructDocumentText([
            { view, items: [item('Text', 50, 600), item('Einmalig oben', 50, 780)] },
            { view, items: [item('Text zwei', 50, 600)] },
        ]);
        expect(text).toContain('Einmalig oben');
    });

    it('joins hyphenated words across lines', () => {
        const text = reconstructDocumentText([
            { view, items: [item('Die Verwal-', 50, 600), item('tung entscheidet.', 50, 588)] },
        ]);
        expect(text).toBe('Die Verwaltung entscheidet.');
    });

    it('keeps hyphen before capitals and conjunctions', () => {
        const text = reconstructDocumentText([
            { view, items: [item('Ein-', 50, 600), item('und Ausgang, E-', 50, 588), item('Mail', 50, 576)] },
        ]);
        expect(text).toContain('Ein-\nund');
        expect(text).toContain('E-\nMail');
    });
});

describe('interview transcripts (Einvernahmeprotokolle)', () => {
    // 12pt line pitch: numbers in the left margin, answers full width, questions indented
    const lineNo = (n, y) => item(String(n), 20, y);

    it('drops margin line numbers, also when OCR merged one into a short line', () => {
        const text = reconstructPageText([
            lineNo(1, 700), item('Wo waren Sie am Abend des 16. Mai?', 250, 700),
            lineNo(2, 688), item('Ich war zu Hause bei meiner Familie und habe ferngesehen.', 60, 688),
            lineNo(3, 676), item('Wer kann das bestätigen?', 250, 676),
            item('4 Niemand.', 20, 664),
            lineNo(5, 652), item('Haben Sie Sandy an diesem Abend gesehen?', 250, 652),
            lineNo(6, 640), item('Nein, ich habe sie seit Wochen nicht mehr gesehen.', 60, 640),
        ]);
        expect(text).not.toMatch(/^\s*\d+\b/m);
        expect(text).toContain('Niemand.');
        expect(text).not.toContain('4 Niemand');
    });

    it('reads alternating questions and answers in order instead of as two columns', () => {
        const text = reconstructPageText([
            item('Wer kann das bestätigen?', 250, 700),
            item('Niemand.', 60, 688),
            item('Haben Sie Sandy gesehen?', 250, 676),
            item('Nein.', 60, 664),
        ]);
        expect(text.indexOf('Wer kann')).toBeLessThan(text.indexOf('Niemand.'));
        expect(text.indexOf('Niemand.')).toBeLessThan(text.indexOf('Haben Sie'));
        expect(text.indexOf('Haben Sie')).toBeLessThan(text.indexOf('Nein.'));
    });

    it('keeps each form value on the line of its label', () => {
        const text = reconstructPageText([
            item('Name:', 50, 700), item('STAINKOGLER', 250, 700),
            item('Vorname:', 50, 688), item('Sebbi', 250, 688),
            item('Geburtsdatum:', 50, 676), item('19.06.1987', 250, 676),
        ]);
        expect(text.split('\n')).toEqual(['Name:    STAINKOGLER', 'Vorname:    Sebbi', 'Geburtsdatum:    19.06.1987']);
    });

    it('keeps numbers that are part of the text', () => {
        const text = reconstructPageText([
            item('Die Busse beträgt', 50, 700), item('500', 140, 700), item('Franken.', 160, 700),
        ]);
        expect(text).toBe('Die Busse beträgt 500 Franken.');
    });
});

describe('options', () => {
    const lineNo = (n, y) => item(String(n), 20, y);
    const numbered = () => [
        lineNo(8, 700), item('Wo waren Sie am Abend?', 250, 700),
        lineNo(9, 688), item('Ich war zu Hause.', 60, 688),
        lineNo(10, 676),
        lineNo(11, 664), item('Wer kann das bestätigen?', 250, 664),
        item('12 Niemand.', 20, 652),
        lineNo(13, 640), item('Gut.', 250, 640),
    ];

    it('keeps line numbers in front of their line when asked', () => {
        const text = reconstructPageText(numbered(), { keepLineNumbers: true });
        const lines = text.split('\n').filter(Boolean);
        expect(lines).toEqual([
            ' 8  Wo waren Sie am Abend?',
            ' 9  Ich war zu Hause.',
            '11  Wer kann das bestätigen?',
            '12  Niemand.',
            '13  Gut.',
        ]);
    });

    it('drops line numbers by default', () => {
        expect(reconstructPageText(numbered())).not.toMatch(/\d/);
    });

    it('keeps line numbers across pages of a document', () => {
        const view = [0, 0, 600, 800];
        const text = reconstructDocumentText([{ view, items: numbered() }], { keepLineNumbers: true });
        expect(text).toContain(' 9  Ich war zu Hause.');
    });

    it('marks OCR lines below the score threshold', () => {
        const ocr = (str, x, y, ocrScore) => ({ ...item(str, x, y), ocrScore });
        const items = [ocr('Sicher erkannt', 50, 700, 0.97), ocr('Xyzq kritzel', 50, 688, 0.42)];
        expect(reconstructPageText(items, { uncertainBelow: 0.8 }))
            .toBe(`Sicher erkannt\n${UNCERTAIN_MARK} Xyzq kritzel`);
        expect(reconstructPageText(items)).toBe('Sicher erkannt\nXyzq kritzel');
    });

    it('marks an uncertain line after its kept line number', () => {
        const items = numbered().map(b => (b.str === 'Gut.' ? { ...b, ocrScore: 0.5 } : b));
        const text = reconstructPageText(items, { keepLineNumbers: true, uncertainBelow: 0.8 });
        expect(text).toContain(`13  ${UNCERTAIN_MARK} Gut.`);
    });
});

describe('structure option', () => {
    const structure = { structure: true };

    it('keeps indentation as leading spaces', () => {
        const text = reconstructPageText([
            item('Erwägungen', 50, 700),
            item('1. Der Beschuldigte bestreitet den Vorwurf.', 50, 688),
            item('a) Er war zur Tatzeit zu Hause.', 80, 676),
            item('b) Zeugen gibt es keine.', 80, 664),
        ], structure);
        expect(text.split('\n')).toEqual([
            'Erwägungen',
            '1. Der Beschuldigte bestreitet den Vorwurf.',
            '      a) Er war zur Tatzeit zu Hause.',
            '      b) Zeugen gibt es keine.',
        ]);
    });

    it('keeps text left and right on the same line at its column', () => {
        const text = reconstructPageText([
            item('Kriminalgericht Luzern', 50, 750), item('Luzern, 12. März 2026', 400, 750),
            item('Der Präsident hat in der Strafsache gegen den Beschuldigten folgendes Urteil gefällt.', 50, 700),
        ], structure);
        const [first, , last] = text.split('\n');
        expect(first).toMatch(/^Kriminalgericht Luzern {4,}Luzern, 12\. März 2026$/);
        expect(first.indexOf('Luzern,')).toBe(70); // (400 - 50) / 5
        expect(last).toMatch(/^Der Präsident/);
    });

    it('still reads two columns of running text column by column', () => {
        const long = s => s.padEnd(40, '.');
        const items = [];
        for (let i = 0; i < 5; i++) {
            items.push(item(long(`Links ${i}`), 50, 700 - i * 12), item(long(`Rechts ${i}`), 300, 700 - i * 12));
        }
        const text = reconstructPageText(items, { structure: true, tables: true });
        expect(text).not.toContain('|');
        expect(text.indexOf('Links 4')).toBeLessThan(text.indexOf('Rechts 0'));
    });

    it('indents relative to each column of a two-column page', () => {
        const long = s => s.padEnd(40, '.');
        const items = [];
        for (let i = 0; i < 4; i++) {
            items.push(item(long(`Links ${i}`), 50, 700 - i * 12), item(long(`Rechts ${i}`), 300, 700 - i * 12));
        }
        const text = reconstructPageText(items, structure);
        expect(text.split('\n').filter(l => l.startsWith('Rechts')).length).toBe(4);
    });

    it('keeps the indentation of a hyphenated word continued on the next line out', () => {
        const view = [0, 0, 600, 800];
        const text = reconstructDocumentText([{ view, items: [
            item('Text am Rand', 50, 620),
            item('Die Verwal-', 80, 600), item('tung entscheidet.', 80, 588),
        ] }], structure);
        expect(text).toContain('Die Verwaltung entscheidet.');
    });
});

describe('tables option', () => {
    const tables = { tables: true };
    const row = (y, ...cells) => cells.map(([str, x]) => item(str, x, y));

    it('writes a table as Markdown', () => {
        const text = reconstructPageText([
            item('Beweismittel', 50, 760),
            ...row(700, ['Nr.', 50], ['Datum', 100], ['Beschreibung', 200]),
            ...row(688, ['1', 50], ['12.03.2026', 100], ['Mobiltelefon', 200]),
            ...row(676, ['2', 50], ['14.03.2026', 100], ['Kontoauszug', 200]),
            item('Die Beweismittel wurden dem Verteidiger zugestellt und von ihm eingesehen.', 50, 640),
        ], tables);
        expect(text.split('\n\n')).toEqual([
            'Beweismittel',
            '| Nr. | Datum | Beschreibung |\n| --- | --- | --- |\n| 1 | 12.03.2026 | Mobiltelefon |\n| 2 | 14.03.2026 | Kontoauszug |',
            'Die Beweismittel wurden dem Verteidiger zugestellt und von ihm eingesehen.',
        ]);
    });

    it('joins a cell wrapped over several lines into its row', () => {
        const text = reconstructPageText([
            ...row(700, ['Nr.', 50], ['Datum', 100], ['Beschreibung', 200]),
            ...row(688, ['1', 50], ['12.03.2026', 100], ['Mobiltelefon des Beschul-', 200]),
            item('digten, sichergestellt', 200, 676),
            ...row(664, ['2', 50], ['14.03.2026', 100], ['Kontoauszug', 200]),
        ], tables);
        expect(text).toContain('| 1 | 12.03.2026 | Mobiltelefon des Beschuldigten, sichergestellt |');
        expect(text).toContain('| 2 | 14.03.2026 | Kontoauszug |');
    });

    it('escapes pipes in cells', () => {
        const text = reconstructPageText([
            ...row(700, ['A', 50], ['B', 100], ['C|D', 200]),
            ...row(688, ['1', 50], ['2', 100], ['3', 200]),
        ], tables);
        expect(text).toContain('| A | B | C\\|D |');
    });

    it('does not turn form labels and their values into a table', () => {
        const text = reconstructPageText([
            item('Name:', 50, 700), item('STAINKOGLER', 250, 700),
            item('Vorname:', 50, 688), item('Sebbi', 250, 688),
            item('Geburtsdatum:', 50, 676), item('19.06.1987', 250, 676),
        ], { structure: true, tables: true });
        expect(text).not.toContain('|');
        expect(text.split('\n')[1]).toBe('Vorname:' + ' '.repeat(32) + 'Sebbi');
    });

    it('leaves a table as aligned text when only structure is on', () => {
        const text = reconstructPageText([
            ...row(700, ['Nr.', 50], ['Datum', 100], ['Beschreibung', 200]),
            ...row(688, ['1', 50], ['12.03.2026', 100], ['Mobiltelefon', 200]),
        ], { structure: true });
        expect(text).not.toContain('|');
        expect(text.split('\n')[1]).toBe('1' + ' '.repeat(9) + '12.03.2026' + ' '.repeat(10) + 'Mobiltelefon');
    });
});

describe('page markers', () => {
    const view = [0, 0, 600, 800];

    it('puts a marker in front of every page, also an empty one', () => {
        const text = reconstructDocumentText([
            { view, items: [item('Erste Seite', 50, 600)] },
            { view, items: [] },
            { view, items: [item('Dritte Seite', 50, 600)] },
        ], { pageMarkers: true, pageLabel: 'Seite' });
        expect(text).toBe('--- Seite 1 ---\n\nErste Seite\n\n--- Seite 2 ---\n\n--- Seite 3 ---\n\nDritte Seite');
    });

    it('does not join a hyphenated word across a page marker', () => {
        const text = reconstructDocumentText([
            { view, items: [item('Die Verwal-', 50, 600)] },
            { view, items: [item('tung entscheidet.', 50, 600)] },
        ], { pageMarkers: true, pageLabel: 'Page' });
        expect(text).toBe('--- Page 1 ---\n\nDie Verwal-\n\n--- Page 2 ---\n\ntung entscheidet.');
    });
});

describe('cases found in real PDFs', () => {
    const row = (y, ...cells) => cells.map(([str, x]) => item(str, x, y));

    it('ignores wide whitespace items that pdf.js puts between table cells', () => {
        const blank = (x, y, width) => ({ str: ' ', width, height: 0, transform: [1, 0, 0, 1, x, y] });
        const text = reconstructPageText([
            ...row(700, ['Nr.', 50], ['Datum', 100], ['Ort', 200]), blank(65, 700, 180),
            ...row(688, ['1', 50], ['12.03.2026', 100], ['Luzern', 200]), blank(55, 688, 200),
        ], { tables: true });
        expect(text).toBe('| Nr. | Datum | Ort |\n| --- | --- | --- |\n| 1 | 12.03.2026 | Luzern |');
    });

    it('joins a wrapped cell centred vertically around its row', () => {
        const text = reconstructPageText([
            ...row(700, ['Nr.', 50], ['Datum', 100], ['Gegenstand', 200]),
            item('Mobiltelefon des', 200, 684),
            ...row(678, ['1', 50], ['12.03.2026', 100]),
            item('Beschuldigten', 200, 672),
            ...row(650, ['2', 50], ['14.03.2026', 100], ['Laptop', 200]),
        ], { tables: true });
        expect(text).toContain('| 1 | 12.03.2026 | Mobiltelefon des Beschuldigten |');
        expect(text).toContain('| 2 | 14.03.2026 | Laptop |');
    });

    it('does not pull the first line of a right column into a table above', () => {
        const long = s => s.padEnd(45, '.');
        const items = [
            ...row(760, ['Position', 50], ['Betrag', 150], ['Bemerkung', 220]),
            ...row(748, ['Gebühr', 50], ['2500.00', 150], ['Tarif', 220]),
            ...row(736, ['Total', 50], ['2500.00', 150], ['keine', 220]),
            item(long('Rechts eins'), 320, 712),
        ];
        for (let i = 0; i < 4; i++) {
            items.push(item(long(`Links ${i}`), 50, 702 - i * 12), item(long(`Rechts ${i + 2}`), 320, 700 - i * 12));
        }
        const text = reconstructPageText(items, { structure: true, tables: true });
        expect(text).toContain('| Total | 2500.00 | keine |');
        expect(text.indexOf('Links 3')).toBeLessThan(text.indexOf('Rechts eins'));
        expect(text.indexOf('Rechts eins')).toBeLessThan(text.indexOf('Rechts 2'));
    });
});

describe('Zeilenabstand', () => {
    const line = (str, y, h = 12) => ({ str, transform: [h, 0, 0, h, 72, y], width: str.length * 6, height: h });

    it('fügt bei 1,5-zeiligem Abstand keine Leerzeilen zwischen umbrochenen Zeilen ein', () => {
        const items = ['Ich war zu Hause und habe mit meiner', 'Schwester telefoniert und bin danach', 'früh schlafen gegangen.']
            .map((s, i) => line(s, 700 - i * 18));
        expect(reconstructPageText(items)).toBe(
            'Ich war zu Hause und habe mit meiner\nSchwester telefoniert und bin danach\nfrüh schlafen gegangen.');
    });

    it('trennt Absätze weiterhin mit einer Leerzeile', () => {
        const items = [line('Erster Absatz, Zeile eins', 700), line('Erster Absatz, Zeile zwei', 682), line('Zweiter Absatz', 640)];
        expect(reconstructPageText(items)).toBe('Erster Absatz, Zeile eins\nErster Absatz, Zeile zwei\n\nZweiter Absatz');
    });
});

describe('Silbentrennung am Zeilenende', () => {
    const page = lines => [{
        view: [0, 0, 595, 842],
        items: lines.map((str, i) => ({ str, transform: [12, 0, 0, 12, 72, 700 - i * 14], width: str.length * 6, height: 12 })),
    }];

    it.each([
        ['Bindestrich', '-'],
        ['typografischer Bindestrich (U+2010)', '‐'],
        ['geschützter Bindestrich (U+2011)', '‑'],
        ['weicher Trennstrich (U+00AD)', '­'],
        ['weicher Trennstrich mit U+2010', '­‐'],
    ])('fügt Wörter mit %s zusammen', (_, hyphen) => {
        expect(reconstructDocumentText(page([`als Buch${hyphen}`, 'halterin angestellt']))).toBe('als Buchhalterin angestellt');
    });

    it('lässt Aufzählungen mit «und» stehen', () => {
        expect(reconstructDocumentText(page(['Ein‐', 'und Ausgang']))).toBe('Ein‐\nund Ausgang');
    });
});

describe('lists', () => {
    // Punkt 3 pt gross, auf halber Höhe der 10-pt-Zeile, 8 pt vor dem Text
    const bulletAt = (textX, y) => ({ x: textX - 11, y: y + 2, w: 3, h: 3 });
    const page = () => ({
        items: [
            item('Die Rechnung:', 50, 700),
            item('Einkommen netto', 70, 685),
            item('abzüglich Steuern', 90, 670),
            item('abzüglich Unterhalt', 90, 655),
            item('Tagessatz', 70, 640),
        ],
        bullets: [bulletAt(70, 685), bulletAt(90, 670), bulletAt(90, 655), bulletAt(70, 640)],
    });
    const expected = 'Die Rechnung:\n- Einkommen netto\n  - abzüglich Steuern\n  - abzüglich Unterhalt\n- Tagessatz';

    it('macht aus gezeichneten Punkten verschachtelte Markdown-Listen', () => {
        const { items, bullets } = page();
        expect(reconstructPageText(items, { lists: true, bullets, structure: true })).toBe(expected);
        expect(reconstructPageText(items, { lists: true, bullets })).toBe(expected);
        expect(reconstructDocumentText([{ ...page(), view: [0, 0, 600, 800] }], { lists: true })).toBe(expected);
    });

    it('lässt den Text ohne die Einstellung wie bisher', () => {
        const { items, bullets } = page();
        expect(reconstructPageText(items, { bullets, structure: true })).toBe(
            'Die Rechnung:\nEinkommen netto\n    abzüglich Steuern\n    abzüglich Unterhalt\nTagessatz');
    });

    it('erkennt Aufzählungszeichen im Text, allein oder vor dem Text', () => {
        const text = reconstructPageText([
            item('•', 50, 700), item('Erster Punkt', 60, 700),
            item('• Zweiter Punkt', 50, 685),
            item('', 50, 670), item('Dritter Punkt (Symbol-Schrift)', 60, 670),
        ], { lists: true });
        expect(text).toBe('- Erster Punkt\n- Zweiter Punkt\n- Dritter Punkt (Symbol-Schrift)');
    });

    it('nimmt Striche nur als Liste, wenn mehrere untereinander stehen', () => {
        const dashes = reconstructPageText([item('– erstens', 50, 700), item('– zweitens', 50, 685)], { lists: true });
        expect(dashes).toBe('- erstens\n- zweitens');
        const prose = reconstructPageText([
            item('Er sagte', 50, 700), item('– und das ist wichtig – nichts.', 50, 685),
        ], { lists: true });
        expect(prose).toBe('Er sagte\n– und das ist wichtig – nichts.');
    });

    it('fängt nach einer langen Lücke eine neue Liste an', () => {
        const text = reconstructPageText([
            item('Oben eingerückt', 90, 700), item('Unten', 70, 500),
        ], { lists: true, bullets: [bulletAt(90, 700), bulletAt(70, 500)] });
        expect(text).toBe('- Oben eingerückt\n\n- Unten');
    });
});
