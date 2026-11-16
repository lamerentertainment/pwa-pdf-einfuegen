// Aufzählungszeichen, die ein PDF als Grafik zeichnet statt als Text: Browser (Chrome, Edge) und
// manche Textverarbeitungen malen die Punkte einer Aufzählung als kleine Kreise. Im eingebetteten
// Text fehlen sie dann; hier werden sie aus den Zeichenbefehlen der Seite (pdf.js-Operatorliste)
// gelesen. Rein und ohne pdf.js – die Befehlsnummern (OPS) kommen als Parameter.
//
// Ergebnis in PDF-Koordinaten (Ursprung unten links), wie die Textelemente von pdf.js.

// Grösse eines Aufzählungszeichens in Punkten und erlaubtes Seitenverhältnis
const MIN_SIZE = 1.5;
const MAX_SIZE = 8;
const MAX_RATIO = 1.4;

// Pfad-Befehle in den Pfaddaten (pdf.js DrawOPS)
const MOVE_TO = 0;
const CURVE_TO = 2;
const QUADRATIC_CURVE_TO = 3;

const multiply = (m, n) => [
    m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];

function transformBox(m, [x0, y0, x1, y1]) {
    const xs = [];
    const ys = [];
    for (const [x, y] of [[x0, y0], [x1, y0], [x0, y1], [x1, y1]]) {
        xs.push(m[0] * x + m[2] * y + m[4]);
        ys.push(m[1] * x + m[3] * y + m[5]);
    }
    return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}

// Pfaddaten: [Befehl, Koordinaten …, Befehl, …]; nach dem Zeichnen ersetzt pdf.js sie u. U. durch
// ein Path2D-Objekt, dann ist die Form unbekannt (null)
function pathShape(data) {
    if (!ArrayBuffer.isView(data)) return null;
    const ARGS = { 0: 2, 1: 2, 2: 6, 3: 4, 4: 0 };
    let subpaths = 0;
    let curved = false;
    for (let i = 0; i < data.length;) {
        const op = data[i];
        if (!(op in ARGS)) return null;
        if (op === MOVE_TO) subpaths++;
        if (op === CURVE_TO || op === QUADRATIC_CURVE_TO) curved = true;
        i += 1 + ARGS[op];
    }
    return { subpaths, curved };
}

/**
 * Kleine runde oder quadratische Formen, die als Aufzählungszeichen in Frage kommen: gefüllt
 * (Punkt, Quadrat) oder nur umrandet und rund (Kreis der zweiten Ebene). Umrandete Quadrate
 * bleiben weg – das sind meist Ankreuzfelder.
 * @param {{fnArray: number[], argsArray: Array}} opList pdf.js page.getOperatorList()
 * @param {object} OPS pdfjsLib.OPS
 * @returns {Array<{x: number, y: number, w: number, h: number}>}
 */
export function findBulletShapes({ fnArray, argsArray }, OPS) {
    const FILLS = new Set([OPS.fill, OPS.eoFill, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke]);
    const STROKES = new Set([OPS.stroke, OPS.closeStroke]);
    const stack = [];
    let ctm = [1, 0, 0, 1, 0, 0];
    const bullets = [];
    for (let i = 0; i < fnArray.length; i++) {
        const fn = fnArray[i];
        const args = argsArray[i];
        if (fn === OPS.save) stack.push(ctm);
        else if (fn === OPS.restore) ctm = stack.pop() ?? [1, 0, 0, 1, 0, 0];
        else if (fn === OPS.transform) ctm = multiply(ctm, args);
        else if (fn === OPS.paintFormXObjectBegin) {
            stack.push(ctm);
            if (args?.[0]) ctm = multiply(ctm, args[0]);
        } else if (fn === OPS.paintFormXObjectEnd) ctm = stack.pop() ?? [1, 0, 0, 1, 0, 0];
        else if (fn === OPS.constructPath) {
            const [op, data, minMax] = args ?? [];
            const filled = FILLS.has(op);
            if (!minMax || (!filled && !STROKES.has(op))) continue;
            const shape = pathShape(data?.[0]);
            if (shape && shape.subpaths !== 1) continue;
            if (!filled && !shape?.curved) continue;
            const box = transformBox(ctm, minMax);
            const small = Math.min(box.w, box.h) >= MIN_SIZE && Math.max(box.w, box.h) <= MAX_SIZE;
            if (small && Math.max(box.w, box.h) / Math.min(box.w, box.h) <= MAX_RATIO) bullets.push(box);
        }
    }
    return bullets;
}
