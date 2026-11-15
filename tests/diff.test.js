import { describe, expect, it } from 'vitest';
import { diffParagraphs, diffWords } from '../src/process/diff.js';

const changed = tokens => tokens.filter(t => t.changed).map(t => t.text);

describe('diffWords', () => {
    it('markiert ersetzte Wörter', () => {
        expect(changed(diffWords('Ich bin unschuldig.', 'Er sei unschuldig.'))).toEqual(['Er', 'sei']);
    });

    it('markiert zusammengefügte Wörter und lässt Leerraum unverändert', () => {
        const result = diffWords('das Fahr-\nzeug', 'das Fahrzeug');
        expect(changed(result)).toEqual(['Fahrzeug']);
        expect(result.map(t => t.text).join('')).toBe('das Fahrzeug');
    });

    it('verweigert zu lange Texte', () => {
        const long = 'wort '.repeat(3000);
        expect(diffWords(long, long)).toBeNull();
    });
});

describe('diffParagraphs', () => {
    it('vergleicht Absatz für Absatz', () => {
        const result = diffParagraphs('Ich bin da.\n\nIch war da.', 'Er sei da.\n\nEr sei da gewesen.');
        expect(result.map(t => t.text).join('')).toBe('Er sei da.\n\nEr sei da gewesen.');
        // «da.» → «da»: der Punkt wandert hinter das angehängte Hilfsverb, darum gilt auch «da» als verändert
        expect(changed(result)).toEqual(['Er', 'sei', 'Er', 'sei', 'da', 'gewesen.']);
    });
});
