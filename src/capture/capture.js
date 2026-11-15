// Stufe 1: ein PDF erfassen. Digitale Seiten liefern ihren eingebetteten Text, gescannte Seiten
// gehen durch die lokale Texterkennung. Für die Prüfansicht wird zu jeder Seite festgehalten,
// woher der Text stammt und wo jede Zeile auf der Seite liegt.
//
// Koordinaten der Boxen: Seite bei Massstab 1 (PDF-Punkte), Ursprung oben links, Drehung der
// Seite schon angewendet – so können sie direkt über die gerenderte Seite gelegt werden.
import * as pdfjsLib from 'pdfjs-dist';
import { classifyPage, linesToTextItems, renderPage } from '../ocr/pdfOcr.js';
import { dropLinesInRegions, FURNITURE_LABELS } from '../ocr/layoutModel.js';
import ocrService, { LAYOUT_MODEL_ID, OCR_MODEL_ID } from '../ocr/ocrService.js';
import { DEFAULT_OPTIONS, UNCERTAIN_SCORE } from './options.js';
import { buildPageTexts, ocrLineBox, regionBox, textItemBox } from './pageModel.js';

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
        for (let n = 1; n <= pdf.numPages; n++) {
            checkAborted(signal);
            status(`Seite ${n} von ${pdf.numPages} wird gelesen …`, (n - 1) / pdf.numPages * 0.2);
            const page = await pdf.getPage(n);
            const viewport = page.getViewport({ scale: 1 });
            const textContent = await page.getTextContent();
            const items = textContent.items.filter(item => typeof item.str === 'string');
            const { scanned: isScan, reason } = await classifyPage(page, textContent, pdfjsLib.OPS);
            pages.push({
                number: n,
                width: viewport.width,
                height: viewport.height,
                view: page.view,
                items,
                boxes: items.filter(i => i.str.trim()).map(i => textItemBox(i, viewport)),
                regions: null,
                source: items.some(i => i.str.trim()) ? 'text' : 'leer',
                scanReason: isScan ? reason : null,
            });
            if (isScan) scanned.push(n);
            page.cleanup();
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

async function ocrPages(pdf, pages, scanned, options, { status, signal, notices }) {
    if (!(await ocrService.isInstalled(OCR_MODEL_ID))) {
        for (const n of scanned) pages[n - 1].source = pages[n - 1].source === 'leer' ? 'ocr-fehlt' : 'text-ocr-fehlt';
        notices.push({ type: 'model-missing', count: scanned.length });
        return;
    }
    status('Texterkennung wird gestartet …', 0.2);
    await ocrService.init();

    let useLayout = false;
    if (options.layout && await ocrService.isInstalled(LAYOUT_MODEL_ID)) {
        status('Layoutmodell wird gestartet …', 0.2);
        try {
            await ocrService.initLayout();
            useLayout = true;
        } catch (err) {
            console.error('Layoutmodell nicht verfügbar:', err);
            notices.push({ type: 'layout-failed', message: err.message });
        }
    }

    let done = 0;
    for (const n of scanned) {
        checkAborted(signal);
        status(`Texterkennung: Seite ${n} (${done + 1} von ${scanned.length}) …`, 0.2 + 0.78 * done / scanned.length);
        try {
            const page = await pdf.getPage(n);
            const image = await renderPage(page, OCR_DPI);
            page.cleanup();
            const { scale, view } = image;
            let { lines, regions } = await ocrService.recognize(image, useLayout);
            const target = pages[n - 1];
            if (useLayout && regions) {
                target.regions = regions.map(r => regionBox(r, scale));
                lines = dropLinesInRegions(lines, regions, FURNITURE_LABELS);
            }
            target.items = linesToTextItems(lines, scale, view);
            target.view = view;
            target.boxes = lines.map(l => ocrLineBox(l, scale));
            target.source = useLayout ? 'ocr-layout' : 'ocr';
        } catch (err) {
            console.error(`Texterkennung auf Seite ${n} fehlgeschlagen:`, err);
            notices.push({ type: 'ocr-failed', page: n, message: err.message });
        }
        done++;
    }
}
