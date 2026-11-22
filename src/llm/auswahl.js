// Prompt nur auf einen markierten Teil des Eingabetexts anwenden: welcher Text an das Sprachmodell
// geht und wie das Ergebnis an derselben Stelle wieder eingesetzt wird.

/**
 * Zerlegt den Text an der Markierung. Leerraum am Rand der Markierung bleibt stehen, damit
 * Absätze und Abstände um die umgeformte Stelle erhalten bleiben.
 * @returns {{ vor: string, kern: string, nach: string }}
 */
export function teileAuswahl(text, start, end) {
    const markiert = text.slice(start, end);
    const lead = markiert.match(/^\s*/)[0];
    const trail = markiert.slice(lead.length).match(/\s*$/)[0];
    return {
        vor: text.slice(0, start) + lead,
        kern: markiert.slice(lead.length, markiert.length - trail.length),
        nach: trail + text.slice(end),
    };
}

/** Setzt das Ergebnis des Sprachmodells anstelle des markierten Teils ein. */
export function setzeEin({ vor, nach }, ergebnis) {
    return vor + ergebnis.trim() + nach;
}
