import { describe, expect, it } from 'vitest';
import { beschreibeHerkunft, herkunftProWort } from '../src/process/herkunft.js';
import { ALLE_SCHRITTE, eingebauteListen, processText } from '../src/process/rules.js';

function herkunft(input, options = {}) {
    const output = processText(input, options);
    const ketten = herkunftProWort(input, output, options);
    const words = output.split(/\s+/).filter(Boolean);
    return Object.fromEntries(words.map((w, i) => [w, ketten[i].map(k => [k.stufe, k.eintrag ?? `${k.vorher} → ${k.nachher}`])]));
}

const mann = { listen: eingebauteListen('m') };

describe('herkunftProWort', () => {
    it('ordnet Wortlisten-Einträge zu, auch das angehängte Hilfsverb', () => {
        const h = herkunft('Ich ging nach Hause.', mann);
        expect(h.Er).toEqual([['pronomen', ['ich', 'er']]]);
        expect(h.sei).toEqual([['praeteritum', ['ging', 'sei', 'gegangen']]]);
        expect(h['gegangen.']).toEqual([['praeteritum', ['ging', 'sei', 'gegangen']]]);
        expect(h.nach).toEqual([]);
    });

    it('zeigt eine Kette über mehrere Regeln', () => {
        const h = herkunft('lch bin da.', mann);
        expect(h.Er).toEqual([['ocr', ['lch', 'Ich']], ['pronomen', ['ich', 'er']]]);
        expect(h.sei).toEqual([['praesens', ['bin', 'sei']]]);
    });

    it('nennt Schritte der Bereinigung ohne Eintrag', () => {
        const h = herkunft('Das Fahr-\nzeug kostete CHF 50.00 und «mehr».');
        expect(h.Fahrzeug).toEqual([['trennung', 'Fahr- → Fahrzeug']]);
        expect(h['Fr.']).toEqual([['franken', 'CHF → Fr.']]);
        expect(h['50.--']).toEqual([['franken', '50.00 → 50.--']]);
        expect(h['"mehr".']).toEqual([['anfuehrungszeichen', '«mehr». → "mehr".']]);
    });

    it('behandelt das angehängte Hilfsverb als eingefügt', () => {
        const options = { listen: eingebauteListen('m') };
        const output = processText('Ich zahlte für das Fahr-\nzeug.', options);
        expect(output).toBe('Er habe für das Fahrzeug gezahlt.');
        const ketten = herkunftProWort('Ich zahlte für das Fahr-\nzeug.', output, options);
        expect(ketten[4].map(k => k.stufe)).toEqual(['trennung', 'praeteritum']);
        expect(ketten[5]).toEqual([{ stufe: 'praeteritum', vorher: null, nachher: 'gezahlt.', eintrag: ['zahlte', 'habe', 'gezahlt'] }]);
        expect(beschreibeHerkunft(ketten[4])[1].regel).toBe('«Fahrzeug.» → «Fahrzeug» (Satzzeichen hinter das Hilfsverb verschoben)');
    });

    it('findet eigene Einträge mit mehreren Wörtern', () => {
        const listen = { ...eingebauteListen('m'), pronomen: [['ich', 'der Beschuldigte']] };
        const h = herkunft('Ich bin da.', { listen });
        expect(h.Der).toEqual([['pronomen', ['ich', 'der Beschuldigte']]]);
        expect(h.Beschuldigte).toEqual([['pronomen', ['ich', 'der Beschuldigte']]]);
    });

    it('arbeitet Absatz für Absatz', () => {
        const input = 'Ich bin da.\n\nlch war dort.';
        const output = processText(input, mann);
        const ketten = herkunftProWort(input, output, mann);
        expect(ketten).toHaveLength(output.split(/\s+/).length);
        expect(ketten[3].map(k => k.stufe)).toEqual(['ocr', 'pronomen']);
    });

    it('liefert null, wenn das Ergebnis nicht zu den Regeln passt', () => {
        expect(herkunftProWort('Ich bin da.', 'Etwas anderes.', mann)).toBeNull();
    });

    it('beachtet abgewählte Schritte', () => {
        const schritte = { ...ALLE_SCHRITTE, ocr: false };
        const h = herkunft('lch bin da.', { schritte, listen: eingebauteListen('m') });
        expect(h.lch).toEqual([]);
    });
});

describe('beschreibeHerkunft', () => {
    it('beschreibt Einträge und markiert eigene', () => {
        const zeilen = beschreibeHerkunft([
            { stufe: 'praeteritum', vorher: 'ging', nachher: 'sei', eintrag: ['ging', 'sei', 'gegangen'] },
            { stufe: 'franken', vorher: 'CHF', nachher: 'Fr.', eintrag: null },
        ], stufe => stufe === 'praeteritum');
        expect(zeilen).toEqual([
            { label: 'Verben (Präteritum)', regel: 'ging → sei … gegangen', eigen: true },
            { label: 'Frankenbeträge vereinheitlichen', regel: '«CHF» → «Fr.»', eigen: false },
        ]);
    });
});
