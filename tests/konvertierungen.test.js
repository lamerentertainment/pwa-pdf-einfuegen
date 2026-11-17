import { describe, expect, it } from 'vitest';
import {
    EINGEBAUT, alleKonvertierungen, dupliziereKonvertierung, entferneEintrag, erstelleKonvertierung, exportDaten,
    findeKonvertierung, kettenWarnungen, leseImport, listenFuer, loescheKonvertierung, pruefeEintrag, setzeAusgeblendet,
    setzeEintrag, sichtbareKonvertierungen, stelleWiederHer, zeilen,
} from '../src/process/konvertierungen.js';
import { alsAussageFormatieren, eingebauteListen, processText } from '../src/process/rules.js';

const mann = EINGEBAUT[0];
const mit = (konv, liste, change) => ({ ...konv, aenderungen: change(konv, liste) });

describe('eingebaute Konvertierungen', () => {
    it('ergeben genau die eingebauten Wortlisten', () => {
        expect(listenFuer(EINGEBAUT[0])).toEqual(eingebauteListen('m'));
        expect(listenFuer(EINGEBAUT[1])).toEqual(eingebauteListen('w'));
    });

    it('wandeln gleich um wie bisher', () => {
        const text = 'Ich war gestern bei meiner Mutter. Ich habe mir nichts dabei gedacht.';
        expect(processText(text, { listen: listenFuer(EINGEBAUT[1]) })).toBe(alsAussageFormatieren(text, 'w').trim());
    });
});

describe('Abweichungen von der Grundlage', () => {
    it('ändert einen Eintrag an seinem Platz und hängt neue ans Ende', () => {
        let konv = { ...mann, aenderungen: {} };
        konv = mit(konv, 'pronomen', k => setzeEintrag(k, 'pronomen', ['ich', 'der Beschuldigte']));
        konv = mit(konv, 'pronomen', k => setzeEintrag(k, 'pronomen', ['dir', 'ihm']));
        const rows = zeilen(konv, 'pronomen');
        const ich = rows.findIndex(r => r.eintrag[0] === 'ich');
        expect(rows[ich]).toMatchObject({ stand: 'geaendert', eintrag: ['ich', 'der Beschuldigte'], original: ['ich', 'er'] });
        expect(ich).toBe(eingebauteListen('m').pronomen.findIndex(e => e[0] === 'ich'));
        expect(rows.at(-1)).toMatchObject({ stand: 'neu', eintrag: ['dir', 'ihm'] });
        expect(processText('Ich gebe es dir.', { listen: listenFuer(konv) })).toBe('Der Beschuldigte gebe es ihm.');
    });

    it('entfernt eingebaute Einträge und stellt sie wieder her', () => {
        let konv = mit(mann, 'pronomen', k => entferneEintrag(k, 'pronomen', 'ich'));
        expect(konv.aenderungen.pronomen.entfernt).toEqual(['ich']);
        expect(listenFuer(konv).pronomen.some(e => e[0] === 'ich')).toBe(false);
        konv = mit(konv, 'pronomen', k => stelleWiederHer(k, 'pronomen', 'ich'));
        expect(konv.aenderungen).toEqual({});
    });

    it('speichert nichts, wenn ein Eintrag wieder dem eingebauten entspricht', () => {
        let konv = mit(mann, 'praesens', k => setzeEintrag(k, 'praesens', ['ist', 'wäre']));
        konv = mit(konv, 'praesens', k => setzeEintrag(k, 'praesens', ['ist', 'sei']));
        expect(konv.aenderungen).toEqual({});
    });

    it('entfernt einen neuen Eintrag ganz', () => {
        let konv = mit(mann, 'praesens', k => setzeEintrag(k, 'praesens', ['xyz', 'abc']));
        konv = mit(konv, 'praesens', k => entferneEintrag(k, 'praesens', 'xyz'));
        expect(konv.aenderungen).toEqual({});
    });

    it('beginnt bei der Grundlage «leer» ohne Einträge', () => {
        expect(listenFuer({ grundlage: 'leer', aenderungen: {} }).praeteritum).toEqual([]);
    });
});

describe('kettenWarnungen', () => {
    it('warnt, wenn ein eigenes Ersatzwort später nochmals ersetzt wird', () => {
        const konv = mit(mann, 'pronomen', k => setzeEintrag(k, 'pronomen', ['ihr', 'euer']));
        const appended = mit(konv, 'pronomen', k => setzeEintrag(k, 'pronomen', ['euer', 'deren']));
        const [w] = kettenWarnungen(appended);
        expect(w.zuerst.eintrag).toEqual(['ihr', 'euer']);
        expect(w.danach.eintrag).toEqual(['euer', 'deren']);
    });

    it('meldet keine Ketten innerhalb der eingebauten Listen', () => {
        expect(kettenWarnungen(mann)).toEqual([]);
    });
});

describe('pruefeEintrag', () => {
    it('verlangt ein Wort ohne Leerzeichen', () => {
        expect(pruefeEintrag('pronomen', ['', 'x'])).toMatch(/leer/);
        expect(pruefeEintrag('pronomen', ['zwei worte', 'x'])).toMatch(/Leerzeichen/);
        expect(pruefeEintrag('zusammenfuegung', ['zu gemacht', 'zugemacht'])).toBeNull();
        expect(pruefeEintrag('praeteritum', ['ging', 'sei'])).toMatch(/Ungültig/);
    });
});

describe('Export und Import', () => {
    const eigene = { id: 'x', name: 'Mehrzahl', grundlage: 'mann', aenderungen: { pronomen: { neu: [['wir', 'sie']], entfernt: ['ich'] } } };

    it('liest einen Export unverändert wieder ein', () => {
        const [k] = leseImport(JSON.stringify(exportDaten([eigene])));
        expect(k).toEqual({ name: 'Mehrzahl', grundlage: 'mann', aenderungen: eigene.aenderungen });
    });

    it('lehnt fremde oder fehlerhafte Dateien ab', () => {
        expect(() => leseImport('kein json')).toThrow(/JSON/);
        expect(() => leseImport('{"a":1}')).toThrow(/keine Konvertierungen/);
        const kaputt = exportDaten([{ ...eigene, aenderungen: { pronomen: { neu: [['', 'x']] } } }]);
        expect(() => leseImport(JSON.stringify(kaputt))).toThrow(/leer/);
    });
});

describe('Speicher', () => {
    it('erstellt, dupliziert, blendet aus und löscht', () => {
        const id = dupliziereKonvertierung('mann');
        expect(findeKonvertierung(id)).toMatchObject({ name: 'Eigene indirekte Rede (Mann)', grundlage: 'mann' });
        const kopie = dupliziereKonvertierung(id);
        expect(findeKonvertierung(kopie).name).toBe('Kopie von Eigene indirekte Rede (Mann)');
        const gleich = erstelleKonvertierung({ name: 'Kopie von Eigene indirekte Rede (Mann)' });
        expect(findeKonvertierung(gleich).name).toBe('Kopie von Eigene indirekte Rede (Mann) (2)');

        setzeAusgeblendet('mann', true);
        expect(sichtbareKonvertierungen().some(k => k.id === 'mann')).toBe(false);
        setzeAusgeblendet('mann', false);
        expect(sichtbareKonvertierungen().some(k => k.id === 'mann')).toBe(true);

        for (const k of [id, kopie, gleich]) loescheKonvertierung(k);
        expect(alleKonvertierungen()).toHaveLength(2);
    });
});
