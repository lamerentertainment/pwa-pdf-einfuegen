import { beforeEach, describe, expect, it } from 'vitest';
import {
    EIGENE_GRUPPE, EINGEBAUT, aenderePrompt, allePrompts, bibliothek, duplizierePrompt, erstellePrompt, exportDaten,
    findePrompt, gruppiert, leseImport, loeschePrompt, platzhalterHinweis, pruefePrompt, setzeAusgeblendet, sichtbarePrompts,
} from '../src/llm/promptBibliothek.js';

beforeEach(() => {
    bibliothek.eigene = [];
    bibliothek.ausgeblendet = [];
});

describe('Promptbibliothek', () => {
    it('enthält die eingebauten Prompts, nicht änderbar', () => {
        expect(EINGEBAUT.length).toBe(10);
        expect(EINGEBAUT.every(p => p.eingebaut)).toBe(true);
        aenderePrompt(EINGEBAUT[0].id, { title: 'X' });
        expect(EINGEBAUT[0].title).not.toBe('X');
    });

    it('legt eigene Prompts an, mit freiem Titel und Standardgruppe', () => {
        const a = erstellePrompt({ title: 'Kurzfassung', prompt: 'Fasse zusammen: {{INPUT}}' });
        const b = erstellePrompt({ title: 'Kurzfassung', prompt: 'x' });
        expect(findePrompt(a)).toMatchObject({ title: 'Kurzfassung', group: EIGENE_GRUPPE, description: '' });
        expect(findePrompt(b).title).toBe('Kurzfassung (2)');
        expect(gruppiert().at(-1)[0]).toBe(EIGENE_GRUPPE);
    });

    it('verwendet einen eingebauten Prompt als Vorlage, auch mit angepasstem Text', () => {
        const id = duplizierePrompt(EINGEBAUT[0].id, 'angepasst {{INPUT}}');
        expect(findePrompt(id)).toMatchObject({ title: `${EINGEBAUT[0].title} (eigen)`, group: EIGENE_GRUPPE, prompt: 'angepasst {{INPUT}}' });
        expect(findePrompt(duplizierePrompt(id)).title).toBe(`Kopie von ${EINGEBAUT[0].title} (eigen)`);
    });

    it('ändert, blendet aus und löscht', () => {
        const id = erstellePrompt({ title: 'A', prompt: 'p' });
        aenderePrompt(id, { title: '  ', group: ' Gutachten ', prompt: 'neu' });
        expect(findePrompt(id)).toMatchObject({ title: 'A', group: 'Gutachten', prompt: 'neu' });
        setzeAusgeblendet(EINGEBAUT[1].id, true);
        setzeAusgeblendet(id, true);
        expect(sichtbarePrompts().map(p => p.id)).not.toContain(EINGEBAUT[1].id);
        loeschePrompt(id);
        expect(findePrompt(id)).toBeNull();
        expect(bibliothek.ausgeblendet).toEqual([EINGEBAUT[1].id]);
        expect(allePrompts().length).toBe(10);
    });

    it('exportiert und importiert eigene Prompts', () => {
        erstellePrompt({ title: 'A', group: 'G', description: 'd', prompt: 'p {{INPUT}}' });
        const text = JSON.stringify(exportDaten(bibliothek.eigene));
        expect(leseImport(text)).toEqual([{ title: 'A', group: 'G', description: 'd', prompt: 'p {{INPUT}}' }]);
        expect(() => leseImport('kein json')).toThrow('keine gültige JSON');
        expect(() => leseImport('{"format":"anderes"}')).toThrow('keine Prompts');
        expect(() => leseImport(JSON.stringify({ format: 'pdf-einfuegen-prompts', prompts: [{ title: 'A', prompt: ' ' }] }))).toThrow('Prompt 1');
    });

    it('prüft Felder und weist auf den Platzhalter hin', () => {
        expect(pruefePrompt({ title: 'A', prompt: 'p' })).toBeNull();
        expect(pruefePrompt({ title: '', prompt: 'p' })).toMatch('Titel');
        expect(pruefePrompt({ title: 'A', prompt: 'p', group: 3 })).toMatch('Ungültig');
        expect(platzhalterHinweis('a {{INPUT}}')).toBeNull();
        expect(platzhalterHinweis('a')).toMatch('angehängt');
        expect(platzhalterHinweis('{{INPUT}} {{INPUT}}')).toMatch('2-mal');
    });
});
