// Welche Regel hat ein Wort verändert? Für die Anzeige beim Darüberfahren in Stufe 2.
//
// Der Text wird Stufe für Stufe verarbeitet (zwischenstaende() in rules.js). Von jedem Wort des
// Ergebnisses aus geht es rückwärts durch die Stufen: Steht das Wort unverändert schon vorher da
// (längste gemeinsame Teilfolge), geht es dort weiter; sonst hat diese Stufe es verändert, und es
// geht beim Wort weiter, an dessen Stelle es steht. So entsteht eine Kette, etwa
// «lch» → «Ich» (OCR: Wörter) → «Er» (Pronomen). Bei Wortlisten kommt der Eintrag dazu, der die
// Änderung bewirkt hat.
import { LISTEN } from './konvertierungen.js';
import { absaetze, SCHRITTE, zwischenstaende } from './rules.js';

const MAX_CELLS = 4_000_000;

export const HERKUNFT_LABEL = Object.freeze({
    ...Object.fromEntries(SCHRITTE.map(s => [s.id, s.label])),
    ...Object.fromEntries(LISTEN.map(l => [l.id, l.label])),
    zeilenenden: 'Zeilenenden vereinheitlichen',
    steuerzeichen: 'Steuerzeichen entfernen',
});

const woerter = text => text.split(/\s+/).filter(Boolean);
const norm = wort => wort.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

/**
 * Für jedes Wort von b der Index des gleichen Worts in a (exakt, längste gemeinsame Teilfolge)
 * oder -1; dazu für jedes veränderte Wort das Wort in a, an dessen Stelle es steht (-1: eingefügt).
 * null, wenn die Texte für einen Vergleich zu lang sind.
 */
function zuordnung(a, b) {
    const n = a.length;
    const m = b.length;
    if ((n + 1) * (m + 1) > MAX_CELLS) return null;
    const width = m + 1;
    const table = new Uint16Array((n + 1) * width);
    for (let i = n - 1; i >= 0; i--) {
        for (let j = m - 1; j >= 0; j--) {
            table[i * width + j] = a[i] === b[j]
                ? table[(i + 1) * width + j + 1] + 1
                : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
        }
    }
    const gleich = new Array(m).fill(-1);
    for (let i = 0, j = 0; i < n && j < m;) {
        if (a[i] === b[j]) {
            gleich[j++] = i++;
        } else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) {
            i++;
        } else {
            j++;
        }
    }
    // Veränderte Wörter zwischen denselben Ankern: zuerst auf ein Wort, das bis auf Satzzeichen
    // gleich ist ("Hause." → "Hause"), dann der Reihe nach; was übrig bleibt, ist eingefügt
    // (das angehängte Hilfsverb, das zweite Wort von "der Beschuldigte")
    const stelle = [...gleich];
    for (let j = 0; j < m;) {
        if (gleich[j] >= 0) {
            j++;
            continue;
        }
        let q = j;
        while (q < m && gleich[q] < 0) q++;
        const von = j > 0 ? gleich[j - 1] + 1 : 0;
        const bis = q < m ? gleich[q] : n;
        const frei = [];
        for (let i = von; i < bis; i++) frei.push(i);
        const offen = [];
        for (let k = j; k < q; k++) {
            const treffer = frei.findIndex(i => norm(a[i]) !== '' && norm(a[i]) === norm(b[k]));
            if (treffer >= 0) stelle[k] = frei.splice(treffer, 1)[0];
            else offen.push(k);
        }
        for (const k of offen) stelle[k] = frei.length ? frei.shift() : -1;
        j = q;
    }
    return { gleich, stelle };
}

/** Der Eintrag der Wortliste, der aus `vorher` das Wort `nachher` gemacht hat (oder null). */
function eintragFuer(angewendet, vorher, nachher) {
    if (!angewendet.length) return null;
    const ziel = norm(nachher);
    const quelle = vorher ? norm(vorher) : null;
    const passend = angewendet.filter(e => e.slice(1).some(teil => woerter(teil).some(w => norm(w) === ziel)));
    return passend.find(e => norm(e[0]) === quelle) ?? passend[0] ?? (angewendet.length === 1 ? angewendet[0] : null);
}

/**
 * Herkunft jedes Worts im Ergebnis, in der Reihenfolge der Wörter von `output`.
 * @returns {Array<Array<{stufe: string, vorher: string|null, nachher: string, eintrag: string[]|null}>>|null}
 *   je Wort die Kette der Änderungen (leer: unverändert); null, wenn `output` nicht zu den Regeln
 *   passt (etwa noch nicht neu berechnet) oder der Text zu lang ist
 */
export function herkunftProWort(input, output, { schritte, listen = null, keepParagraphs = true } = {}) {
    const result = [];
    const ende = [];
    for (const absatz of absaetze(input, keepParagraphs)) {
        // Stufen ohne Änderung überspringen
        const stufen = zwischenstaende(absatz, { schritte, listen })
            .filter((s, i, alle) => i === 0 || s.text !== alle[i - 1].text);
        const w = stufen.map(s => woerter(s.text));
        const zu = [];
        for (let i = 1; i < stufen.length; i++) {
            zu[i] = zuordnung(w[i - 1], w[i]);
            if (!zu[i]) return null;
        }
        const last = stufen.length - 1;
        for (let j = 0; j < w[last].length; j++) {
            const kette = [];
            let k = j;
            for (let i = last; i >= 1 && k >= 0; i--) {
                if (zu[i].gleich[k] >= 0) {
                    k = zu[i].gleich[k];
                    continue;
                }
                const vorher = zu[i].stelle[k] >= 0 ? w[i - 1][zu[i].stelle[k]] : null;
                const nachher = w[i][k];
                kette.unshift({ stufe: stufen[i].herkunft, vorher, nachher, eintrag: eintragFuer(stufen[i].angewendet, vorher, nachher) });
                k = zu[i].stelle[k];
            }
            result.push(kette);
            ende.push(w[last][j]);
        }
    }
    const aus = woerter(output);
    if (aus.length !== ende.length || aus.some((wort, i) => wort !== ende[i])) return null;
    return result;
}

/** Eine Zeile pro Änderung, für den Hinweis beim Darüberfahren. */
export function beschreibeHerkunft(kette, istEigen = () => false) {
    return kette.map(({ stufe, vorher, nachher, eintrag }) => {
        const label = HERKUNFT_LABEL[stufe] ?? stufe;
        // Präteritum: das Satzzeichen wandert mit ans Ende hinter das Hilfsverb
        if (stufe === 'praeteritum' && vorher && norm(vorher) === norm(nachher)) {
            return { label, regel: `«${vorher}» → «${nachher}» (Satzzeichen hinter das Hilfsverb verschoben)`, eigen: false };
        }
        if (eintrag) {
            const regel = `${eintrag[0]} → ${eintrag.slice(1).filter(Boolean).join(' … ')}`;
            return { label, regel, eigen: istEigen(stufe, eintrag) };
        }
        if (!vorher) return { label, regel: `«${nachher}» eingefügt`, eigen: false };
        return { label, regel: `«${vorher}» → «${nachher}»`, eigen: false };
    });
}
