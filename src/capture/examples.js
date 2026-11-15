// Beispieldokumente zum Ausprobieren (public/beispiele/). Sie gehören zur App, werden mit ihr
// im Browser gespeichert und funktionieren darum auch im Modus «lokal».
export const EXAMPLES = Object.freeze([
    {
        file: 'einvernahme-scan.pdf',
        title: 'Gescannte Einvernahme',
        description: '9 Seiten, eingescannt, mit fehlerhafter Textebene des Scanners. Zeigt die Texterkennung und die Prüfansicht.',
        needsOcr: true,
    },
    {
        file: 'entscheid-digital.pdf',
        title: 'Fiktiver Entscheid (digitales PDF)',
        description: '5 Seiten mit eingebettetem Text: Silbentrennung, Inhaltsverzeichnis, Fussnoten, Tabellen, Listen, Kopf- und Fusszeilen.',
        needsOcr: false,
    },
]);

export const exampleUrl = example => `/beispiele/${example.file}`;

export async function loadExample(example) {
    const response = await fetch(exampleUrl(example));
    if (!response.ok) throw new Error(`Beispiel nicht verfügbar (${response.status}).`);
    return new File([await response.blob()], example.file, { type: 'application/pdf' });
}
