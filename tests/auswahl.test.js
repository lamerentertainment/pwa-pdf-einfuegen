import { describe, expect, it } from 'vitest';
import { setzeEin, teileAuswahl } from '../src/llm/auswahl.js';

describe('Prompt auf markierten Bereich', () => {
    const text = 'Einleitung.\n\nIch war zu Hause.\n\nSchluss.';

    it('schickt nur den markierten Text ohne Randleerraum', () => {
        const start = text.indexOf('\n\nIch');
        const end = text.indexOf('Schluss');
        const teile = teileAuswahl(text, start, end);
        expect(teile.kern).toBe('Ich war zu Hause.');
        expect(teile.vor).toBe('Einleitung.\n\n');
        expect(teile.nach).toBe('\n\nSchluss.');
    });

    it('setzt das Ergebnis an derselben Stelle ein und lässt den Rest unverändert', () => {
        const start = text.indexOf('Ich');
        const teile = teileAuswahl(text, start, start + 'Ich war zu Hause.'.length);
        expect(setzeEin(teile, '  Er sei zu Hause gewesen.\n')).toBe('Einleitung.\n\nEr sei zu Hause gewesen.\n\nSchluss.');
    });

    it('kommt mit einer Markierung am Anfang oder Ende zurecht', () => {
        expect(setzeEin(teileAuswahl('abc def', 0, 3), 'X')).toBe('X def');
        expect(setzeEin(teileAuswahl('abc def', 4, 7), 'Y')).toBe('abc Y');
    });
});
