// Markiert, welche Wörter einer Ausgabe gegenüber der Eingabe neu oder verändert sind
// (längste gemeinsame Teilfolge über die Wörter). Ersetzt die HTML-Hervorhebung des Originals:
// es gelangt kein HTML in den Text, und die Markierung folgt auch nachträglichen Änderungen.

// Obergrenze für Wörter × Wörter, darüber wird nicht verglichen (Speicher ~2 Byte pro Zelle)
const MAX_CELLS = 4_000_000;

/**
 * @returns {Array<{text: string, changed: boolean}>|null} Ausgabe in Wörter und Leerraum
 *   zerlegt; null, wenn der Text für einen Vergleich zu lang ist
 */
export function diffWords(before, after) {
    const tokens = after.split(/(\s+)/).filter(t => t !== '');
    const a = before.split(/\s+/).filter(Boolean);
    const words = tokens.filter(t => !/^\s+$/.test(t));
    const n = a.length;
    const m = words.length;
    if ((n + 1) * (m + 1) > MAX_CELLS) return null;

    const width = m + 1;
    const table = new Uint16Array((n + 1) * width);
    for (let i = n - 1; i >= 0; i--) {
        for (let j = m - 1; j >= 0; j--) {
            table[i * width + j] = a[i] === words[j]
                ? table[(i + 1) * width + j + 1] + 1
                : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
        }
    }
    const kept = new Uint8Array(m);
    for (let i = 0, j = 0; i < n && j < m;) {
        if (a[i] === words[j]) {
            kept[j] = 1;
            i++;
            j++;
        } else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) {
            i++;
        } else {
            j++;
        }
    }

    let w = 0;
    return tokens.map(text => (/^\s+$/.test(text) ? { text, changed: false } : { text, changed: !kept[w++] }));
}

/** Absatzweise vergleichen, wenn Ein- und Ausgabe gleich viele Absätze haben. */
export function diffParagraphs(before, after) {
    const split = text => text.split(/\n[ \t]*\n/).map(p => p.trim()).filter(Boolean);
    const inParts = split(before);
    const outParts = split(after);
    if (inParts.length !== outParts.length) return diffWords(before, after);
    const result = [];
    for (let i = 0; i < outParts.length; i++) {
        const part = diffWords(inParts[i], outParts[i]);
        if (!part) return null;
        if (i > 0) result.push({ text: '\n\n', changed: false });
        result.push(...part);
    }
    return result;
}
