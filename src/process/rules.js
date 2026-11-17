// Stufe 2: regelbasierte Weiterverarbeitung, übernommen aus pdf-einfuegen
// (courtapi/converters.py, Wortlisten aus courtapi/dict_db.py → wordlists.json).
//
// Die Umsetzung folgt dem Python-Original Schritt für Schritt; tests/rules.test.js prüft sie
// Zeichen für Zeichen gegen dessen Ergebnisse (tests/fixtures/pdf-einfuegen-golden.json).
// Fünf Fehler des Originals sind behoben (siehe scripts/pdf-einfuegen/generate_golden.py):
//   1. OCR-Ersetzungen nur am Wortanfang ("handeln" wurde zu "handeIn", "Milch" zu "MiIch")
//   2. kein Absturz, wenn ein Satzzeichen direkt auf ein Verb im Präteritum folgt ("Ich ging.")
//   3. Leerzeichen vor "und"/"oder" am Satzteilende: "nach Hause gegangen und" statt
//      "nach Hause  gegangenund"
//   4. Bindestrich am Zeilenende nur nach einem Buchstaben als Worttrennung: Seitenmarker
//      "--- Seite 2 ---" aus Stufe 1 bleiben ganz
//   5. Getrennte Wörter ("Jung- geselle") nur zwischen Buchstaben zusammenziehen: aus einem
//      Zahlenbereich "5-↵10" wurde "510"
//
// Python-Eigenheiten, die hier nachgebildet sind:
//   - \b und \w sind in Python Unicode-fähig (Umlaute zählen als Buchstaben), in JavaScript
//     nicht: dafür stehen START und END.
//   - str.replace ersetzt alle Vorkommen ohne Sonderzeichen: replaceAll() mit split/join.
//   - str.capitalize() setzt den Rest des Worts in Kleinbuchstaben: capitalize().
import lists from './wordlists.json';

const START = '(?<![\\p{L}\\p{N}_])';
const END = '(?![\\p{L}\\p{N}_])';
const PUNCTUATION_AFTER_WORD = [' ', ',', '.', ';', '?', '!'];
// Abkürzungen, deren Punkt kein Satzende ist (Liste des Originals ohne Hervorhebung)
const ABBREVIATIONS = ['Fr', 'ca', 'bzw', 'vgl', 'usw', 'bspw', 'etc', 'dat'];
// "Kost und Logis", "nach und nach", "und zu": hier endet der Satzteil nicht beim "und"
const IDIOM_EXCEPTIONS = '(?!\\s*Logis|\\s*nach|\\s*zu)';
const CONJUNCTIONS = ['und', 'oder'];

export const WORDLIST_SOURCE = lists.quelle;

function replaceAll(text, find, replacement) {
    return find ? text.split(find).join(replacement) : text;
}

function capitalize(word) {
    return word ? word.charAt(0).toUpperCase() + word.slice(1).toLowerCase() : word;
}

// Ersatz am Satzanfang: nur der erste Buchstabe gross, damit "der Beschuldigte" nicht zu
// "Der beschuldigte" wird (für die eingebauten Wortlisten gleich wie capitalize())
function upperFirst(text) {
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

function escapeRegExp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function endsWithDigit(text) {
    return /\p{Nd}$/u.test(text);
}

/** Ersetzt `find` überall dort, wo davor kein Buchstabe und keine Ziffer steht. */
function replaceAtWordStart(text, find, replacement) {
    return text.replace(new RegExp(START + escapeRegExp(find), 'gu'), () => replacement);
}

/**
 * Ersetzt ein Wort, wenn ein Leerzeichen davor und ein Leerzeichen oder Satzzeichen danach steht,
 * sowie in grossgeschriebener Form vor einem Leerzeichen (Satzanfang).
 */
export function ersetzeWort(text, word, replacement, { ocr = false } = {}) {
    for (const after of PUNCTUATION_AFTER_WORD) {
        text = replaceAll(text, ` ${word}${after}`, ` ${replacement}${after}`);
    }
    if (!ocr) {
        return replaceAll(text, `${capitalize(word)} `, `${upperFirst(replacement)} `);
    }
    // OCR: grossgeschriebene Wörter werden oft falsch erkannt, darum ohne capitalize() und
    // zusätzlich in der Originalschreibweise – aber nur am Wortanfang (Korrektur 1)
    text = replaceAtWordStart(text, `${word} `, `${replacement} `);
    return replaceAtWordStart(text, `${capitalize(word)} `, `${upperFirst(replacement)} `);
}

function pastTensePattern(verb) {
    const und = `${START}und${END}${IDIOM_EXCEPTIONS}`;
    const oder = `${START}oder${END}`;
    const stop = `(\\.|,|!|\\?|:|${und}|${oder})`;
    const stopOrEnd = `(\\.|,|!|\\?|:|${und}|${oder}|$)`;
    return new RegExp(`${START}${verb}${END}(.*?)${stop}(.*?|$)${stopOrEnd}(.*?|$)${stopOrEnd}`, 'gmsu');
}

/**
 * Präteritum → Konjunktiv mit Hilfsverb am Ende des Satzteils:
 * "Ich ging nach Hause." → "Ich sei nach Hause gegangen."
 * Ein Satzteil endet bei . , ! ? : sowie "und"/"oder"; Punkte nach Abkürzungen (Fr., ca.),
 * Beträgen und Daten zählen nicht als Satzende.
 */
export function ersetzeVergangenheitsform(text, verb, replacement, auxiliary) {
    // Wie in Python: gesucht wird im Text vor den Ersetzungen, ersetzt im laufenden Text
    const matches = [...text.matchAll(pastTensePattern(verb))];
    for (const match of matches) {
        const [g0, g1, g2, g3, g4, g5] = match.slice(1).map(g => g ?? '');
        const v = replacement;
        const h = auxiliary;
        let result;
        if (g1 === '.' && ABBREVIATIONS.some(abbr => g0.endsWith(abbr))) {
            // Der Punkt gehört zu einer Abkürzung
            if (g3 === '.' && endsWithDigit(g2)) {
                // danach ein Betrag ("Fr. 200.")
                result = CONJUNCTIONS.includes(g5)
                    ? `${v}${g0}${g1}${g2}${g3}${g4}${h} ${g5}`
                    : `${v}${g0}${g1}${g2}${g3}${g4} ${h}${g5}`;
            } else if (CONJUNCTIONS.includes(g3)) {
                result = `${v}${g0}${g1}${g2}${h} ${g3}${g4}${g5}`;
            } else {
                result = `${v}${g0}${g1}${g2} ${h}${g3}${g4}${g5}`;
            }
        } else if (g1 === '.' && endsWithDigit(g0)) {
            // Betrag oder Datum ohne vorangehende Abkürzung
            if (CONJUNCTIONS.includes(g3)) {
                result = `${v}${g0}${g1}${g2}${h} ${g3}${g4}${g5}`;
            } else if (g3 === '.' && endsWithDigit(g2)) {
                result = `${v}${g0}${g1}${g2}${g3}${g4} ${h}${g5}`;
            } else {
                result = `${v}${g0}${g1}${g2} ${h}${g3}${g4}${g5}`;
            }
        } else if (CONJUNCTIONS.includes(g1)) {
            // Das Leerzeichen vor "und"/"oder" steht schon in g0 (Korrektur 3)
            result = `${v}${g0}${h} ${g1}${g2}${g3}${g4}${g5}`;
        } else {
            result = `${v}${g0} ${h}${g1}${g2}${g3}${g4}${g5}`;
        }
        text = replaceAll(text, match[0], result);
    }
    return text;
}

/**
 * Die einzelnen Schritte der Bereinigung, in der Reihenfolge, in der sie laufen. Man kann sie an-
 * und abwählen, aber nicht umstellen: Mit allen Schritten ergibt sich genau das Ergebnis des
 * Originals («Text aus PDF einfügen»).
 */
export const SCHRITTE = Object.freeze([
    { id: 'umbrueche', gruppe: 'zeilen', label: 'Zeilenumbrüche entfernen', beispiel: 'Zeile↵Zeile → Zeile Zeile' },
    { id: 'trennung', gruppe: 'zeilen', label: 'Worttrennungen auflösen', beispiel: '«Jung- geselle» → «Junggeselle»', hinweis: 'Ausschalten, wenn der Text Ergänzungsstriche enthält («Kantons- und Bundesrecht»)' },
    { id: 'leerzeichen', gruppe: 'zeilen', label: 'Mehrfache Leerzeichen kürzen', beispiel: '«a␣␣b» → «a␣b»' },
    { id: 'anfuehrungszeichen', gruppe: 'zeichen', label: 'Anführungszeichen vereinheitlichen', beispiel: '«» → "' },
    { id: 'franken', gruppe: 'zeichen', label: 'Frankenbeträge vereinheitlichen', beispiel: '«CHF 50.00» → «Fr. 50.--»' },
    { id: 'ocr', gruppe: 'ocr', label: 'typische fehlerhafte OCR-Erkennungen korrigieren', beispiel: '«lch» → «Ich», «,,» → ", «o/o» → %, «enruähnt» → «erwähnt»' },
]);

/** Zusammengehörige Schritte für die Anzeige, in der Reihenfolge des Ablaufs. */
export const SCHRITT_GRUPPEN = Object.freeze([
    { id: 'zeilen', label: 'Zeilen und Wörter' },
    { id: 'zeichen', label: 'Zeichen und Beträge' },
    { id: 'ocr', label: 'Fehler der Texterkennung' },
]);

/** Alle Schritte eingeschaltet (Standard). */
export const ALLE_SCHRITTE = Object.freeze(Object.fromEntries(SCHRITTE.map(s => [s.id, true])));

// Ersetzt Eintrag für Eintrag; mit `log` werden die Einträge festgehalten, die etwas verändert haben
function proEintrag(text, eintraege, ersetze, log) {
    for (const eintrag of eintraege) {
        const next = ersetze(text, eintrag);
        if (log && next !== text) log.push(eintrag);
        text = next;
    }
    return text;
}

/**
 * Der ganze Ablauf als Folge von Stufen, in der Reihenfolge des Originals. `herkunft` ist die
 * Regel, der eine Wortänderung dieser Stufe zugeschrieben wird (siehe herkunft.js).
 */
function ablauf(schritte, listen) {
    const stufen = [
        // Windows-Zeilenenden vereinheitlichen (Textfelder liefern ohnehin \n)
        { id: 'zeilenenden', run: text => text.replace(/\r\n?/g, '\n') },
    ];
    if (schritte.umbrueche) {
        stufen.push({
            id: 'umbrueche',
            // Wörter verändert hier nur das Zusammenfügen getrennter Wörter am Zeilenende
            herkunft: 'trennung',
            run: text => {
                // Leerzeichen am Zeilenende löschen
                text = text.replace(/\s+$/gmu, '');
                if (schritte.trennung) {
                    // Am Zeilenende (ausser nach Trennstrich) ein Leerzeichen setzen und den
                    // Trennstrich löschen. Als Trennstrich gilt nur ein Bindestrich direkt nach einem
                    // Buchstaben ("Fahr-"), nicht der Schluss eines Seitenmarkers "--- Seite 2 ---"
                    // (Korrektur 4)
                    text = text.replace(/([^-]|[^\p{L}]-)$/gmu, '$1 ');
                    text = text.replace(/(\p{L})-$/gmu, '$1');
                } else {
                    // Bindestrich bleibt stehen («Kantons- und Bundesrecht»)
                    text = text.replace(/(.)$/gmu, '$1 ');
                }
                return replaceAll(replaceAll(text, '\n', ''), '\r', '');
            },
        });
    }
    if (schritte.leerzeichen) {
        // doppelte und dreifache Leerzeichen
        stufen.push({ id: 'leerzeichen', run: text => replaceAll(replaceAll(text, '  ', ' '), '   ', ' ') });
    }
    if (schritte.anfuehrungszeichen) {
        stufen.push({ id: 'anfuehrungszeichen', run: text => replaceAll(replaceAll(text, '«', '"'), '»', '"') });
    }
    if (schritte.franken) {
        stufen.push({
            id: 'franken',
            run: text => replaceAll(replaceAll(replaceAll(text, ' CHF ', ' Fr. '), ' SFR ', ' Fr. '), '.00 ', '.-- '),
        });
    }
    // Platzhalter für unbekannte Zeichen (immer)
    stufen.push({ id: 'steuerzeichen', run: text => replaceAll(text, '\u0000', '') });
    if (schritte.trennung) {
        // getrennte Wörter: "Jung- geselle" → "Junggeselle"; nur zwischen Buchstaben, damit ein
        // Zahlenbereich "5- 10" nicht zu "510" wird (Korrektur 5)
        stufen.push({ id: 'trennung', run: text => text.replace(/(\p{L})-\s(\p{L})/gu, '$1$2') });
    }
    if (schritte.ocr) {
        // Zuerst Zeichenfolgen, dann die Wortliste ("lch" → "Ich"), wie im Original; zwei Stufen,
        // damit die Herkunft eines Worts auch den Eintrag der Wortliste nennen kann
        stufen.push(
            {
                id: 'ocrZeichen',
                herkunft: 'ocr',
                run: text => [[',,', '"'], ['o/o', '%'], ['nrv', 'rw'], ['nry', 'rw']].reduce((t, [a, b]) => replaceAll(t, a, b), text),
            },
            {
                id: 'ocrWoerter',
                herkunft: 'ocr',
                run: (text, log) => proEintrag(text, lists.ocr, (t, [w, r]) => ersetzeWort(t, w, r, { ocr: true }), log),
            },
        );
    }
    if (listen) {
        const wort = (t, [w, r]) => ersetzeWort(t, w, r);
        stufen.push(
            { id: 'pronomen', run: (text, log) => proEintrag(text, listen.pronomen, wort, log) },
            {
                id: 'praeteritum',
                run: (text, log) => proEintrag(text, listen.praeteritum, (t, [v, r, h]) => ersetzeVergangenheitsform(t, escapeRegExp(v), r, h), log),
            },
            { id: 'praesens', run: (text, log) => proEintrag(text, listen.praesens, wort, log) },
            { id: 'zusammenfuegung', run: (text, log) => proEintrag(text, listen.zusammenfuegung, wort, log) },
        );
    }
    return stufen;
}

const BEREINIGUNG = new Set(['zeilenenden', 'umbrueche', 'leerzeichen', 'anfuehrungszeichen', 'franken', 'steuerzeichen', 'trennung']);

/** Zeilenumbrüche, Worttrennungen und typische Formatierungen aus kopiertem PDF-Text bereinigen. */
export function zeilenumbruecheEntfernen(text, schritte = ALLE_SCHRITTE) {
    return ablauf(schritte, null).filter(s => BEREINIGUNG.has(s.id)).reduce((t, s) => s.run(t), text);
}

/** Die eingebauten Wortlisten einer Konvertierung (indirekte Rede, Mann oder Frau). */
export function eingebauteListen(geschlecht = 'm') {
    return {
        pronomen: geschlecht === 'm' ? lists.pronomenMann : lists.pronomenFrau,
        praesens: lists.praesens,
        praeteritum: lists.praeteritum,
        zusammenfuegung: lists.zusammenfuegung,
    };
}

/**
 * Bereinigung (gewählte Schritte) und, falls `listen` angegeben, Konvertierung: Pronomen, dann
 * Verben im Präteritum und Präsens, dann Zusammenschreibung – wie im Original.
 */
export function verarbeite(text, { schritte = ALLE_SCHRITTE, listen = null } = {}) {
    return ablauf(schritte, listen).reduce((t, s) => s.run(t), text);
}

/**
 * Wie verarbeite(), aber mit dem Text nach jeder Stufe und den Wortlisten-Einträgen, die dort
 * etwas verändert haben. Grundlage für die Anzeige, welche Regel ein Wort verändert hat.
 * @returns {Array<{id: string, herkunft: string, text: string, angewendet: Array}>} erste Stufe: Eingabe
 */
export function zwischenstaende(text, { schritte = ALLE_SCHRITTE, listen = null } = {}) {
    const result = [{ id: 'eingabe', herkunft: 'eingabe', text, angewendet: [] }];
    for (const stufe of ablauf(schritte, listen)) {
        const angewendet = [];
        text = stufe.run(text, angewendet);
        result.push({ id: stufe.id, herkunft: stufe.herkunft ?? stufe.id, text, angewendet });
    }
    return result;
}

/** «Text aus PDF einfügen»: Zeilen zusammenfügen und OCR-Fehler korrigieren. */
export function vonPdfEinfuegen(text) {
    return verarbeite(text);
}

/** «Als Aussage einfügen»: zusätzlich dritte Person und Konjunktiv (indirekte Rede). */
export function alsAussageFormatieren(text, geschlecht = 'm') {
    return verarbeite(text, { listen: eingebauteListen(geschlecht) });
}

/**
 * Wendet Bereinigung und Konvertierung Absatz für Absatz an. Das Original verbindet alle Zeilen
 * zu einem einzigen Absatz; bei längeren Texten aus Stufe 1 bleiben so die Absätze erhalten.
 */
export function processText(text, options = {}, { keepParagraphs = true } = {}) {
    return absaetze(text, keepParagraphs).map(paragraph => verarbeite(paragraph, options).trim()).join('\n\n');
}

/** Die Absätze, die processText einzeln verarbeitet. */
export function absaetze(text, keepParagraphs = true) {
    if (!keepParagraphs) return [text];
    return text
        .replace(/\r\n?/g, '\n')
        .split(/\n[ \t]*\n/)
        .map(paragraph => paragraph.trim())
        .filter(Boolean);
}
