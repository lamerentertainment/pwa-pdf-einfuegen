import { describe, expect, it } from 'vitest';
import golden from './fixtures/pdf-einfuegen-golden.json';
import {
    alsAussageFormatieren, ersetzeWort, processText, vonPdfEinfuegen, zeilenumbruecheEntfernen,
} from '../src/process/rules.js';

const run = {
    einfuegen: vonPdfEinfuegen,
    mann: text => alsAussageFormatieren(text, 'm'),
    frau: text => alsAussageFormatieren(text, 'w'),
};

describe('gleiches Ergebnis wie pdf-einfuegen (Python)', () => {
    it.each(golden.faelle.map(c => [c.modus, c.eingabe, c.erwartet]))('%s: %j', (mode, input, expected) => {
        expect(run[mode](input)).toBe(expected);
    });
});

describe('Korrekturen gegenüber dem Original', () => {
    it('verdirbt keine Wörter auf -ln oder -lch', () => {
        expect(vonPdfEinfuegen('Wir müssen handeln, die Regeln und die Milch prüfen.'))
            .toBe('Wir müssen handeln, die Regeln und die Milch prüfen. ');
    });

    it('korrigiert OCR-Fehler am Textanfang und nach Satzzeichen', () => {
        expect(vonPdfEinfuegen('lch war dort. "lch weiss es."')).toBe('Ich war dort. "Ich weiss es." ');
    });

    it('stürzt nicht ab, wenn ein Satzzeichen direkt auf das Verb folgt', () => {
        expect(alsAussageFormatieren('Ich ging.', 'm')).toBe('Er sei gegangen. ');
    });
});

describe('Eigenheiten wie in Python', () => {
    it('erkennt Umlaute als Buchstaben (Unicode-Wortgrenzen)', () => {
        expect(zeilenumbruecheEntfernen('Lösch- ung')).toBe('Löschung ');
    });

    it('ersetzt Zeichenfolgen ohne Sonderbedeutung von $', () => {
        expect(ersetzeWort('x ich $& y', 'ich', 'er')).toBe('x er $& y');
    });
});

describe('processText', () => {
    it('behält Absätze und entfernt das abschliessende Leerzeichen', () => {
        expect(processText('Ich bin\nunschuldig.\n\nIch war zu\nHause.', 'mann')).toBe('Er sei unschuldig.\n\nEr sei zu Hause gewesen.');
    });

    it('fügt auf Wunsch alles zu einem Absatz zusammen', () => {
        expect(processText('Erste Zeile\n\nzweite Zeile', 'einfuegen', { keepParagraphs: false })).toBe('Erste Zeile zweite Zeile');
    });
});
