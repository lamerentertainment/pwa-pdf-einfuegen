// Reads the file location in the case files ("Aktenpaginierung") from a PDF's file name, so page
// markers can name the actual file page instead of "Seite 1". The number counts up per PDF page.
//
// Conventions (case-insensitive; text after the pagination is ignored, e.g. "… Einvernahme.pdf"):
// - "pag_" + levels joined by "_" (register, sub-register, …), the last level being the Beleg
//   (= page) or a range of Belege:
//     pag_10_1_1-3.pdf  → pag. 10.1.1, pag. 10.1.2, pag. 10.1.3
//     pag_10_1_7.pdf    → pag. 10.1.7, 10.1.8, …
// - "R<register>B<beleg> (Beleg = page)", followed by "ff" (open end) or a range (hand-scanned files):
//     R2B200ff.pdf      → Reg. 2 Bel. 200, Reg. 2 Bel. 201, …
//     R2B200-299.pdf    → Reg. 2 Bel. 200 … Reg. 2 Bel. 299
// - "R<register>" alone: a whole register (R4.pdf), counted from Bel. 1 unless the user says otherwise

// Each entry: regex on the file name without ".pdf" → { name(n), first, last }. The lookaheads
// require a clean end (end, space, "(", ".", or "_" + text) so a malformed name does not match
// partially, e.g. "pag_10_1_1-3x" or "R2B200-299x".
const CONVENTIONS = [
    {
        re: /^pag[_.\s-]?(\d+(?:_\d+)*)(?:-(\d+))?(?=$|[\s(.]|_\D)/i,
        parse(match) {
            const levels = match[1].split('_');
            const first = Number(levels.pop());
            const prefix = levels.map(l => `${l}.`).join('');
            return { name: n => `pag. ${prefix}${n}`, first, last: toNumber(match[2]), openEnd: false, scope: null };
        },
    },
    {
        // Spaces, "_" or "-" between the parts are tolerated ("R4 B200 ff", "R4_B200-299")
        re: /^R\s*(\d+)(?:[\s_-]*B\s*(\d+)(?:\s*(ff)|\s*-\s*(\d+))?)?(?=$|[\s(.]|[_-]\D)/i,
        parse(match) {
            const register = Number(match[1]);
            // "R4.pdf": a whole register, starting Beleg unknown
            const wholeRegister = match[2] === undefined;
            return {
                name: n => `Reg. ${register} Bel. ${n}`,
                first: wholeRegister ? 1 : Number(match[2]),
                last: toNumber(match[4]),
                openEnd: wholeRegister || match[3] !== undefined,
                scope: wholeRegister ? `Reg. ${register}` : null,
            };
        },
    },
];

function toNumber(value) {
    return value !== undefined ? Number(value) : null;
}

/**
 * @param {string} fileName
 * @returns {{name: (n: number) => string, first: number, last: number|null, openEnd: boolean,
 *   scope: string|null}|null}
 *   null if the name follows no convention; `last` is null for an open end ("ff" or a whole
 *   register, then `openEnd`) or a single page; `scope` names a whole register ("Reg. 4")
 */
export function parseActPagination(fileName) {
    const base = fileName.replace(/^.*[\\/]/, '').replace(/\.pdf$/i, '');
    for (const { re, parse } of CONVENTIONS) {
        const match = re.exec(base);
        if (!match) continue;
        const pagination = parse(match);
        return pagination.last !== null && pagination.last < pagination.first ? null : pagination;
    }
    return null;
}

// Pages dragged out of PDF-XChange's page thumbnails arrive as a new file named after the
// original: "Seite 5 von R2.pdf", "Seiten 4 bis 5 von R2B200ff.pdf" (English UI: "Pages 4 to 5 of …")
const EXCERPT_RE = /^(?:Seiten?|Pages?)\s+(\d+)(?:\s*(?:bis|to|-)\s*(\d+))?\s+(?:von|of)\s+(.+)$/i;

/**
 * Reads an excerpt's file name: which pages of which original file it holds.
 * @param {string} fileName
 * @returns {{from: number, to: number, source: string}|null}
 */
export function parseExcerpt(fileName) {
    const base = fileName.replace(/^.*[\\/]/, '').replace(/\.pdf$/i, '');
    const match = EXCERPT_RE.exec(base);
    if (!match) return null;
    const from = Number(match[1]);
    const to = match[2] !== undefined ? Number(match[2]) : from;
    if (from < 1 || to < from) return null;
    return { from, to, source: match[3].trim() };
}

/**
 * Decides where the page markers start and whether the user has to be asked.
 * @param {string} fileName
 * @param {number} pageCount pages in the PDF
 * @returns {null | {pagination: object, start: number, excerpt: object|null,
 *   ask: null|'mismatch'|'open'|'register'|'excerpt'|'excerptRegister'}}
 *   null if no convention is found. `start` is the first Beleg (the suggestion when asking).
 *   - whole file: asks if its page count differs from the range ('mismatch'), or the name has
 *     an open end ('open', "ff") or is a whole register ('register')
 *   - excerpt ("Seiten 4 bis 5 von R2B200ff.pdf"): the start follows from the original's first
 *     Beleg, so no question, unless the original is a whole register ('excerptRegister': its
 *     first Beleg is unknown) or the pages do not fit ('excerpt')
 */
export function planPagination(fileName, pageCount) {
    const excerpt = parseExcerpt(fileName);
    const pagination = parseActPagination(excerpt ? excerpt.source : fileName);
    if (!pagination) return null;

    if (excerpt) {
        const start = pagination.first + excerpt.from - 1;
        const fits = excerpt.to - excerpt.from + 1 === pageCount
            && (pagination.last === null || start + pageCount - 1 <= pagination.last);
        const ask = !fits ? 'excerpt' : pagination.scope ? 'excerptRegister' : null;
        return { pagination, start, excerpt, ask };
    }

    const announced = announcedPageCount(pagination);
    const ask = announced !== null && announced !== pageCount ? 'mismatch'
        : pagination.scope ? 'register'
        : pagination.openEnd ? 'open'
        : null;
    return { pagination, start: pagination.first, excerpt: null, ask };
}

/**
 * Page names for the markers, e.g. ["pag. 10.1.2", "pag. 10.1.3"].
 * @param {{name: (n: number) => string, first: number}} pagination from parseActPagination
 * @param {number} pageCount pages in the PDF
 * @param {number} [start] first Beleg, if not the one in the file name
 */
export function actPageNames({ name, first }, pageCount, start = first) {
    return Array.from({ length: pageCount }, (_, i) => name(start + i));
}

/** Pages the file name announces, or null without a range (nothing to check against). */
export function announcedPageCount({ first, last }) {
    return last === null ? null : last - first + 1;
}
