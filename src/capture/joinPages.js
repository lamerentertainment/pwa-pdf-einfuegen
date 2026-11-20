/**
 * Seitentext ohne Leerraum am Ende und ohne leere Zeilen am Anfang. Die Einrückung der ersten
 * Zeile bleibt stehen (Einrückungen erhalten).
 */
export const trimPage = text => text.replace(/^\s*\n/, '').trimEnd();

/**
 * Gesamttext aus den (eventuell bearbeiteten) Seitentexten. `pageName` beschriftet die
 * Seitenmarker anhand der PDF-Seitennummer (z. B. Aktenpaginierung, actPagination.js),
 * sonst «Seite N».
 */
export function joinPages(pages, { pageMarkers = false, pageName = n => `Seite ${n}` } = {}) {
    if (pageMarkers) return pages.map(p => `--- ${pageName(p.number)} ---\n\n${trimPage(p.text)}`.trimEnd()).join('\n\n');
    return pages.map(p => trimPage(p.text)).filter(Boolean).join('\n\n');
}
