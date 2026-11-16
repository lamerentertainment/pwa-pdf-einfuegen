// Stufe 1: ein PDF erfassen. Digitale Seiten liefern ihren eingebetteten Text, gescannte Seiten
// gehen durch die lokale Texterkennung. Für die Prüfansicht wird zu jeder Seite festgehalten,
// woher der Text stammt und wo jede Zeile auf der Seite liegt.
//
// Koordinaten der Boxen: Seite bei Massstab 1 (PDF-Punkte), Ursprung oben links, Drehung der
// Seite schon angewendet – so können sie direkt über die gerenderte Seite gelegt werden.
import * as pdfjsLib from 'pdfjs-dist';
import { classifyPage, linesToTextItems, renderPage } from '../ocr/pdfOcr.js';
import ocrService, { LAYOUT_MODEL_ID, OCR_MODEL_ID } from '../ocr/ocrService.js';
import { DEFAULT_OPTIONS, UNCERTAIN_SCORE } from './options.js';
import { buildPageTexts, ocrLineBox, regionBox, textItemBox } from './pageModel.js';
import { createLayout } from './layoutRegions.js';

const PDFJS_BASE = `/vendor/pdfjs-${pdfjsLib.version}/`;
pdfjsLib.GlobalWorkerOptions.workerSrc = `${PDFJS_BASE}pdf.worker.min.mjs`;

export const OCR_DPI = 150;
export { DEFAULT_OPTIONS, UNCERTAIN_SCORE };

export function openPdf(data) {
    return pdfjsLib.getDocument({
        data,
        // Bilddecoder (JBIG2, JPEG 2000) aus public/vendor; ohne sie bleiben Scans leer
        wasmUrl: new URL(`${PDFJS_BASE}wasm/`, document.baseURI).href,
        isEvalSupported: false,
        // Nur echte Fehler melden, keine Hinweise zu Schrift-Feinheiten (TrueType-Hinting u. ä.)
        verbosity: pdfjsLib.VerbosityLevel.ERRORS,
    }).promise;
}

function checkAborted(signal) {
    if (signal?.aborted) throw new DOMException('Abgebrochen', 'AbortError');
}

/**
 * Liest eine Seite so, wie sie im PDF steht: eingebetteter Text und Einstufung als Scan.
 * @returns {Promise<{record: object, scanned: boolean}>}
 */
async function readPage(pdf, n) {
    const page = await pdf.getPage(n);
    const viewport = page.getViewport({ scale: 1 });
    const textContent = await page.getTextContent();
    const items = textContent.items.filter(item => typeof item.str === 'string');
    const { scanned, reason } = await classifyPage(page, textContent, pdfjsLib.OPS);
    page.cleanup();
    return {
        scanned,
        record: {
            number: n,
            width: viewport.width,
            height: viewport.height,
            view: page.view,
            items,
            boxes: items.filter(i => i.str.trim()).map(i => textItemBox(i, viewport)),
            layout: null,
            source: items.some(i => i.str.trim()) ? 'text' : 'leer',
            scanReason: scanned ? reason : null,
        },
    };
}

/**
 * Erfasst ein PDF.
 * @param {ArrayBuffer} data
 * @param {object} options siehe DEFAULT_OPTIONS
 * @param {{onStatus?: (text: string, fraction: number) => void, signal?: AbortSignal}} [hooks]
 */
export async function capture(data, options = DEFAULT_OPTIONS, { onStatus, signal } = {}) {
    const status = (text, fraction) => onStatus?.(text, fraction);
    const pdf = await openPdf(data);
    try {
        const pages = [];
        const scanned = [];
        // «Texterkennung erzwingen»: auch digitale Seiten, deren eingebetteter Text dann nur noch
        // als Rückfall dient, falls die Texterkennung scheitert. Nur mit installiertem Modell –
        // sonst würden digitale Seiten als Scans ohne Texterkennung gemeldet
        const forceOcr = Boolean(options.forceOcr) && options.ocr !== false && await ocrService.isInstalled(OCR_MODEL_ID);
        for (let n = 1; n <= pdf.numPages; n++) {
            checkAborted(signal);
            status(`Seite ${n} von ${pdf.numPages} wird gelesen …`, (n - 1) / pdf.numPages * 0.2);
            const { record, scanned: isScan } = await readPage(pdf, n);
            pages.push(record);
            if (isScan || forceOcr) scanned.push(n);
        }

        const notices = [];
        if (scanned.length) await ocrPages(pdf, pages, scanned, options, { status, signal, notices });

        checkAborted(signal);
        status('Text wird aufgebaut …', 0.98);
        const texts = buildPageTexts(pages, options);
        pages.forEach((page, i) => {
            page.text = texts[i];
            page.originalText = texts[i];
        });
        return { pdf, pages, notices, options: { ...options } };
    } catch (err) {
        // pdf.js 6: freigegeben wird über die Ladeaufgabe
        await pdf.loadingTask.destroy().catch(() => {});
        throw err;
    }
}

async function startOcr(useLayoutWanted, { status, notices }) {
    status('Texterkennung wird gestartet …', 0.2);
    await ocrService.init();
    if (!useLayoutWanted || !(await ocrService.isInstalled(LAYOUT_MODEL_ID))) return false;
    status('Layoutmodell wird gestartet …', 0.2);
    try {
        await ocrService.initLayout();
        return true;
    } catch (err) {
        console.error('Layoutmodell nicht verfügbar:', err);
        notices.push({ type: 'layout-failed', message: err.message });
        return false;
    }
}

/** Texterkennung einer Seite; überschreibt Zeilen, Boxen und Layout von `target`. */
async function ocrPage(pdf, target, useLayout, dpi = OCR_DPI) {
    const page = await pdf.getPage(target.number);
    const image = await renderPage(page, dpi);
    page.cleanup();
    const { scale, view } = image;
    const { lines, regions } = await ocrService.recognize(image, useLayout);
    const items = linesToTextItems(lines, scale, view);
    const boxes = lines.map(l => ocrLineBox(l, scale));
    target.layout = null;
    if (useLayout && regions) {
        // Alle Zeilen bleiben erhalten und kennen ihren Bereich: Kopfzeilen & Co. sind nur
        // ausgeschaltet und lassen sich in der Prüfansicht wieder einschalten
        const { layout, lineRegions } = createLayout(regions.map(r => regionBox(r, scale)), boxes);
        lineRegions.forEach((id, i) => { items[i].region = id; boxes[i].region = id; });
        target.layout = layout;
    }
    target.items = items;
    target.view = view;
    target.boxes = boxes;
    target.source = useLayout ? 'ocr-layout' : 'ocr';
    target.dpi = dpi;
}

async function ocrPages(pdf, pages, scanned, options, { status, signal, notices }) {
    const off = options.ocr === false;
    if (off || !(await ocrService.isInstalled(OCR_MODEL_ID))) {
        for (const n of scanned) pages[n - 1].source = pages[n - 1].source === 'leer' ? 'ocr-fehlt' : 'text-ocr-fehlt';
        notices.push({ type: off ? 'ocr-off' : 'model-missing', count: scanned.length });
        return;
    }
    const useLayout = await startOcr(options.layout, { status, notices });

    let done = 0;
    for (const n of scanned) {
        checkAborted(signal);
        status(`Texterkennung: Seite ${n} (${done + 1} von ${scanned.length}) …`, 0.2 + 0.78 * done / scanned.length);
        try {
            await ocrPage(pdf, pages[n - 1], useLayout);
        } catch (err) {
            console.error(`Texterkennung auf Seite ${n} fehlgeschlagen:`, err);
            notices.push({ type: 'ocr-failed', page: n, message: err.message });
        }
        done++;
    }
}

/** Arten, eine einzelne Seite neu zu erfassen. */
export const RECAPTURE_MODES = Object.freeze(['text', 'ocr', 'ocr-layout']);

/**
 * Erfasst eine einzelne Seite nach der Erfassung neu, mit eigener Quelle und Auflösung.
 * Liefert einen neuen Seitendatensatz (ohne Text); scheitert die Texterkennung, wird geworfen.
 * @param {object} pdf pdf.js-Dokument
 * @param {number} n Seitennummer
 * @param {{mode: 'text'|'ocr'|'ocr-layout', dpi?: number}} config
 */
export async function recapturePage(pdf, n, { mode, dpi = OCR_DPI }, { onStatus } = {}) {
    if (!RECAPTURE_MODES.includes(mode)) throw new Error(`Unbekannte Erfassungsart: ${mode}`);
    const status = (text, fraction) => onStatus?.(text, fraction);
    status(`Seite ${n} wird gelesen …`, 0);
    const { record } = await readPage(pdf, n);
    if (mode === 'text') return { record, notices: [] };
    if (!(await ocrService.isInstalled(OCR_MODEL_ID))) throw new Error('Das Texterkennungsmodell ist nicht installiert.');
    const notices = [];
    const useLayout = await startOcr(mode === 'ocr-layout', { status, notices });
    if (mode === 'ocr-layout' && !useLayout && !notices.length) throw new Error('Das Layoutmodell ist nicht installiert.');
    status(`Texterkennung: Seite ${n} …`, 0.3);
    await ocrPage(pdf, record, useLayout, dpi);
    return { record, notices };
}
