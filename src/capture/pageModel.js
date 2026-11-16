// Reine Hilfsfunktionen der Erfassung, ohne pdf.js – damit sie ohne Browser getestet werden können.
//
// Koordinaten der Boxen: Seite bei Massstab 1 (PDF-Punkte), Ursprung oben links, Drehung der
// Seite schon angewendet – so können sie direkt über die gerenderte Seite gelegt werden.
import { reconstructDocumentText, reconstructPageText } from './pdfLayout.js';
import { layoutPageText } from './layoutRegions.js';
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
        pages.push(parts[2 + 2 * i].trim());
    }
    return pages;
}

export function layoutOptionsOf(options) {
    return {
        keepLineNumbers: options.keepLineNumbers,
        uncertainBelow: options.markUncertain ? UNCERTAIN_SCORE : undefined,
        structure: options.structure,
        tables: options.tables,
        // Nur Seiten mit Layoutmodell (typeOutput)
        headings: Boolean(options.headings),
        footnotes: options.footnotes === 'dokument' ? 'dokument' : 'seite',
        placeholders: Boolean(options.placeholders),
    };
}

/** Ein Bereich als eine Zeile (Titel, Stempeltext). */
const oneLine = text => text.replace(/\s*\n\s*/g, ' ').trim();

const PLACEHOLDER = { image: 'Abbildung', chart: 'Diagramm', seal: 'Stempel' };

/**
 * Ausgabe eines Bereichs nach seinem Typ (Etappe 2):
 * - Dokumenttitel und Abschnittstitel als Markdown-Überschrift (# / ##), wenn «headings»
 * - Bilder und Diagramme als [Abbildung] / [Diagramm], Stempel als [Stempel: Text], wenn
 *   «placeholders» (die Texterkennung liest in Bildern meist nur Zeichensalat)
 * - Fussnoten fehlen an ihrer Stelle, wenn sie ans Dokumentende kommen (footnotes: 'dokument')
 * @param {string} label Bereichstyp
 * @param {string} text Text des Bereichs (regionText)
 */
export function typeOutput(label, text, layoutOptions) {
    if (layoutOptions.headings && text.trim()) {
        if (label === 'doc_title') return `# ${oneLine(text)}`;
        if (label === 'paragraph_title') return `## ${oneLine(text)}`;
    }
    if (layoutOptions.placeholders && PLACEHOLDER[label]) {
        const inner = label === 'seal' ? oneLine(text) : '';
        return `[${PLACEHOLDER[label]}${inner ? `: ${inner}` : ''}]`;
    }
    if (label === 'footnote' && layoutOptions.footnotes === 'dokument') return '';
    return text;
}

export const FOOTNOTE_MARKER = '--- Fussnoten ---';

/**
 * Tabellen auf Seiten mit Layoutmodell: nur in den Bereichen, die das Modell als Tabelle erkannt
 * hat, dort aber schon ab 2 Spalten. Anderswo wird nichts zur Tabelle.
 */
function regionOptions(page, regionIds, layoutOptions) {
    const isTable = page.layout?.regions.some(r => regionIds.includes(r.id) && r.label === 'table');
    return { ...layoutOptions, tables: Boolean(layoutOptions.tables && isTable), tableRegion: Boolean(isTable) };
}

/** Text eines oder mehrerer Layoutbereiche: nur ihre Zeilen, mit dem üblichen Textaufbau. */
export function regionText(page, regionId, layoutOptions) {
    const ids = Array.isArray(regionId) ? regionId : [regionId];
    return reconstructPageText(page.items.filter(item => ids.includes(item.region)), regionOptions(page, ids, layoutOptions));
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
    const input = pages.map(p => ({ items: p.layout ? [] : p.items, view: p.view }));
    const text = reconstructDocumentText(input, { ...layoutOptions, pageMarkers: true, pageLabel: SPLIT_LABEL });
    const base = splitPages(text, pages.length)
        // Rückfall, falls ein Dokument selbst eine solche Zeile enthält: Seite für Seite
        ?? input.map(page => reconstructDocumentText([page], layoutOptions));
    if (!pages.some(p => p.layout)) return base;
    const byNumber = new Map(pages.map(p => [p.number, p]));
    const labelOf = (n, id) => byNumber.get(n).layout.regions.find(r => r.id === id)?.label;
    const textOf = (n, id) => typeOutput(labelOf(n, id), regionText(byNumber.get(n), id, layoutOptions), layoutOptions);
    const combinedOf = (n, ids) => regionText(byNumber.get(n), ids, layoutOptions);
    const texts = base.map((t, i) => (pages[i].layout ? layoutPageText(pages[i].number, n => byNumber.get(n), groups, textOf, combinedOf) : t));

    // Fussnoten aller Seiten gesammelt ans Ende der letzten Seite, in Lesereihenfolge
    if (layoutOptions.footnotes === 'dokument') {
        const notes = pages.flatMap(p => (p.layout?.order ?? [])
            .map(id => p.layout.regions.find(r => r.id === id))
            .filter(r => r?.enabled && r.label === 'footnote')
            .map(r => regionText(p, r.id, layoutOptions).trim())
            .filter(Boolean));
        if (notes.length) {
            const last = texts.length - 1;
            texts[last] = [texts[last].trim(), FOOTNOTE_MARKER, ...notes].filter(Boolean).join('\n\n');
        }
    }
    return texts;
}
