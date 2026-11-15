// Stufe 2: regelbasierte Weiterverarbeitung, übernommen aus pdf-einfuegen
// (courtapi/converters.py, Wortlisten aus courtapi/dict_db.py → wordlists.json).
//
// Die Umsetzung folgt dem Python-Original Schritt für Schritt; tests/rules.test.js prüft sie
// Zeichen für Zeichen gegen dessen Ergebnisse (tests/fixtures/pdf-einfuegen-golden.json).
// Zwei Fehler des Originals sind behoben (siehe scripts/pdf-einfuegen/generate_golden.py):
//   1. OCR-Ersetzungen nur am Wortanfang ("handeln" wurde zu "handeIn", "Milch" zu "MiIch")
//   2. kein Absturz, wenn ein Satzzeichen direkt auf ein Verb im Präteritum folgt ("Ich ging.")
//
// Python-Eigenheiten, die hier nachgebildet sind:
//   - \b und \w sind in Python Unicode-fähig (Umlaute zählen als Buchstaben), in JavaScript
//     nicht: dafür stehen WORD, START und END.
//   - str.replace ersetzt alle Vorkommen ohne Sonderzeichen: replaceAll() mit split/join.
//   - str.capitalize() setzt den Rest des Worts in Kleinbuchstaben: capitalize().
import lists from './wordlists.json';

const WORD = '[\\p{L}\\p{N}_]';
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
        return replaceAll(text, `${capitalize(word)} `, `${capitalize(replacement)} `);
    }
    // OCR: grossgeschriebene Wörter werden oft falsch erkannt, darum ohne capitalize() und
    // zusätzlich in der Originalschreibweise – aber nur am Wortanfang (Korrektur 1)
    text = replaceAtWordStart(text, `${word} `, `${replacement} `);
    return replaceAtWordStart(text, `${capitalize(word)} `, `${capitalize(replacement)} `);
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
            result = `${v}${g0} ${h}${g1}${g2}${g3}${g4}${g5}`;
        } else {
            result = `${v}${g0} ${h}${g1}${g2}${g3}${g4}${g5}`;
        }
        text = replaceAll(text, match[0], result);
    }
    return text;
}

/** Zeilenumbrüche, Worttrennungen und typische Formatierungen aus kopiertem PDF-Text bereinigen. */
export function zeilenumbruecheEntfernen(text) {
    // Windows-Zeilenenden vereinheitlichen (Textfelder liefern ohnehin \n)
    text = text.replace(/\r\n?/g, '\n');
    // Leerzeichen am Zeilenende löschen
    text = text.replace(/\s+$/gmu, '');
    // Am Zeilenende (ausser nach Bindestrich) ein Leerzeichen setzen
    text = text.replace(/([^-])$/gmu, '$1 ');
    // Bindestrich am Zeilenende löschen
    text = text.replace(/-$/gmu, '');
    text = replaceAll(text, '\n', '');
    text = replaceAll(text, '\r', '');
    // doppelte und dreifache Leerzeichen
    text = replaceAll(text, '  ', ' ');
    text = replaceAll(text, '   ', ' ');
    // «» → "
    text = replaceAll(text, '«', '"');
    text = replaceAll(text, '»', '"');
    // Frankenformatierung
    text = replaceAll(text, ' CHF ', ' Fr. ');
    text = replaceAll(text, ' SFR ', ' Fr. ');
    text = replaceAll(text, '.00 ', '.-- ');
    // Platzhalter für unbekannte Zeichen
    text = replaceAll(text, '\u0000', '');
    // getrennte Wörter: "Jung- geselle" → "Junggeselle"
    return text.replace(new RegExp(`(${WORD})-\\s(${WORD})`, 'gu'), '$1$2');
}

/** Typische Fehler der Texterkennung ("lch" statt "Ich", ",," statt Anführungszeichen). */
export function ocrErsetzung(text) {
    text = replaceAll(text, ',,', '"');
    text = replaceAll(text, 'o/o', '%');
    text = replaceAll(text, 'nrv', 'rw');
    text = replaceAll(text, 'nry', 'rw');
    for (const [word, replacement] of lists.ocr) {
        text = ersetzeWort(text, word, replacement, { ocr: true });
    }
    return text;
}

export function pronomenErsetzung(text, geschlecht = 'm') {
    for (const [word, replacement] of geschlecht === 'm' ? lists.pronomenMann : lists.pronomenFrau) {
        text = ersetzeWort(text, word, replacement);
    }
    return text;
}

export function verbenErsetzung(text) {
    for (const [verb, replacement, auxiliary] of lists.praeteritum) {
        text = ersetzeVergangenheitsform(text, verb, replacement, auxiliary);
    }
    for (const [word, replacement] of lists.praesens) {
        text = ersetzeWort(text, word, replacement);
    }
    for (const [word, replacement] of lists.zusammenfuegung) {
        text = ersetzeWort(text, word, replacement);
    }
    return text;
}

/** «Text aus PDF einfügen»: Zeilen zusammenfügen und OCR-Fehler korrigieren. */
export function vonPdfEinfuegen(text) {
    return ocrErsetzung(zeilenumbruecheEntfernen(text));
}

/** «Als Aussage einfügen»: zusätzlich dritte Person und Konjunktiv (indirekte Rede). */
export function alsAussageFormatieren(text, geschlecht = 'm') {
    return verbenErsetzung(pronomenErsetzung(ocrErsetzung(zeilenumbruecheEntfernen(text)), geschlecht));
}

export const MODES = Object.freeze({
    einfuegen: { label: 'Zeilen zusammenfügen', run: vonPdfEinfuegen },
    mann: { label: 'Als Aussage (Mann)', run: text => alsAussageFormatieren(text, 'm') },
    frau: { label: 'Als Aussage (Frau)', run: text => alsAussageFormatieren(text, 'w') },
});

/**
 * Wendet einen Modus Absatz für Absatz an. Das Original verbindet alle Zeilen zu einem
 * einzigen Absatz; bei längeren Texten aus Stufe 1 bleiben so die Absätze erhalten.
 */
export function processText(text, mode, { keepParagraphs = true } = {}) {
    const run = MODES[mode].run;
    if (!keepParagraphs) return run(text).trim();
    return text
        .replace(/\r\n?/g, '\n')
        .split(/\n[ \t]*\n/)
        .map(paragraph => paragraph.trim())
        .filter(Boolean)
        .map(paragraph => run(paragraph).trim())
        .join('\n\n');
}
