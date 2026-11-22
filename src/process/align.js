// Ordnet eine Stelle in der Eingabe der entsprechenden Stelle im Ergebnis zu (und umgekehrt).
//
// Die Umwandlung arbeitet Absatz für Absatz (processText), Absatz i gehört also zu Absatz i.
// Innerhalb eines Absatzes werden Zeilen zusammengezogen und Wörter ersetzt; zugeordnet wird
// darum Wort für Wort über die längste gemeinsame Teilfolge. Ein ersetztes Wort ("Ich" → "Er")
// erhält die Position zwischen seinen unveränderten Nachbarn.
//
// Lange Texte (die Tabelle der Teilfolge wäre zu gross, z. B. ein PDF-Text ohne Leerzeilen):
// zuerst die ungefähre Lage über Ankerwörter (in beiden Texten genau einmal vorhanden), dann die
// Teilfolge nur im Umfeld dieser Lage. So wird im selben Bereich nach demselben Wort mit denselben
// Nachbarn gesucht, statt nach Anteil der Wortzahl zu schätzen.

const PARAGRAPH_SPLIT = /\n[ \t]*\n/g;
const MAX_CELLS = 4_000_000;
// Umfeld für lange Texte: Wörter vor/nach dem angeklickten Wort und um die geschätzte Lage
const WINDOW_FROM = 150;
const WINDOW_TO = 400;

/** Absätze mit ihrer Lage im Text (wie processText sie bildet: getrimmt, leere weggelassen). */
export function paragraphs(text) {
    const result = [];
    let start = 0;
    const push = end => {
        const raw = text.slice(start, end);
        const lead = raw.length - raw.trimStart().length;
        const trimmed = raw.trim();
        if (trimmed) result.push({ start: start + lead, end: start + lead + trimmed.length, text: trimmed });
    };
    for (const match of text.matchAll(PARAGRAPH_SPLIT)) {
        push(match.index);
        start = match.index + match[0].length;
    }
    push(text.length);
    return result;
}

/** Wörter eines Texts mit Lage. */
export function words(text, offset = 0) {
    return [...text.matchAll(/\S+/g)].map(m => ({ word: m[0], start: offset + m.index, end: offset + m.index + m[0].length }));
}

// Vergleich ohne Satzzeichen und Gross-/Kleinschreibung: "Hause." entspricht "Hause"
const normalize = word => word.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

/** Für jedes Wort von a der Index des zugeordneten Worts in b (LCS, Lücken interpoliert). */
export function alignWords(rawA, rawB) {
    const a = rawA.map(normalize);
    const b = rawB.map(normalize);
    const n = a.length;
    const m = b.length;
    const map = new Array(n).fill(-1);
    if (n === 0 || m === 0) return map;
    if ((n + 1) * (m + 1) <= MAX_CELLS) {
        const width = m + 1;
        const table = new Uint16Array((n + 1) * width);
        for (let i = n - 1; i >= 0; i--) {
            for (let j = m - 1; j >= 0; j--) {
                table[i * width + j] = a[i] === b[j] && a[i] !== ''
                    ? table[(i + 1) * width + j + 1] + 1
                    : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
            }
        }
        for (let i = 0, j = 0; i < n && j < m;) {
            if (a[i] === b[j] && a[i] !== '') {
                map[i++] = j++;
            } else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) {
                i++;
            } else {
                j++;
            }
        }
    }
    // Nicht zugeordnete Wörter: zwischen den Nachbarn verteilen (ohne Anker proportional)
    for (let i = 0; i < n; i++) {
        if (map[i] >= 0) continue;
        let prev = i - 1;
        while (prev >= 0 && map[prev] < 0) prev--;
        let next = i + 1;
        while (next < n && map[next] < 0) next++;
        const fromA = prev >= 0 ? prev : -1;
        const fromB = prev >= 0 ? map[prev] : -1;
        const toA = next < n ? next : n;
        const toB = next < n ? map[next] : m;
        const t = (i - fromA) / (toA - fromA);
        // abrunden: ein zusammengefügtes Wort ("Fahrzeug") landet auf seinem ersten Teil ("Fahr-")
        let value = Math.floor(fromB + t * (toB - fromB));
        if (toB - fromB > 1) value = Math.min(toB - 1, Math.max(fromB + 1, value));
        map[i] = Math.min(m - 1, Math.max(0, value));
    }
    return map;
}

/**
 * Ankerpaare [i, j]: Wörter, die in a und b je genau einmal vorkommen, in derselben Reihenfolge
 * (längste aufsteigende Folge, so fallen über Kreuz liegende Zufallstreffer weg).
 */
export function uniqueAnchors(a, b) {
    const count = list => {
        const map = new Map();
        list.forEach((w, i) => {
            if (!w) return;
            const entry = map.get(w);
            if (entry) entry.n++;
            else map.set(w, { n: 1, i });
        });
        return map;
    };
    const inA = count(a);
    const inB = count(b);
    const pairs = [];
    for (const [w, { n, i }] of inA) {
        const other = inB.get(w);
        if (n === 1 && other?.n === 1) pairs.push([i, other.i]);
    }
    pairs.sort((x, y) => x[0] - y[0]);

    // Längste aufsteigende Folge nach j (Patience Sorting)
    const tails = [];
    const prev = new Array(pairs.length);
    pairs.forEach(([, j], k) => {
        let lo = 0;
        let hi = tails.length;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (pairs[tails[mid]][1] < j) lo = mid + 1;
            else hi = mid;
        }
        prev[k] = lo > 0 ? tails[lo - 1] : -1;
        tails[lo] = k;
    });
    const result = [];
    for (let k = tails.length ? tails[tails.length - 1] : -1; k >= 0; k = prev[k]) result.push(pairs[k]);
    return result.reverse();
}

// Ungefähre Lage von a[index] in b: zwischen den umgebenden Ankern interpoliert
function estimate(a, b, index) {
    const anchors = uniqueAnchors(a, b);
    let before = [-1, -1];
    let after = [a.length, b.length];
    for (const pair of anchors) {
        if (pair[0] === index) return pair[1];
        if (pair[0] < index) before = pair;
        else {
            after = pair;
            break;
        }
    }
    const t = (index - before[0]) / (after[0] - before[0]);
    return Math.round(before[1] + t * (after[1] - before[1]));
}

/** Index des Worts in `toList`, das `fromList[index]` entspricht. */
export function mapWordIndex(fromList, toList, index) {
    const n = fromList.length;
    const m = toList.length;
    if ((n + 1) * (m + 1) <= MAX_CELLS) return alignWords(fromList, toList)[index];
    const guess = Math.min(m - 1, Math.max(0, estimate(fromList.map(normalize), toList.map(normalize), index)));
    const fromStart = Math.max(0, index - WINDOW_FROM);
    const fromEnd = Math.min(n, index + WINDOW_FROM + 1);
    const toStart = Math.max(0, guess - WINDOW_TO);
    const toEnd = Math.min(m, guess + WINDOW_TO + 1);
    const local = alignWords(fromList.slice(fromStart, fromEnd), toList.slice(toStart, toEnd));
    return toStart + local[index - fromStart];
}

function wordIndexAt(list, offset) {
    if (list.length === 0) return -1;
    const inside = list.findIndex(w => offset >= w.start && offset <= w.end);
    if (inside >= 0) return inside;
    // zwischen Wörtern: das nächste Wort danach, am Ende das letzte
    const after = list.findIndex(w => w.start > offset);
    return after >= 0 ? after : list.length - 1;
}

/**
 * Stelle in `from` → entsprechende Stelle in `to`.
 * @returns {{start: number, end: number}|null} Lage des zugeordneten Worts in `to`
 */
export function mapPosition(from, to, offset) {
    const fromParas = paragraphs(from);
    const toParas = paragraphs(to);
    if (!fromParas.length || !toParas.length) return null;

    let fromWords;
    let toWords;
    if (fromParas.length === toParas.length) {
        let p = fromParas.findIndex(para => offset <= para.end);
        if (p < 0) p = fromParas.length - 1;
        fromWords = words(fromParas[p].text, fromParas[p].start);
        toWords = words(toParas[p].text, toParas[p].start);
    } else {
        // Absätze nicht gleich (z. B. «Absätze erhalten» aus): über den ganzen Text
        fromWords = words(from);
        toWords = words(to);
    }
    const index = wordIndexAt(fromWords, offset);
    if (index < 0 || !toWords.length) return null;
    const target = toWords[mapWordIndex(fromWords.map(w => w.word), toWords.map(w => w.word), index)];
    return { start: target.start, end: target.end };
}
