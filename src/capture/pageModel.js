// Reine Hilfsfunktionen der Erfassung, ohne pdf.js – damit sie ohne Browser getestet werden können.
//
// Koordinaten der Boxen: Seite bei Massstab 1 (PDF-Punkte), Ursprung oben links, Drehung der
// Seite schon angewendet – so können sie direkt über die gerenderte Seite gelegt werden.
import { reconstructDocumentText, reconstructPartText } from './pdfLayout.js';
import { layoutPageText } from './layoutRegions.js';
import { trimPage } from './joinPages.js';
import { UNCERTAIN_SCORE } from './options.js';

// Seitentrenner, die nur intern zum Aufteilen des Gesamttexts dienen
const SPLIT_LABEL = 'PWA_PDF_SEITE';
const SPLIT_RE = new RegExp(`^--- ${SPLIT_LABEL} (\\d+) ---$`, 'm');

/** Box einer OCR-Zeile (Bildpixel bei `scale` Pixel pro Punkt). */
export function ocrLineBox(line, scale) {
    return {
        x: line.x / scale, y: line.y / scale, w: line.w / scale, h: line.h / scale,
        text: line.text, score: line.score,
    };
}

/** Box eines pdf.js-Textelements; `viewport` ist der Viewport bei Massstab 1. */
export function textItemBox(item, viewport) {
    const [, , c, d, x, y] = item.transform;
    const height = Math.abs(item.height) || Math.hypot(c, d) || 10;
    // pdf.js 6 kennt nur noch convertToViewportPoint: die zwei Ecken einzeln umrechnen
    const [x1, y1] = viewport.convertToViewportPoint(x, y);
    const [x2, y2] = viewport.convertToViewportPoint(x + item.width, y + height);
    return {
        x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1),
        text: item.str,
    };
}

/** Layoutbereich (Bildpixel) → Box in Punkten. */
export function regionBox(region, scale) {
    return { label: region.label, score: region.score, x: region.x / scale, y: region.y / scale, w: region.w / scale, h: region.h / scale };
}

/**
 * Teilt den Gesamttext mit internen Seitentrennern in Seitentexte auf.
 * @returns {string[]|null} null, wenn die Trenner nicht zur Seitenzahl passen
 */
export function splitPages(text, count) {
    const parts = text.split(SPLIT_RE);
    // split mit Gruppe: [vor dem ersten Trenner, '1', Text 1, '2', Text 2, ...]
    if (parts.length !== 1 + 2 * count) return null;
    const pages = [];
    for (let i = 0; i < count; i++) {
        if (Number(parts[1 + 2 * i]) !== i + 1) return null;
        pages.push(trimPage(parts[2 + 2 * i]));
    }
    return pages;
}

export function layoutOptionsOf(options) {
    return {
        keepLineNumbers: options.keepLineNumbers,
        uncertainBelow: options.markUncertain ? UNCERTAIN_SCORE : undefined,
        structure: options.structure,
        tables: options.tables,
        lists: Boolean(options.lists),
        // Nur Seiten mit Layoutmodell (typeOutput)
        headings: Boolean(options.headings),
        footnotes: ['dokument', 'markdown'].includes(options.footnotes) ? options.footnotes : 'seite',
        placeholders: Boolean(options.placeholders),
    };
}

/** Ein Bereich als eine Zeile (Titel, Stempeltext). */
const oneLine = text => text.replace(/\s*\n\s*/g, ' ').trim();

const PLACEHOLDER = { image: 'Abbildung', chart: 'Diagramm', seal: 'Stempel' };
const FIGURES = new Set(['image', 'chart']);

/**
 * Ausgabe eines Bereichs nach seinem Typ (Etappe 2):
 * - Dokumenttitel und Abschnittstitel als Markdown-Überschrift (# / ##), wenn «headings»
 * - Bilder und Diagramme als [Abbildung: Bildunterschrift] / [Diagramm], Stempel als
 *   [Stempel: Text], wenn «placeholders» (die Texterkennung liest in Bildern meist nur Zeichensalat)
 * - Fussnoten fehlen an ihrer Stelle, wenn sie ans Dokumentende kommen oder Markdown-Fussnoten
 *   werden (footnotes: 'dokument' / 'markdown')
 * @param {string} label Bereichstyp
 * @param {string} text Text des Bereichs (regionText)
 * @param {string} [caption] Bildunterschrift eines Bildes oder Diagramms (figureCaptions)
 */
export function typeOutput(label, text, layoutOptions, caption = '') {
    if (layoutOptions.headings && text.trim()) {
        if (label === 'doc_title') return `# ${oneLine(text)}`;
        if (label === 'paragraph_title') return `## ${oneLine(text)}`;
    }
    if (layoutOptions.placeholders && PLACEHOLDER[label]) {
        const inner = label === 'seal' ? oneLine(text) : oneLine(caption);
        return `[${PLACEHOLDER[label]}${inner ? `: ${inner}` : ''}]`;
    }
    if (label === 'footnote' && layoutOptions.footnotes !== 'seite') return '';
    return text;
}

export const FOOTNOTE_MARKER = '--- Fussnoten ---';

const overlap = (a1, a2, b1, b2) => Math.min(a2, b2) - Math.max(a1, b1);

/**
 * Ordnet Bildunterschriften (figure_title) ihrem Bild oder Diagramm zu: direkt darunter oder
 * darüber, waagrecht überlappend, höchstens 40 pt entfernt; jede Unterschrift nur einem Bild.
 * @returns {Map<string, string>} Bild-ID → ID der Bildunterschrift
 */
export function figureCaptions(regions, maxGap = 40) {
    const figures = regions.filter(r => r.enabled && FIGURES.has(r.label));
    const captions = regions.filter(r => r.enabled && r.label === 'figure_title');
    const pairs = [];
    for (const f of figures) {
        for (const c of captions) {
            if (overlap(f.x, f.x + f.w, c.x, c.x + c.w) <= 0) continue;
            const gap = -overlap(f.y, f.y + f.h, c.y, c.y + c.h); // < 0: überlappen sich
            if (gap <= maxGap) pairs.push({ f: f.id, c: c.id, gap: Math.max(gap, 0) });
        }
    }
    pairs.sort((a, b) => a.gap - b.gap);
    const result = new Map();
    const used = new Set();
    for (const { f, c } of pairs) {
        if (result.has(f) || used.has(c)) continue;
        result.set(f, c);
        used.add(c);
    }
    return result;
}

const SUPERSCRIPT = '⁰¹²³⁴⁵⁶⁷⁸⁹';
const toSuperscript = n => [...n].map(d => SUPERSCRIPT[d]).join('');
const fromSuperscript = s => [...s].map(ch => (SUPERSCRIPT.includes(ch) ? SUPERSCRIPT.indexOf(ch) : ch)).join('');

/**
 * Zerlegt den Text eines Fussnotenbereichs in einzelne Fussnoten («1 Siehe Akten.», «² BGE …»).
 * Text ohne führende Nummer gehört zur vorherigen Fussnote oder wird eine ohne Nummer.
 * @returns {Array<{number: string|null, text: string}>}
 */
export function splitFootnotes(text) {
    const notes = [];
    for (const line of text.split('\n').map(l => l.trim()).filter(Boolean)) {
        const m = line.match(/^(\d{1,3}|[⁰¹²³⁴⁵⁶⁷⁸⁹]{1,3})[.)]?\s+(\S.*)$/u);
        if (m) notes.push({ number: fromSuperscript(m[1]), text: m[2] });
        else if (notes.length) notes[notes.length - 1].text += ` ${line}`;
        else notes.push({ number: null, text: line });
    }
    return notes;
}

/**
 * Ersetzt das erste Fussnotenzeichen «n» im Text durch [^label]: hochgestellt (¹) nach einem
 * Zeichen, oder als Ziffer direkt nach einem Wort bzw. nach Wort und Satzzeichen («Akten.1»).
 * Ziffern nach Ziffern («3.1», «12.03.2024») und abgesetzte Zahlen («Art. 1») bleiben.
 * @returns {string|null} null, wenn kein Zeichen gefunden wurde
 */
export function markFootnoteReference(text, number, label) {
    const sup = toSuperscript(number);
    const re = new RegExp(`(?<=\\S)${sup}(?![⁰¹²³⁴⁵⁶⁷⁸⁹])|(?<=\\p{L}[.,;:!?)»"’]?)${number}(?!\\p{N})`, 'u');
    if (!re.test(text)) return null;
    return text.replace(re, `[^${label}]`);
}

/**
 * Tabellen auf Seiten mit Layoutmodell: nur in den Bereichen, die das Modell als Tabelle erkannt
 * hat, dort aber schon ab 2 Spalten. Anderswo wird nichts zur Tabelle.
 */
function regionOptions(page, regionIds, layoutOptions) {
    const isTable = page.layout?.regions.some(r => regionIds.includes(r.id) && r.label === 'table');
    return { ...layoutOptions, tables: Boolean(layoutOptions.tables && isTable), tableRegion: Boolean(isTable) };
}

/**
 * Text eines oder mehrerer Layoutbereiche: nur ihre Zeilen, aber an der ganzen Seite gemessen.
 * Zeilennummern am Rand werden auf der ganzen Seite erkannt (sie liegen meist in keinem Bereich),
 * Einrückungen zählen ab dem Rand der Seitenspalte, die die eingeschalteten Bereiche bilden.
 */
export function regionText(page, regionId, layoutOptions) {
    const ids = Array.isArray(regionId) ? regionId : [regionId];
    const enabled = new Set((page.layout?.regions ?? []).filter(r => r.enabled).map(r => r.id));
    return reconstructPartText(page.items, item => ids.includes(item.region), regionOptions(page, ids, layoutOptions),
        item => enabled.has(item.region));
}

/**
 * Text der Seiten in Lesereihenfolge, mit Kopf-/Fusszeilen-Erkennung über das ganze Dokument.
 * Seiten mit Layoutbereichen werden aus ihren eingeschalteten Bereichen aufgebaut (Reihenfolge
 * und Verbindungen siehe layoutRegions.js); sie nehmen an der Kopfzeilen-Erkennung nicht teil,
 * dafür sind die Bereiche des Layoutmodells da.
 * @param {Array<{layout: {groups: Array}}>} [groups] verbundene Bereiche
 */
export function buildPageTexts(pages, options, groups = []) {
    const layoutOptions = layoutOptionsOf(options);
    // Gezeichnete Aufzählungszeichen (bullets.js) vorerst nur auf Seiten mit eingebettetem Text
    const input = pages.map(p => ({ items: p.layout ? [] : p.items, view: p.view, bullets: p.source === 'text' ? p.bullets : undefined }));
    const text = reconstructDocumentText(input, { ...layoutOptions, pageMarkers: true, pageLabel: SPLIT_LABEL });
    const base = splitPages(text, pages.length)
        // Rückfall, falls ein Dokument selbst eine solche Zeile enthält: Seite für Seite
        ?? input.map(page => reconstructDocumentText([page], layoutOptions));
    if (!pages.some(p => p.layout)) return base;
    const byNumber = new Map(pages.map(p => [p.number, p]));
    const labelOf = (n, id) => byNumber.get(n).layout.regions.find(r => r.id === id)?.label;
    // Bildunterschriften gehören in den Platzhalter ihres Bildes und fallen an ihrer Stelle weg
    const captionOf = new Map();
    const captionIds = new Set();
    if (layoutOptions.placeholders) {
        for (const p of pages.filter(p => p.layout)) {
            for (const [figure, caption] of figureCaptions(p.layout.regions)) {
                captionOf.set(`${p.number}:${figure}`, caption);
                captionIds.add(`${p.number}:${caption}`);
            }
        }
    }
    const textOf = (n, id) => {
        if (captionIds.has(`${n}:${id}`)) return '';
        const caption = captionOf.get(`${n}:${id}`);
        const captionText = caption ? regionText(byNumber.get(n), caption, layoutOptions) : '';
        return typeOutput(labelOf(n, id), regionText(byNumber.get(n), id, layoutOptions), layoutOptions, captionText);
    };
    const combinedOf = (n, ids) => regionText(byNumber.get(n), ids, layoutOptions);
    const texts = base.map((t, i) => (pages[i].layout ? layoutPageText(pages[i].number, n => byNumber.get(n), groups, textOf, combinedOf) : t));

    // Fussnoten aller Seiten, in Lesereihenfolge
    const footnotesOf = p => (p.layout?.order ?? [])
        .map(id => p.layout.regions.find(r => r.id === id))
        .filter(r => r?.enabled && r.label === 'footnote')
        .map(r => regionText(p, r.id, layoutOptions).trim())
        .filter(Boolean);
    if (layoutOptions.footnotes === 'dokument') {
        // gesammelt ans Ende der letzten Seite
        const notes = pages.flatMap(footnotesOf);
        if (notes.length) {
            const last = texts.length - 1;
            texts[last] = [trimPage(texts[last]), FOOTNOTE_MARKER, ...notes].filter(Boolean).join('\n\n');
        }
    } else if (layoutOptions.footnotes === 'markdown') {
        // Markdown-Fussnoten: [^1] an der Fundstelle, die Definitionen am Dokumentende
        const definitions = [];
        const labels = new Set();
        pages.forEach((p, i) => {
            splitFootnotes(footnotesOf(p).join('\n')).forEach((note, k) => {
                let label = note.number ?? `${p.number}-${k + 1}`;
                if (labels.has(label)) label = `${p.number}-${label}`;
                labels.add(label);
                if (note.number) {
                    // zuerst auf der eigenen Seite suchen, dann auf den übrigen (verbundene Absätze)
                    for (const j of [i, ...texts.keys()].filter((j, n, all) => all.indexOf(j) === n)) {
                        const marked = markFootnoteReference(texts[j], note.number, label);
                        if (marked !== null) { texts[j] = marked; break; }
                    }
                }
                definitions.push(`[^${label}]: ${note.text}`);
            });
        });
        if (definitions.length) {
            const last = texts.length - 1;
            texts[last] = [trimPage(texts[last]), ...definitions].filter(Boolean).join('\n\n');
        }
    }
    return texts;
}
