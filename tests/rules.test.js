import { describe, expect, it } from 'vitest';
import golden from './fixtures/pdf-einfuegen-golden.json';
import {
    ALLE_SCHRITTE, alsAussageFormatieren, eingebauteListen, ersetzeWort, processText, verarbeite, vonPdfEinfuegen,
    zeilenumbruecheEntfernen,
} from '../src/process/rules.js';

const ohne = (...ids) => ({ ...ALLE_SCHRITTE, ...Object.fromEntries(ids.map(id => [id, false])) });

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

    it('setzt das Leerzeichen vor "und" am Satzteilende richtig', () => {
        expect(alsAussageFormatieren('Ich ging nach Hause und schlief sofort ein.', 'm'))
            .toBe('Er sei nach Hause gegangen und habe sofort ein geschlafen. ');
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
        expect(processText('Ich bin\nunschuldig.\n\nIch war zu\nHause.', { listen: eingebauteListen('m') })).toBe('Er sei unschuldig.\n\nEr sei zu Hause gewesen.');
    });

    it('fügt auf Wunsch alles zu einem Absatz zusammen', () => {
        expect(processText('Erste Zeile\n\nzweite Zeile', {}, { keepParagraphs: false })).toBe('Erste Zeile zweite Zeile');
    });
});

describe('Schritte der Bereinigung einzeln abwählen', () => {
    it('behält Zeilenumbrüche', () => {
        expect(verarbeite('Erste\nZeile', { schritte: ohne('umbrueche') })).toBe('Erste\nZeile');
    });

    it('behält Ergänzungsstriche ohne Auflösen der Worttrennung', () => {
        expect(verarbeite('Kantons-\nund Bundesrecht', { schritte: ohne('trennung') })).toBe('Kantons- und Bundesrecht ');
        expect(verarbeite('Kantons-\nund Bundesrecht')).toBe('Kantonsund Bundesrecht ');
    });

    it('löst Worttrennungen auch ohne Zusammenfügen der Zeilen auf', () => {
        expect(verarbeite('Jung-\ngeselle', { schritte: ohne('umbrueche') })).toBe('Junggeselle');
    });

    it('lässt Anführungszeichen, Beträge und OCR-Fehler stehen', () => {
        const schritte = ohne('anfuehrungszeichen', 'franken', 'ocrZeichen', 'ocrWoerter');
        expect(verarbeite('lch zahle CHF 50.00 «sofort» ,,ja"', { schritte })).toBe('lch zahle CHF 50.00 «sofort» ,,ja" ');
    });

    it('wendet eigene Wortlisten an', () => {
        const listen = { ...eingebauteListen('m'), pronomen: [['ich', 'der Beschuldigte'], ['mir', 'dem Beschuldigten']] };
        expect(processText('Ich habe mir das gekauft.', { listen })).toBe('Der Beschuldigte habe dem Beschuldigten das gekauft.');
    });
});
