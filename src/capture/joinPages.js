/**
 * Seitentext ohne Leerraum am Ende und ohne leere Zeilen am Anfang. Die Einrückung der ersten
 * Zeile bleibt stehen (Einrückungen erhalten).
 */
export const trimPage = text => text.replace(/^\s*\n/, '').trimEnd();

/** Gesamttext aus den (eventuell bearbeiteten) Seitentexten. */
export function joinPages(pages, { pageMarkers = false } = {}) {
    if (pageMarkers) return pages.map(p => `--- Seite ${p.number} ---\n\n${trimPage(p.text)}`.trimEnd()).join('\n\n');
    return pages.map(p => trimPage(p.text)).filter(Boolean).join('\n\n');
}
