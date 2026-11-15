/** Gesamttext aus den (eventuell bearbeiteten) Seitentexten. */
export function joinPages(pages, { pageMarkers = false } = {}) {
    if (pageMarkers) return pages.map(p => `--- Seite ${p.number} ---\n\n${p.text.trim()}`.trim()).join('\n\n');
    return pages.map(p => p.text.trim()).filter(Boolean).join('\n\n');
}
