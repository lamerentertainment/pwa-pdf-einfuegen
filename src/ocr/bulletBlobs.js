// Aufzählungszeichen auf gescannten (bzw. gerenderten) Seiten: Die Texterkennung liest einen
// Punkt mal als «•», mal als «o» oder «e», oder lässt ihn weg – die Zeile beginnt aber trotzdem
// bei ihm. Deshalb wird im Seitenbild nachgesehen: Liegt am Anfang einer erkannten Zeile, für
// sich allein, ein kleiner gefüllter Punkt, ein Quadrat oder ein Kreis, ist das ein
// Aufzählungszeichen. Rein, ohne Browser – Bild und Zeilen in Bildpixeln (Ursprung oben links).

// Grösse im Verhältnis zur Zeilenhöhe der Texterkennung (eng um die Buchstaben, eher Höhe der
// Grossbuchstaben als Schriftgrösse): ein Punkt ist rund 0.4 davon, ein Kreis 0.5, ein Satzpunkt
// deutlich weniger. Ein «o» ist kaum grösser als ein Kreis – davor schützt der Abstand: Ein «o»
// steht nie allein am Zeilenanfang (ausser als Aufzählungszeichen in Courier, dann zu Recht).
const MIN_SIZE = 0.22;
const MAX_SIZE = 0.62;
const MAX_RING_SIZE = 0.6;
const MAX_RATIO = 1.3;
// Gefüllt (Punkt ≈ 0.79, Quadrat ≈ 1) oder Ring (Kreis der zweiten Ebene)
const MIN_FILL = 0.6;
const MIN_RING_FILL = 0.2;
// Leerraum rechts (zum Text) und links, in Zeilenhöhen
const GAP_RIGHT = 0.2;
const GAP_LEFT = 0.3;
const DARK = 160;
// Strich (– oder -): flach, kürzer als ein Wort; als Liste zählt er erst, wenn mehrere
// untereinander stehen (pdfLayout.js), sonst ist es eher ein Gedankenstrich am Zeilenanfang
const DASH_MIN_W = 0.25;
const DASH_MAX_W = 0.9;
const DASH_MAX_H = 0.18;

/** Helligkeit eines RGBA-Bildes als Maske «dunkel» in einem Fenster. */
function darkMask({ data, width }, x0, y0, w, h) {
    const mask = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const o = ((y0 + y) * width + x0 + x) * 4;
            if (0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2] < DARK) mask[y * w + x] = 1;
        }
    }
    return mask;
}

/** Zusammenhängende dunkle Flächen (8er-Nachbarschaft) mit Rahmen und Pixelzahl. */
function components(mask, w, h) {
    const label = new Int32Array(w * h).fill(-1);
    const result = [];
    for (let start = 0; start < mask.length; start++) {
        if (!mask[start] || label[start] >= 0) continue;
        const id = result.length;
        const c = { x0: w, y0: h, x1: -1, y1: -1, count: 0, touches: false };
        const stack = [start];
        label[start] = id;
        while (stack.length) {
            const p = stack.pop();
            const x = p % w;
            const y = (p - x) / w;
            c.count++;
            c.x0 = Math.min(c.x0, x); c.x1 = Math.max(c.x1, x);
            c.y0 = Math.min(c.y0, y); c.y1 = Math.max(c.y1, y);
            if (x === 0 || y === 0 || x === w - 1 || y === h - 1) c.touches = true;
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    const nx = x + dx;
                    const ny = y + dy;
                    if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
                    const q = ny * w + nx;
                    if (mask[q] && label[q] < 0) { label[q] = id; stack.push(q); }
                }
            }
        }
        result.push(c);
    }
    return { result, label };
}

const isBulletShape = (c, label, id, w, lineH) => {
    const bw = c.x1 - c.x0 + 1;
    const bh = c.y1 - c.y0 + 1;
    const size = Math.max(bw, bh);
    if (size < MIN_SIZE * lineH || size > MAX_SIZE * lineH) return false;
    if (size / Math.min(bw, bh) > MAX_RATIO) return false;
    const fill = c.count / (bw * bh);
    if (fill >= MIN_FILL) return true;
    // Ring: nicht grösser als ein kleines «o», mit einem geschlossenen Loch in der Mitte
    // (eine Ziffer wie «4» ist auch innen hell, aber offen; bei «6» und «9» sitzt das Loch schief)
    return fill >= MIN_RING_FILL && size <= MAX_RING_SIZE * lineH && hasCentralHole(c, label, id, w);
};

function isDashShape(c, lineH) {
    const bw = c.x1 - c.x0 + 1;
    const bh = c.y1 - c.y0 + 1;
    return bw >= DASH_MIN_W * lineH && bw <= DASH_MAX_W * lineH && bh <= DASH_MAX_H * lineH
        && bw >= 2 * bh && c.count / (bw * bh) >= MIN_FILL;
}

function hasCentralHole(c, label, id, w) {
    const cx = Math.round((c.x0 + c.x1) / 2);
    const cy = Math.round((c.y0 + c.y1) / 2);
    if (label[cy * w + cx] === id) return false;
    // Helle Pixel ab der Mitte füllen: Erreichen sie den Rahmen, ist das Loch offen
    const seen = new Set([cy * w + cx]);
    const stack = [[cx, cy]];
    let hx0 = cx; let hx1 = cx; let hy0 = cy; let hy1 = cy;
    while (stack.length) {
        const [x, y] = stack.pop();
        if (x <= c.x0 || x >= c.x1 || y <= c.y0 || y >= c.y1) return false;
        hx0 = Math.min(hx0, x); hx1 = Math.max(hx1, x); hy0 = Math.min(hy0, y); hy1 = Math.max(hy1, y);
        for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
            const q = ny * w + nx;
            if (!seen.has(q) && label[q] !== id) { seen.add(q); stack.push([nx, ny]); }
        }
    }
    // Das Loch liegt mittig
    const tol = 0.2 * Math.max(c.x1 - c.x0, c.y1 - c.y0);
    return Math.abs((hx0 + hx1) / 2 - (c.x0 + c.x1) / 2) <= tol && Math.abs((hy0 + hy1) / 2 - (c.y0 + c.y1) / 2) <= tol;
}

/**
 * Sucht vor jeder erkannten Zeile ein Aufzählungszeichen: die erste dunkle Fläche am
 * Zeilenanfang, wenn sie die Form eines Punktes, Quadrats, Kreises oder Strichs hat (Striche mit
 * `dash: true`) und links und rechts Abstand hält.
 * @param {{data: Uint8ClampedArray, width: number, height: number}} image RGBA
 * @param {Array<{x: number, y: number, w: number, h: number}>} lines erkannte Zeilen (Bildpixel)
 * @returns {Array<{x: number, y: number, w: number, h: number, dash?: boolean}>} Bildpixel
 */
export function findBulletBlobs(image, lines) {
    const bullets = [];
    for (const line of lines) {
        const lh = line.h;
        if (lh < 6) continue;
        // Fenster: etwas vor der Zeile bis ein Stück in sie hinein, in der Höhe mit Rand
        const x0 = Math.max(0, Math.floor(line.x - 2 * lh));
        const x1 = Math.min(image.width, Math.ceil(line.x + 2 * lh));
        const y0 = Math.max(0, Math.floor(line.y - 0.3 * lh));
        const y1 = Math.min(image.height, Math.ceil(line.y + 1.3 * lh));
        const w = x1 - x0;
        const h = y1 - y0;
        if (w < 3 || h < 3) continue;
        const mask = darkMask(image, x0, y0, w, h);
        const { result, label } = components(mask, w, h);
        // Flächen, die in den mittleren Teil der Zeile reichen; die linke ist die erste der Zeile
        const top = line.y - y0 + 0.2 * lh;
        const bottom = line.y - y0 + 0.9 * lh;
        const onLine = result
            .map((c, id) => ({ c, id }))
            .filter(({ c }) => c.y1 >= top && c.y0 <= bottom)
            .sort((a, b) => a.c.x0 - b.c.x0);
        if (!onLine.length) continue;
        const { c, id } = onLine[0];
        const dash = isDashShape(c, lh);
        if (c.touches || (!dash && !isBulletShape(c, label, id, w, lh))) continue;
        const cy = (c.y0 + c.y1) / 2;
        if (cy < top || cy > bottom) continue;
        // Abstand: rechts bis zum Text, links zu allem anderen auf der Höhe des Punktes
        const band = ({ c: o }) => o.y1 >= c.y0 - 0.3 * lh && o.y0 <= c.y1 + 0.3 * lh;
        const others = result.map((o, i) => ({ c: o, i })).filter(o => o.i !== id && band(o));
        const tooClose = others.some(({ c: o }) => (o.x0 > c.x1 && o.x0 - c.x1 <= GAP_RIGHT * lh)
            || (o.x1 < c.x0 && c.x0 - o.x1 <= GAP_LEFT * lh));
        if (tooClose) continue;
        const bullet = { x: x0 + c.x0, y: y0 + c.y0, w: c.x1 - c.x0 + 1, h: c.y1 - c.y0 + 1 };
        bullets.push(dash ? { ...bullet, dash: true } : bullet);
    }
    return bullets;
}
