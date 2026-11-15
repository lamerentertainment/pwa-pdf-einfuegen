// Einstellungen der Erfassung – eigene Datei, damit die Oberfläche sie kennt, ohne pdf.js und
// die Texterkennung schon beim Start zu laden.

/** OCR-Zeilen unter diesem Wert gelten als unsicher und werden in der Prüfansicht markiert. */
export const UNCERTAIN_SCORE = 0.8;

export const DEFAULT_OPTIONS = Object.freeze({
    layout: false, // Layoutmodell verwenden (nur wenn installiert)
    markUncertain: false, // unsichere OCR-Zeilen im Text mit [?] markieren
    keepLineNumbers: false, // Zeilennummern am Rand behalten
    structure: true, // Einrückungen und nebeneinanderstehenden Text erhalten
    tables: false, // Tabellen als Markdown
});
