// Fundstellen im Text erkennen: Bundesgerichtsentscheide (Geschäftsnummer, BGE) und Gesetzesartikel.
// Nachfolger der Makros «BGerAufruf» und «GesetzAufruf» aus den KRG-Makros: Dort musste man die
// Fundstelle markieren, hier wird sie erkannt und als Link angeboten (bger.li bzw. Fedlex-Suche).
// Es wird nichts abgerufen; erst ein Klick auf den Link öffnet die Seite in einem neuen Tab.

// Geschäftsnummern wie 6B_123/2020, 1C 45/2019, 2C.12/2018 oder ältere wie 6S.123/2004, 5P.12/2003
const CASE = /(?<![\w/])(\d{1,2}[A-Z]{1,2})[_.\s -](\d{1,5})\/((?:19|20)\d{2})(?!\d)/g;
// Amtlich publizierte Entscheide: BGE 145 IV 1 (Bände I, Ia, Ib, II, III, IV, V)
const BGE = /\bBGE\s+(\d{2,3})\s+(Ia|Ib|I{1,3}|IV|V)\s+(\d{1,4})\b/g;
// «Art. 47», «Art. 12a», «Art. 3bis», «Artikel 111», französisch «art. 47»
const ARTICLE = /\b(?:Art(?:\.|ikel\b)|art\.)\s*(\d+[a-z]?(?:bis|ter|quater|quinquies|sexies)?)\b/g;
// Abkürzung eines Erlasses: StGB, ZGB, OR, StPO, BetmG, SchKG, EMRK, BV, CP …
const LAW = /(?<![\wÄÖÜäöü])([A-ZÄÖÜ][a-zäöü]*[A-ZÄÖÜ][A-Za-zÄÖÜäöü]*)(?![\wÄÖÜäöü])/g;
// Was zwischen Artikelnummer und Erlass stehen darf, ohne dass die Angabe abbricht
const QUALIFIER = /^(?:[\s ,]|i\.\s?V\.\s?m\.|in Verbindung mit|Abs\.|Ziff\.|lit\.|Bst\.|Satz|al\.|let\.|ch\.|let|Nr\.|ff?\.|und|sowie|bzw\.|oder|\d+[a-z]?(?:bis|ter|quater)?\b|[a-z]\b|[IVX]+\b)*/;
// Abkürzungen, die nach einer Artikelnummer stehen, aber kein Erlass sind
const NOT_A_LAW = new Set(['IV', 'II', 'III', 'VI', 'VII', 'VIII', 'IX', 'XI', 'XII', 'SR', 'AS', 'BBl', 'BGE', 'aF', 'nF']);

export function caseUrl(number) {
    return `https://bger.li/${number}`;
}

export function bgeUrl(volume, part, page) {
    return `https://bger.li/${volume}-${part}-${page}`;
}

export function lawUrl(law, article) {
    const params = new URLSearchParams({ collection: 'classified_compilation', classifiedBy: law, article });
    return `https://www.fedlex.admin.ch/de/search?${params}`;
}

function findLaw(text, from) {
    const rest = text.slice(from, from + 120);
    const lead = rest.match(QUALIFIER)[0];
    LAW.lastIndex = 0;
    const match = LAW.exec(rest.slice(lead.length));
    if (!match || match.index !== 0 || NOT_A_LAW.has(match[1])) return null;
    return match[1];
}

/**
 * Fundstellen im Text, in der Reihenfolge ihres ersten Auftretens und ohne Doppel.
 * @returns {{ kind: 'entscheid'|'bge'|'artikel', label: string, url: string, index: number, count: number }[]}
 */
export function findCitations(text) {
    if (!text) return [];
    const found = [];

    for (const m of text.matchAll(CASE)) {
        const number = `${m[1]}_${m[2]}/${m[3]}`;
        found.push({ kind: 'entscheid', key: number, label: number, url: caseUrl(number), index: m.index });
    }
    for (const m of text.matchAll(BGE)) {
        const label = `BGE ${m[1]} ${m[2]} ${m[3]}`;
        found.push({ kind: 'bge', key: label, label, url: bgeUrl(m[1], m[2], m[3]), index: m.index });
    }

    const articles = [...text.matchAll(ARTICLE)].map(m => ({
        number: m[1],
        index: m.index,
        end: m.index + m[0].length,
        law: findLaw(text, m.index + m[0].length),
    }));
    // Von hinten nach vorne: Artikel ohne eigenen Erlass erben ihn vom unmittelbar folgenden
    for (let i = articles.length - 2; i >= 0; i--) {
        const art = articles[i];
        const next = articles[i + 1];
        // «Art. 47 und Art. 49 StGB», «Art. 12 Abs. 2 i.V.m. Art. 13 StGB»: nur Zusätze dazwischen
        if (!art.law && next.law && !text.slice(art.end, next.index).replace(QUALIFIER, '')) art.law = next.law;
    }
    for (const art of articles) {
        if (!art.law) continue;
        const label = `Art. ${art.number} ${art.law}`;
        found.push({ kind: 'artikel', key: label, label, url: lawUrl(art.law, art.number), index: art.index });
    }

    const unique = new Map();
    for (const item of found.sort((a, b) => a.index - b.index)) {
        const seen = unique.get(item.key);
        if (seen) seen.count++;
        else unique.set(item.key, { kind: item.kind, label: item.label, url: item.url, index: item.index, count: 1 });
    }
    return [...unique.values()];
}
