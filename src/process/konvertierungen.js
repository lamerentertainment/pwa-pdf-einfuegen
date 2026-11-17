// Konvertierungen für Stufe 2: eingebaute (indirekte Rede Mann/Frau) und eigene.
//
// Eine eigene Konvertierung speichert nur ihre Abweichungen von einer Grundlage (Mann, Frau oder
// leer): neue oder geänderte Einträge und entfernte Wörter, je Wortliste. Verbesserungen der
// eingebauten Listen in einem App-Update wirken so auch in den eigenen Konvertierungen.
//
// Gespeichert wird im Browser (localStorage), nur auf diesem Gerät; es sind Einstellungen, nie
// Dokumentinhalt. Zum Sichern und Weitergeben gibt es Export und Import als .json-Datei.
import { reactive, watch } from 'vue';
import { eingebauteListen } from './rules.js';

export const LISTEN = Object.freeze([
    { id: 'pronomen', label: 'Pronomen', spalten: ['Wort', 'Ersatz'] },
    { id: 'praeteritum', label: 'Verben (Präteritum)', spalten: ['Verb', 'Konjunktiv', 'am Satzteilende'] },
    { id: 'praesens', label: 'Verben (Präsens)', spalten: ['Verb', 'Konjunktiv'] },
    { id: 'zusammenfuegung', label: 'Zusammenschreibung', spalten: ['Getrennt', 'Zusammen'] },
]);
// Reihenfolge, in der die Listen angewendet werden (siehe verarbeite() in rules.js)
const ABLAUF = ['pronomen', 'praeteritum', 'praesens', 'zusammenfuegung'];

export const GRUNDLAGEN = Object.freeze({ mann: 'Mann', frau: 'Frau', leer: 'leer' });

export const EINGEBAUT = Object.freeze([
    { id: 'mann', name: 'Konvertierung in indirekte Rede (Mann)', grundlage: 'mann', eingebaut: true, aenderungen: {} },
    { id: 'frau', name: 'Konvertierung in indirekte Rede (Frau)', grundlage: 'frau', eingebaut: true, aenderungen: {} },
]);

const LEER = Object.freeze({ pronomen: [], praesens: [], praeteritum: [], zusammenfuegung: [] });

export function grundlageListen(grundlage) {
    if (grundlage === 'mann') return eingebauteListen('m');
    if (grundlage === 'frau') return eingebauteListen('w');
    return LEER;
}

function aenderung(konv, liste) {
    return konv.aenderungen?.[liste] ?? { neu: [], entfernt: [] };
}

/**
 * Alle Einträge einer Liste mit ihrem Stand: 'eingebaut', 'geaendert', 'neu' oder 'entfernt'.
 * Geänderte Einträge bleiben an ihrem Platz, neue kommen ans Ende (siehe kettenWarnungen).
 */
export function zeilen(konv, liste) {
    const { neu = [], entfernt = [] } = aenderung(konv, liste);
    const neuNach = new Map(neu.map(e => [e[0], e]));
    const weg = new Set(entfernt);
    const rows = grundlageListen(konv.grundlage)[liste].map(original => {
        const key = original[0];
        if (weg.has(key)) return { eintrag: original, original, stand: 'entfernt' };
        if (neuNach.has(key)) {
            const eintrag = neuNach.get(key);
            neuNach.delete(key);
            return { eintrag, original, stand: 'geaendert' };
        }
        return { eintrag: original, original, stand: 'eingebaut' };
    });
    for (const eintrag of neuNach.values()) rows.push({ eintrag, original: null, stand: 'neu' });
    return rows;
}

/** Die wirksamen Wortlisten einer Konvertierung, wie verarbeite() sie erwartet. */
export function listenFuer(konv) {
    return Object.fromEntries(LISTEN.map(({ id }) => [
        id, zeilen(konv, id).filter(z => z.stand !== 'entfernt').map(z => z.eintrag),
    ]));
}

function mitAenderung(konv, liste, change) {
    const alt = aenderung(konv, liste);
    const next = change({ neu: [...(alt.neu ?? [])], entfernt: [...(alt.entfernt ?? [])] });
    const aenderungen = { ...konv.aenderungen };
    if (next.neu.length || next.entfernt.length) aenderungen[liste] = next;
    else delete aenderungen[liste];
    return aenderungen;
}

/** Fügt einen Eintrag hinzu oder ändert den Eintrag mit demselben Wort. Liefert neue Abweichungen. */
export function setzeEintrag(konv, liste, eintrag) {
    const key = eintrag[0];
    const original = grundlageListen(konv.grundlage)[liste].find(e => e[0] === key);
    return mitAenderung(konv, liste, a => {
        a.entfernt = a.entfernt.filter(k => k !== key);
        a.neu = a.neu.filter(e => e[0] !== key);
        // Gleich wie eingebaut: keine Abweichung mehr
        if (!original || original.some((v, i) => v !== eintrag[i])) a.neu.push(eintrag);
        return a;
    });
}

export function entferneEintrag(konv, liste, key) {
    const inGrundlage = grundlageListen(konv.grundlage)[liste].some(e => e[0] === key);
    return mitAenderung(konv, liste, a => {
        a.neu = a.neu.filter(e => e[0] !== key);
        if (inGrundlage && !a.entfernt.includes(key)) a.entfernt.push(key);
        return a;
    });
}

/** Macht eine Änderung oder Entfernung eines eingebauten Eintrags rückgängig. */
export function stelleWiederHer(konv, liste, key) {
    return mitAenderung(konv, liste, a => {
        a.neu = a.neu.filter(e => e[0] !== key);
        a.entfernt = a.entfernt.filter(k => k !== key);
        return a;
    });
}

export function anzahlAenderungen(konv) {
    let neu = 0;
    let entfernt = 0;
    for (const a of Object.values(konv.aenderungen ?? {})) {
        neu += a.neu?.length ?? 0;
        entfernt += a.entfernt?.length ?? 0;
    }
    return { neu, entfernt };
}

const woerter = text => ` ${text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean).join(' ')} `;

/**
 * Ketten, an denen eigene Einträge beteiligt sind: Die Listen laufen der Reihe nach über den
 * Text, ein Ersatzwort wird also von einem späteren Eintrag mit diesem Wort nochmals ersetzt
 * ("ich → sie", danach "sie → diese": aus "ich" würde "diese").
 */
export function kettenWarnungen(konv, max = 20) {
    const folge = [];
    for (const liste of ABLAUF) {
        for (const z of zeilen(konv, liste)) {
            if (z.stand === 'entfernt') continue;
            folge.push({ liste, eintrag: z.eintrag, eigen: z.stand !== 'eingebaut', ziel: woerter(z.eintrag.slice(1).join(' ')) });
        }
    }
    const warnungen = [];
    for (let i = 0; i < folge.length && warnungen.length < max; i++) {
        for (let j = i + 1; j < folge.length && warnungen.length < max; j++) {
            const [a, b] = [folge[i], folge[j]];
            if (!a.eigen && !b.eigen) continue;
            if (a.ziel.includes(woerter(b.eintrag[0]))) warnungen.push({ zuerst: a, danach: b });
        }
    }
    return warnungen;
}

/** Prüft einen Eintrag; liefert eine Fehlermeldung oder null. */
export function pruefeEintrag(liste, eintrag) {
    const spalten = LISTEN.find(l => l.id === liste).spalten.length;
    if (eintrag.length !== spalten || eintrag.some(v => typeof v !== 'string')) return 'Ungültiger Eintrag.';
    if (!eintrag[0].trim()) return 'Das Wort darf nicht leer sein.';
    if (eintrag[0] !== eintrag[0].trim()) return 'Das Wort darf nicht mit einem Leerzeichen beginnen oder enden.';
    if (eintrag.some(v => v.includes('\n'))) return 'Zeilenumbrüche sind nicht erlaubt.';
    if (liste !== 'zusammenfuegung' && /\s/.test(eintrag[0])) return 'Das Wort darf keine Leerzeichen enthalten.';
    return null;
}

// --- Export und Import -----------------------------------------------------------------------

const FORMAT = 'pdf-einfuegen-konvertierungen';

export function exportDaten(konvertierungen) {
    return {
        format: FORMAT,
        version: 1,
        konvertierungen: konvertierungen.map(({ name, grundlage, aenderungen }) => ({ name, grundlage, aenderungen })),
    };
}

/** Liest eine Exportdatei. Wirft bei ungültigem Inhalt einen Fehler mit verständlicher Meldung. */
export function leseImport(text) {
    let data;
    try {
        data = JSON.parse(text);
    } catch {
        throw new Error('Die Datei ist keine gültige JSON-Datei.');
    }
    if (data?.format !== FORMAT || !Array.isArray(data.konvertierungen)) {
        throw new Error('Die Datei enthält keine Konvertierungen aus dieser App.');
    }
    return data.konvertierungen.map((k, n) => {
        const wo = `Konvertierung ${n + 1}`;
        if (typeof k?.name !== 'string' || !k.name.trim()) throw new Error(`${wo}: Name fehlt.`);
        if (!(k.grundlage in GRUNDLAGEN)) throw new Error(`${wo}: unbekannte Grundlage.`);
        const aenderungen = {};
        for (const [liste, a] of Object.entries(k.aenderungen ?? {})) {
            if (!LISTEN.some(l => l.id === liste)) throw new Error(`${wo}: unbekannte Liste «${liste}».`);
            const neu = a?.neu ?? [];
            const entfernt = a?.entfernt ?? [];
            if (!Array.isArray(neu) || !Array.isArray(entfernt)) throw new Error(`${wo}: ungültige Liste «${liste}».`);
            for (const eintrag of neu) {
                const fehler = Array.isArray(eintrag) ? pruefeEintrag(liste, eintrag) : 'Ungültiger Eintrag.';
                if (fehler) throw new Error(`${wo}, ${liste}: ${fehler}`);
            }
            if (entfernt.some(v => typeof v !== 'string')) throw new Error(`${wo}: ungültige Liste «${liste}».`);
            aenderungen[liste] = { neu, entfernt };
        }
        return { name: k.name.trim().slice(0, 120), grundlage: k.grundlage, aenderungen };
    });
}

// --- Speicher im Browser ---------------------------------------------------------------------

const KEY = 'verarbeiten.konvertierungen';

function laden() {
    try {
        const data = JSON.parse(localStorage.getItem(KEY) ?? 'null');
        if (data && Array.isArray(data.eigene) && Array.isArray(data.ausgeblendet)) return data;
    } catch {
        // kein Speicher oder ungültiger Inhalt
    }
    return { eigene: [], ausgeblendet: [] };
}

export const konvertierungen = reactive(laden());

watch(konvertierungen, value => {
    try {
        localStorage.setItem(KEY, JSON.stringify(value));
    } catch {
        // nicht merken (privater Modus oder Speicher voll)
    }
}, { deep: true });

const neueId = () => `k-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export function alleKonvertierungen() {
    return [...EINGEBAUT, ...konvertierungen.eigene];
}

export function findeKonvertierung(id) {
    return alleKonvertierungen().find(k => k.id === id) ?? null;
}

export function istAusgeblendet(id) {
    return konvertierungen.ausgeblendet.includes(id);
}

export function sichtbareKonvertierungen() {
    return alleKonvertierungen().filter(k => !istAusgeblendet(k.id));
}

export function setzeAusgeblendet(id, ausblenden) {
    konvertierungen.ausgeblendet = konvertierungen.ausgeblendet.filter(x => x !== id);
    if (ausblenden) konvertierungen.ausgeblendet.push(id);
}

function freierName(name) {
    const namen = new Set(alleKonvertierungen().map(k => k.name));
    if (!namen.has(name)) return name;
    for (let n = 2; ; n++) if (!namen.has(`${name} (${n})`)) return `${name} (${n})`;
}

/** Neue eigene Konvertierung; liefert ihre id. */
export function erstelleKonvertierung({ name, grundlage = 'leer', aenderungen = {} }) {
    const konv = { id: neueId(), name: freierName(name), grundlage, aenderungen: JSON.parse(JSON.stringify(aenderungen)) };
    konvertierungen.eigene.push(konv);
    return konv.id;
}

export function dupliziereKonvertierung(id) {
    const vorlage = findeKonvertierung(id);
    const name = vorlage.eingebaut ? vorlage.name.replace(/^Konvertierung in /, 'Eigene ') : `Kopie von ${vorlage.name}`;
    return erstelleKonvertierung({ name, grundlage: vorlage.grundlage, aenderungen: vorlage.aenderungen });
}

export function aendereKonvertierung(id, felder) {
    const konv = konvertierungen.eigene.find(k => k.id === id);
    if (konv) Object.assign(konv, felder);
}

export function loescheKonvertierung(id) {
    konvertierungen.eigene = konvertierungen.eigene.filter(k => k.id !== id);
    konvertierungen.ausgeblendet = konvertierungen.ausgeblendet.filter(x => x !== id);
}
