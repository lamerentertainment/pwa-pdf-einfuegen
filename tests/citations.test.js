import { describe, expect, it } from 'vitest';
import { findCitations } from '../src/process/citations.js';

const labels = text => findCitations(text).map(c => c.label);

describe('Bundesgerichtsentscheide', () => {
    it('erkennt Geschäftsnummern in verschiedenen Schreibweisen', () => {
        expect(labels('Urteile 6B_123/2020, 1C 45/2019, 2C.12/2018 und 6S.123/2004.'))
            .toEqual(['6B_123/2020', '1C_45/2019', '2C_12/2018', '6S_123/2004']);
    });

    it('verlinkt auf bger.li', () => {
        expect(findCitations('vgl. 6B_1/2021')[0].url).toBe('https://bger.li/6B_1/2021');
        expect(findCitations('BGE 145 IV 1 E. 2.3')[0].url).toBe('https://bger.li/145-IV-1');
    });

    it('erkennt BGE mit allen Bänden', () => {
        expect(labels('BGE 141 IV 61; BGE 120 Ia 31; BGE 136 III 1'))
            .toEqual(['BGE 141 IV 61', 'BGE 120 Ia 31', 'BGE 136 III 1']);
    });

    it('verwechselt Datumsangaben und Aktenzeichen nicht mit Geschäftsnummern', () => {
        expect(labels('am 12/2020 und Akten 4/2019, Seite 12 von 2020')).toEqual([]);
    });
});

describe('Gesetzesartikel', () => {
    it('erkennt Artikel mit Absatz, Ziffer und litera', () => {
        expect(labels('gemäss Art. 19 Abs. 1 lit. c BetmG sowie Art. 6 Ziff. 1 EMRK'))
            .toEqual(['Art. 19 BetmG', 'Art. 6 EMRK']);
    });

    it('erkennt Buchstaben- und lateinische Zusätze', () => {
        expect(labels('Art. 12a ZGB, Art. 3bis StGB, Artikel 111 StGB')).toEqual(['Art. 12a ZGB', 'Art. 3bis StGB', 'Art. 111 StGB']);
    });

    it('übernimmt den Erlass bei Aufzählungen und i.V.m.', () => {
        expect(labels('Art. 47 und Art. 49 StGB')).toEqual(['Art. 47 StGB', 'Art. 49 StGB']);
        expect(labels('Art. 12 Abs. 2 i.V.m. Art. 13 StGB')).toEqual(['Art. 12 StGB', 'Art. 13 StGB']);
    });

    it('verlinkt auf die Fedlex-Suche wie das Makro', () => {
        expect(findCitations('Art. 47 StGB')[0].url)
            .toBe('https://www.fedlex.admin.ch/de/search?collection=classified_compilation&classifiedBy=StGB&article=47');
    });

    it('ignoriert Artikel ohne Erlass und «Art» im Sinne von Weise', () => {
        expect(labels('Die Art der Tat. Art. 5 der Verordnung.')).toEqual([]);
    });

    it('zählt Wiederholungen statt sie doppelt aufzuführen', () => {
        const [first] = findCitations('Art. 47 StGB … erneut Art. 47 Abs. 1 StGB');
        expect(first).toMatchObject({ label: 'Art. 47 StGB', count: 2 });
    });

    it('erkennt geschützte Leerschläge (wie das Makro)', () => {
        expect(labels('Art. 47 StGB')).toEqual(['Art. 47 StGB']);
    });
});
