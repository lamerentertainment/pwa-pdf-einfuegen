import { describe, expect, it } from 'vitest';
import { alignWords, mapPosition, paragraphs } from '../src/process/align.js';
import { eingebauteListen, processText } from '../src/process/rules.js';

const mann = { listen: eingebauteListen('m') };

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
    const output = processText(input, mann);

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
        const joined = processText(input, mann, { keepParagraphs: false });
        expect(wordAt(joined, mapPosition(input, joined, at(input, 'Hause')))).toBe('Hause');
    });

    it('liefert null bei leerem Text', () => {
        expect(mapPosition('', 'x', 0)).toBeNull();
    });
});

describe('mapPosition bei sehr langen Texten', () => {
    // Ein einziger langer Absatz (PDF-Text ohne Leerzeilen); die indirekte Rede ändert die
    // Wortzahl («war» → «sei … gewesen»), so dass sich die Stellen stetig verschieben
    const input = Array.from({ length: 900 }, (_, i) =>
        i % 3 === 0 ? `Ich war am Tag ${i} zu Hause und sah den Hinweis${i}.` : `Dann habe ich die Kontrolle${i} gemacht.`).join('\n');
    const output = processText(input, mann);

    it('trifft dasselbe Wort auch weit hinten, in beide Richtungen', () => {
        expect(input.split(/\s+/).length).toBeGreaterThan(2500);
        expect(output).not.toContain('\n\n');
        for (const needle of ['Kontrolle10 ', 'Hinweis450.', 'Kontrolle877 ', 'Hinweis897.']) {
            const word = needle.trim();
            expect(wordAt(output, mapPosition(input, output, at(input, needle)))).toBe(word);
            expect(wordAt(input, mapPosition(output, input, at(output, needle)))).toBe(word);
        }
    });

    it('trifft ein häufiges Wort am richtigen Ort', () => {
        const target = mapPosition(input, output, at(input, 'Tag 600 '));
        expect(output.slice(target.start, target.start + 7)).toBe('Tag 600');
    });

    it('auch über den ganzen Text, wenn die Absätze nicht übereinstimmen', () => {
        const spaced = input.split('\n').join('\n\n');
        for (const needle of ['Kontrolle10 ', 'Hinweis450.', 'Kontrolle877 ']) {
            expect(wordAt(output, mapPosition(spaced, output, at(spaced, needle)))).toBe(needle.trim());
        }
    });
});
