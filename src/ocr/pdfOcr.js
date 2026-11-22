// Glue between pdf.js pages and the OCR engine: deciding which pages need OCR, rendering them
// and turning recognized lines back into pdf.js-style text items for pdfLayout.js.

// Pages with less extractable text than this are treated as image-only
const MIN_TEXT_CHARS = 20;
// pdf.js text rendering mode 3 = invisible (the usual way scanners attach their own OCR layer)
const TEXT_RENDER_INVISIBLE = 3;

/**
 * Decides whether a page is a scan that should go through OCR.
 *
 * A page qualifies if it paints an image and either carries (almost) no text or only invisible
 * text. The second case matters: scanners and tools like Preview or Acrobat add their own hidden
 * OCR layer, which is often poor ("lch" for "Ich", "I12" for "112") and would otherwise win.
 *
 * @param {object} page pdf.js PDFPageProxy
 * @param {{items: Array}} textContent result of page.getTextContent()
 * @param {object} OPS pdfjsLib.OPS
 * @param {object} [ops] page.getOperatorList(), if already at hand
 * @returns {Promise<{scanned: boolean, reason: string}>}
 */
export async function classifyPage(page, textContent, OPS, ops) {
    const textChars = textContent.items.reduce((n, item) => n + (item.str ? item.str.trim().length : 0), 0);
    ops ??= await page.getOperatorList();
    const { hasImage, visibleText, invisibleText } = scanOperators(ops, OPS);

    if (!hasImage) return { scanned: false, reason: 'no-image' };
    if (textChars < MIN_TEXT_CHARS) return { scanned: true, reason: 'no-text' };
    if (invisibleText && !visibleText) return { scanned: true, reason: 'invisible-text-layer' };
    return { scanned: false, reason: 'text' };
}

/** Pure part of classifyPage, exported for tests. */
export function scanOperators({ fnArray, argsArray }, OPS) {
    const imageOps = new Set([
        OPS.paintImageXObject,
        OPS.paintInlineImageXObject,
        OPS.paintImageMaskXObject,
        OPS.paintImageXObjectRepeat,
        OPS.paintImageMaskXObjectRepeat,
        OPS.paintSolidColorImageMask,
        OPS.paintInlineImageXObjectGroup,
        OPS.paintImageMaskXObjectGroup,
    ].filter(op => op !== undefined));
    const textOps = new Set([OPS.showText, OPS.showSpacedText, OPS.nextLineShowText, OPS.nextLineSetSpacingShowText]
        .filter(op => op !== undefined));

    let hasImage = false;
    let visibleText = false;
    let invisibleText = false;
    // Text render mode is part of the graphics state: track it across save/restore
    const modeStack = [];
    let mode = 0;

    for (let i = 0; i < fnArray.length; i++) {
        const fn = fnArray[i];
        if (fn === OPS.save) modeStack.push(mode);
        else if (fn === OPS.restore) mode = modeStack.length ? modeStack.pop() : 0;
        else if (fn === OPS.setTextRenderingMode) mode = argsArray[i]?.[0] ?? 0;
        else if (imageOps.has(fn)) hasImage = true;
        else if (textOps.has(fn)) {
            if (mode === TEXT_RENDER_INVISIBLE) invisibleText = true;
            else visibleText = true;
        }
    }
    return { hasImage, visibleText, invisibleText };
}

/**
 * Renders a page to RGBA pixels at roughly the given resolution.
 * `view` is the rendered page box in PDF units (rotation already applied), to be passed to
 * linesToTextItems and pdfLayout instead of page.view.
 * @returns {Promise<{data: Uint8ClampedArray, width: number, height: number, scale: number, view: number[]}>}
 */
export async function renderPage(page, dpi = 150) {
    const scale = dpi / 72;
    const viewport = page.getViewport({ scale });
    const width = Math.ceil(viewport.width);
    const height = Math.ceil(viewport.height);
    const canvas = typeof OffscreenCanvas !== 'undefined'
        ? new OffscreenCanvas(width, height)
        : Object.assign(document.createElement('canvas'), { width, height });
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, width, height);
    // intent 'print': pdf.js plant die Zeichenschritte sonst mit requestAnimationFrame ein, und das
    // ruft der Browser in einem Tab im Hintergrund nicht auf. Die Erfassung stünde dann still, bis
    // der Tab wieder vorne ist. Für die Texterkennung ist das Ergebnis dasselbe.
    await page.render({ canvasContext: ctx, canvas, viewport, intent: 'print' }).promise;
    const { data } = ctx.getImageData(0, 0, width, height);
    // Release the backing store early: 40-page scans otherwise pile up canvases
    canvas.width = canvas.height = 0;
    return { data, width, height, scale, view: [0, 0, width / scale, height / scale] };
}

/**
 * Converts OCR lines (image pixels, top-left origin) into pdf.js-like text items (PDF user
 * space, bottom-left origin) so pdfLayout.js can treat scanned and digital pages alike.
 *
 * @param {Array<{text: string, x: number, y: number, w: number, h: number, score: number}>} lines
 * @param {number} scale pixels per PDF unit used when rendering
 * @param {number[]} view rendered page box ([x0, y0, x1, y1]) from renderPage
 */
export function linesToTextItems(lines, scale, view) {
    const [x0, , , y1] = view;
    return lines.map(line => ({
        str: line.text,
        // transform[4], transform[5] = left edge, baseline (approximated by the box bottom)
        transform: [1, 0, 0, 1, x0 + line.x / scale, y1 - (line.y + line.h) / scale],
        width: line.w / scale,
        height: line.h / scale,
        ocrScore: line.score,
    }));
}
