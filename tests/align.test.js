import { describe, expect, it } from 'vitest';
import { alignWords, mapPosition, paragraphs } from '../src/process/align.js';
import { processText } from '../src/process/rules.js';

const at = (text, needle) => text.indexOf(needle);
const wordAt = (text, range) => text.slice(range.start, range.end);

describe('paragraphs', () => {
    it('liefert getrimmte Absätze mit Lage, wie processText sie bildet', () => {
        const text = '  Eins\nzwei\n\n\n  Drei  \n \nVier';
        expect(paragraphs(text).map(p => p.text)).toEqual(['Eins\nzwei', 'Drei', 'Vier']);
        for (const p of paragraphs(text)) expect(text.slice(p.start, p.end)).toBe(p.text);
    });
});

describe('alignWords', () => {
    it('ordnet gleiche Wörter zu und setzt ersetzte dazwischen', () => {
        expect(alignWords(['Ich', 'bin', 'unschuldig.'], ['Er', 'sei', 'unschuldig.'])).toEqual([0, 1, 2]);
    });
});

describe('mapPosition', () => {
    const input = 'Ich habe das Fahr-\nzeug am Montag abgeholt.\n\nIch war zu\nHause.';
    const output = processText(input, 'mann');

    it('findet ein unverändertes Wort im richtigen Absatz', () => {
        expect(output).toBe('Er habe das Fahrzeug am Montag abgeholt.\n\nEr sei zu Hause gewesen.');
        expect(wordAt(output, mapPosition(input, output, at(input, 'Montag')))).toBe('Montag');
        expect(wordAt(output, mapPosition(input, output, at(input, 'Hause')))).toBe('Hause');
    });

    it('ordnet ersetzte Wörter der passenden Stelle zu', () => {
        const second = at(input, 'Ich war');
        expect(wordAt(output, mapPosition(input, output, second))).toBe('Er');
        expect(mapPosition(input, output, second).start).toBeGreaterThan(output.indexOf('\n\n'));
    });

    it('funktioniert in beide Richtungen', () => {
        expect(wordAt(input, mapPosition(output, input, at(output, 'Montag')))).toBe('Montag');
        expect(wordAt(input, mapPosition(output, input, at(output, 'Fahrzeug')))).toBe('Fahr-');
    });

    it('arbeitet über den ganzen Text, wenn die Absätze nicht übereinstimmen', () => {
        const joined = processText(input, 'mann', { keepParagraphs: false });
        expect(wordAt(joined, mapPosition(input, joined, at(input, 'Hause')))).toBe('Hause');
    });

    it('liefert null bei leerem Text', () => {
        expect(mapPosition('', 'x', 0)).toBeNull();
    });
});
