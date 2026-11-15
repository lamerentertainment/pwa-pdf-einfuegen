// Das aktuell geöffnete Dokument. Es lebt nur im Arbeitsspeicher dieses Tabs: nichts davon wird
// gespeichert, und beim Schliessen oder Neuladen ist es weg.
import { markRaw, reactive } from 'vue';
import { DEFAULT_OPTIONS } from './options.js';
import { buildPageTexts } from './pageModel.js';

export const documentState = reactive({
    fileName: null,
    pdf: null, // pdf.js-Dokument (nicht reaktiv), für die Prüfansicht
    pages: [],
    notices: [],
    options: { ...DEFAULT_OPTIONS },
    busy: false,
    status: '',
    progress: 0,
    error: null,
    controller: null,
});

export async function closeDocument() {
    const pdf = documentState.pdf;
    Object.assign(documentState, { fileName: null, pdf: null, pages: [], notices: [], error: null });
    await pdf?.loadingTask.destroy();
}

export async function openFile(file) {
    if (documentState.busy) return;
    await closeDocument();
    const controller = new AbortController();
    Object.assign(documentState, { busy: true, status: 'PDF wird geöffnet …', progress: 0, error: null, controller: markRaw(controller) });
    try {
        // pdf.js und die Texterkennung erst laden, wenn sie gebraucht werden
        const { capture } = await import('./capture.js');
        const result = await capture(await file.arrayBuffer(), { ...documentState.options }, {
            signal: controller.signal,
            onStatus: (text, fraction) => {
                documentState.status = text;
                documentState.progress = fraction;
            },
        });
        Object.assign(documentState, {
            fileName: file.name,
            pdf: markRaw(result.pdf),
            pages: result.pages.map(page => ({ ...page, items: markRaw(page.items), boxes: markRaw(page.boxes) })),
            notices: result.notices,
        });
    } catch (err) {
        documentState.error = err.name === 'AbortError' ? null : err.message;
        if (err.name !== 'AbortError') console.error(err);
    } finally {
        Object.assign(documentState, { busy: false, status: '', progress: 0, controller: null });
    }
}

/**
 * Baut den Text aller Seiten mit geänderten Einstellungen neu auf – aus den bereits erkannten
 * Zeilen, ohne die Texterkennung zu wiederholen. Eigene Bearbeitungen gehen dabei verloren.
 */
export function relayoutDocument(changes) {
    Object.assign(documentState.options, changes);
    const texts = buildPageTexts(documentState.pages, documentState.options);
    documentState.pages.forEach((page, i) => {
        page.text = texts[i];
        page.originalText = texts[i];
    });
}

export function cancel() {
    documentState.controller?.abort();
}
