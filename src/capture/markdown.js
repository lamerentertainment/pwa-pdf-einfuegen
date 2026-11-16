// Gerenderte Ansicht des erfassten Texts (Überschriften, Listen, Tabellen aus pdfLayout).
// HTML, das im PDF-Text steht, wird nicht ausgeführt, sondern als Text angezeigt, und das
// Ergebnis geht zusätzlich durch DOMPurify, bevor es in die Seite kommt.
import { Marked } from 'marked';
import DOMPurify from 'dompurify';

const escapeHtml = text => text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const marked = new Marked({
    gfm: true,
    // Zeilenumbrüche erhalten: Der erfasste Text trägt seine Struktur in den Zeilen (Formulare,
    // nicht erkannte Tabellen, Listen ohne Aufzählungszeichen); zusammengezogen ginge sie verloren
    breaks: true,
    renderer: {
        // Roh-HTML aus dem Dokument nur als Text zeigen
        html: ({ text }) => escapeHtml(text),
    },
});

/**
 * Bereitet den erfassten Text für Markdown vor: Die Einrückungen aus «Einrückungen erhalten»
 * würden sonst ab vier Leerzeichen als Codeblock gelten. Listenpunkte («- ») behalten ihre
 * Einrückung, sie trägt die Verschachtelung (zwei Leerzeichen pro Ebene, siehe pdfLayout.js).
 */
export function prepareMarkdown(text) {
    return text.split('\n').map(line => (/^ *- \S/.test(line) ? line : line.replace(/^[ \t]+/, ''))).join('\n');
}

/** Markdown → bereinigtes HTML. */
export function renderMarkdown(text) {
    return DOMPurify.sanitize(marked.parse(prepareMarkdown(text)), { USE_PROFILES: { html: true } });
}

/** Ob ein Text eine Markdown-Tabelle enthält (Kopfzeile plus Trennzeile). */
export function hasMarkdownTable(text) {
    return /^\s*\|.*\|\s*\n\s*\|[\s:|-]+\|\s*$/m.test(text);
}
