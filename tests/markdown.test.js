import { describe, expect, it } from 'vitest';
import { hasMarkdownTable, prepareMarkdown } from '../src/capture/markdown.js';

describe('prepareMarkdown', () => {
    it('entfernt Einrückungen, damit sie nicht als Codeblock gelten', () => {
        expect(prepareMarkdown('Frage:\n                Antwort eingerückt\n    1. Punkt')).toBe('Frage:\nAntwort eingerückt\n1. Punkt');
    });

    it('lässt die Einrückung verschachtelter Listenpunkte stehen', () => {
        expect(prepareMarkdown('- Einkommen\n  - abzüglich Steuern\n    weiter')).toBe('- Einkommen\n  - abzüglich Steuern\nweiter');
    });
});

describe('hasMarkdownTable', () => {
    it('erkennt eine Tabelle mit Trennzeile', () => {
        expect(hasMarkdownTable('Text\n\n| Position | Betrag |\n| --- | ---: |\n| Gebühr | 300 |')).toBe(true);
    });

    it('hält senkrechte Striche im Fliesstext nicht für eine Tabelle', () => {
        expect(hasMarkdownTable('a | b | c\nweiter')).toBe(false);
    });
});
