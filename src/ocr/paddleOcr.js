// PP-OCRv5 text detection (DB) + recognition (CTC) on a raw RGBA image.
//
// Environment-agnostic: runs in a Web Worker in the app and under Node in tests. The caller
// passes an `ort` module (onnxruntime-web) and the model bytes, so this file never fetches.
//
// Post-processing is dependency-free (no OpenCV/Clipper): instead of a min-area rectangle per
// region, the page skew is estimated once from the orientation of the long text lines and every
// region becomes a rectangle at that angle. Scans are skewed as a whole, and an angle measured
// on a whole line is far more reliable than one measured on a short word like "Ja.".

const DET_MEAN = [0.485, 0.456, 0.406];
const DET_STD = [0.229, 0.224, 0.225];

export const DEFAULT_OPTIONS = {
    // Detection input: long side capped (multiple of 32). Text in A4 scans at ~150 dpi is
    // already large enough; bigger inputs mostly cost time.
    detMaxSide: 1920,
    binThresh: 0.3,
    boxThresh: 0.6,
    unclipRatio: 1.5,
    minBoxSide: 3,
    recHeight: 48,
    recBatchSize: 8,
    // Longest crop fed to the recognizer; wider regions are split into chunks
    recMaxWidth: 3200,
};

/**
 * Parses the `character_dict` list out of the recognizer's inference.yml.
 * The CTC output has dict.length + 2 classes: blank first, space last.
 */
export function parseCharacterDict(yml) {
    const lines = yml.split(/\r?\n/);
    const start = lines.findIndex(l => /^\s*character_dict:\s*$/.test(l));
    if (start < 0) throw new Error('character_dict not found in recognizer config');
    const indent = lines[start + 1].match(/^(\s*)-/)?.[1] ?? '';
    const chars = [];
    for (let i = start + 1; i < lines.length; i++) {
        const m = lines[i].match(/^(\s*)- (.*)$/);
        if (!m || m[1] !== indent) break;
        chars.push(unquoteYamlScalar(m[2]));
    }
    return chars;
}

function unquoteYamlScalar(s) {
    if (s.startsWith("'") && s.endsWith("'")) return s.slice(1, -1).replace(/''/g, "'");
    if (s.startsWith('"') && s.endsWith('"')) return JSON.parse(s);
    return s;
}

export class PaddleOcr {
    /**
     * @param {object} ort onnxruntime-web module
     * @param {{det: ArrayBuffer|Uint8Array, rec: ArrayBuffer|Uint8Array, dict: string[]}} models
     * @param {object} [sessionOptions] passed to InferenceSession.create
     */
    static async create(ort, { det, rec, dict }, sessionOptions = {}) {
        const opts = { graphOptimizationLevel: 'all', logSeverityLevel: 3, ...sessionOptions };
        const detSession = await ort.InferenceSession.create(toBytes(det), opts);
        const recSession = await ort.InferenceSession.create(toBytes(rec), opts);
        return new PaddleOcr(ort, detSession, recSession, dict);
    }

    constructor(ort, detSession, recSession, dict) {
        this.ort = ort;
        this.det = detSession;
        this.rec = recSession;
        // CTC classes: 0 = blank, 1..n = dict, n+1 = space
        this.classes = ['', ...dict, ' '];
    }

    /**
     * @param {{data: Uint8ClampedArray|Uint8Array, width: number, height: number}} image RGBA
     * @returns {Promise<Array<{text: string, score: number, x: number, y: number, w: number, h: number}>>}
     *   lines in image pixel coordinates (top-left origin); h approximates the font size
     */
    async recognize(image, options = {}) {
        const opt = { ...DEFAULT_OPTIONS, ...options };
        const regions = await this.detect(image, opt);
        if (regions.length === 0) return [];
        const texts = await this.read(image, regions, opt);
        return regions
            .map((r, i) => ({ ...tightRect(r), text: texts[i].text, score: texts[i].score }))
            .filter(l => l.text.trim().length > 0);
    }

    async detect(image, opt) {
        const { width, height } = image;
        const scale = Math.min(1, opt.detMaxSide / Math.max(width, height));
        const dw = Math.max(32, Math.round((width * scale) / 32) * 32);
        const dh = Math.max(32, Math.round((height * scale) / 32) * 32);

        const input = new Float32Array(3 * dw * dh);
        const resized = resizeRgba(image, 0, 0, width, height, dw, dh);
        const plane = dw * dh;
        for (let i = 0; i < plane; i++) {
            const p = i * 4;
            // Model expects BGR; mean/std are given in that same channel order
            input[i] = (resized[p + 2] / 255 - DET_MEAN[0]) / DET_STD[0];
            input[plane + i] = (resized[p + 1] / 255 - DET_MEAN[1]) / DET_STD[1];
            input[2 * plane + i] = (resized[p] / 255 - DET_MEAN[2]) / DET_STD[2];
        }

        const feeds = { [this.det.inputNames[0]]: new this.ort.Tensor('float32', input, [1, 3, dh, dw]) };
        const out = await this.det.run(feeds);
        const map = out[this.det.outputNames[0]];
        const [, , mh, mw] = map.dims;
        const regions = dbPostprocess(map.data, mw, mh, opt);
        disposeAll(out);

        // Map coordinates → image coordinates (the map may be slightly stretched by the /32 rounding)
        const sx = width / mw;
        const sy = height / mh;
        return regions.map(r => {
            const ux = r.ux * sx, uy = r.uy * sy;
            const un = Math.hypot(ux, uy);
            const vx = -r.uy * sx, vy = r.ux * sy;
            const vn = Math.hypot(vx, vy);
            return {
                cx: r.cx * sx, cy: r.cy * sy,
                ux: ux / un, uy: uy / un,
                len: r.len * un, thick: r.thick * vn,
                grow: r.grow,
            };
        });
    }

    async read(image, regions, opt) {
        // Long regions are split along their axis into chunks the recognizer can handle
        const pieces = [];
        regions.forEach((region, index) => {
            const len = region.len + 2 * region.grow * (region.len / Math.max(region.len, 1));
            const thick = region.thick + 2 * region.grow;
            const maxLen = Math.max(1, (opt.recMaxWidth * thick) / opt.recHeight);
            const chunks = Math.ceil(len / maxLen);
            for (let k = 0; k < chunks; k++) {
                const from = -len / 2 + (k * len) / chunks;
                const pieceLen = len / chunks;
                pieces.push({
                    index,
                    cx: region.cx + region.ux * (from + pieceLen / 2),
                    cy: region.cy + region.uy * (from + pieceLen / 2),
                    ux: region.ux, uy: region.uy,
                    len: pieceLen, thick,
                });
            }
        });

        // Batch crops of similar aspect ratio to keep padding small
        const order = pieces.map((_, i) => i).sort((a, b) => pieces[a].len / pieces[a].thick - pieces[b].len / pieces[b].thick);
        const results = new Array(pieces.length);
        for (let b = 0; b < order.length; b += opt.recBatchSize) {
            const batch = order.slice(b, b + opt.recBatchSize);
            const decoded = await this.recognizeBatch(image, batch.map(i => pieces[i]), opt);
            batch.forEach((pieceIdx, k) => { results[pieceIdx] = decoded[k]; });
        }

        const texts = regions.map(() => ({ parts: [], scores: [] }));
        pieces.forEach((piece, i) => {
            texts[piece.index].parts.push(results[i].text);
            if (results[i].text) texts[piece.index].scores.push(results[i].score);
        });
        return texts.map(t => ({
            text: t.parts.join('').replace(/\s+/g, ' ').trim(),
            score: t.scores.length ? t.scores.reduce((a, s) => a + s, 0) / t.scores.length : 0,
        }));
    }

    async recognizeBatch(image, crops, opt) {
        const H = opt.recHeight;
        const widths = crops.map(c => Math.max(1, Math.min(opt.recMaxWidth, Math.ceil((H * c.len) / c.thick))));
        const W = Math.max(...widths, Math.round(H * 320 / 48));
        const n = crops.length;
        const plane = H * W;
        // Padding stays 0, i.e. mid-grey after normalization, as in the reference implementation
        const input = new Float32Array(n * 3 * plane);

        crops.forEach((c, k) => {
            const cw = widths[k];
            const px = sampleRotated(image, c, cw, H);
            const base = k * 3 * plane;
            for (let yy = 0; yy < H; yy++) {
                for (let xx = 0; xx < cw; xx++) {
                    const p = (yy * cw + xx) * 4;
                    const o = yy * W + xx;
                    input[base + o] = px[p + 2] / 127.5 - 1;
                    input[base + plane + o] = px[p + 1] / 127.5 - 1;
                    input[base + 2 * plane + o] = px[p] / 127.5 - 1;
                }
            }
        });

        const feeds = { [this.rec.inputNames[0]]: new this.ort.Tensor('float32', input, [n, 3, H, W]) };
        const out = await this.rec.run(feeds);
        const probs = out[this.rec.outputNames[0]];
        const [, steps, classes] = probs.dims;
        const decoded = [];
        for (let k = 0; k < n; k++) {
            // Time steps past the crop's own width only see padding
            const usable = Math.min(steps, Math.ceil((steps * widths[k]) / W) + 1);
            decoded.push(ctcDecode(probs.data, k * steps * classes, usable, classes, this.classes));
        }
        disposeAll(out);
        return decoded;
    }

    async release() {
        await this.det?.release?.();
        await this.rec?.release?.();
    }
}

function toBytes(buf) {
    return buf instanceof Uint8Array ? buf : new Uint8Array(buf);
}

function disposeAll(out) {
    for (const t of Object.values(out)) t?.dispose?.();
}

// The DB probability core covers roughly the middle 60 % of a text line's height; scaling it
// back up approximates the font size, which is what pdf.js reports as item height and what the
// layout analysis compares line spacing against.
const CORE_TO_FONT_HEIGHT = 1.6;

// Axis-aligned text box of a region (font-height tall, without the unclip margin)
function tightRect(r) {
    const h = r.thick * CORE_TO_FONT_HEIGHT;
    const hx = Math.abs(r.ux) * r.len / 2 + Math.abs(r.uy) * h / 2;
    return { x: r.cx - hx, y: r.cy - h / 2, w: 2 * hx, h };
}

/**
 * Samples a rotated rectangle (center cx/cy, unit axis ux/uy, len × thick) into a dw × dh RGBA
 * image with bilinear interpolation; pixels outside the source are white.
 */
export function sampleRotated(image, { cx, cy, ux, uy, len, thick }, dw, dh) {
    const { data, width, height } = image;
    const out = new Uint8ClampedArray(dw * dh * 4);
    const vx = -uy, vy = ux;
    for (let y = 0; y < dh; y++) {
        const t = ((y + 0.5) / dh - 0.5) * thick;
        for (let x = 0; x < dw; x++) {
            const s = ((x + 0.5) / dw - 0.5) * len;
            const fx = cx + s * ux + t * vx - 0.5;
            const fy = cy + s * uy + t * vy - 0.5;
            const o = (y * dw + x) * 4;
            out[o + 3] = 255;
            if (fx < 0 || fy < 0 || fx > width - 1 || fy > height - 1) {
                out[o] = out[o + 1] = out[o + 2] = 255;
                continue;
            }
            const x0 = Math.floor(fx), y0 = Math.floor(fy);
            const x1 = Math.min(width - 1, x0 + 1), y1 = Math.min(height - 1, y0 + 1);
            const wx = fx - x0, wy = fy - y0;
            const a = (y0 * width + x0) * 4, b = (y0 * width + x1) * 4;
            const c = (y1 * width + x0) * 4, d = (y1 * width + x1) * 4;
            for (let ch = 0; ch < 3; ch++) {
                const top = data[a + ch] + (data[b + ch] - data[a + ch]) * wx;
                const bot = data[c + ch] + (data[d + ch] - data[c + ch]) * wx;
                out[o + ch] = top + (bot - top) * wy;
            }
        }
    }
    return out;
}

/**
 * Bilinear resize of the source rectangle (sx, sy, sw, sh) of an RGBA image to dw × dh.
 * @returns {Uint8ClampedArray} RGBA
 */
export function resizeRgba(image, sx, sy, sw, sh, dw, dh) {
    const { data, width, height } = image;
    const out = new Uint8ClampedArray(dw * dh * 4);
    const rx = sw / dw;
    const ry = sh / dh;
    for (let y = 0; y < dh; y++) {
        const fy = Math.min(height - 1, Math.max(0, sy + (y + 0.5) * ry - 0.5));
        const y0 = Math.floor(fy);
        const y1 = Math.min(height - 1, y0 + 1);
        const wy = fy - y0;
        for (let x = 0; x < dw; x++) {
            const fx = Math.min(width - 1, Math.max(0, sx + (x + 0.5) * rx - 0.5));
            const x0 = Math.floor(fx);
            const x1 = Math.min(width - 1, x0 + 1);
            const wx = fx - x0;
            const a = (y0 * width + x0) * 4;
            const b = (y0 * width + x1) * 4;
            const c = (y1 * width + x0) * 4;
            const d = (y1 * width + x1) * 4;
            const o = (y * dw + x) * 4;
            for (let ch = 0; ch < 3; ch++) {
                const top = data[a + ch] + (data[b + ch] - data[a + ch]) * wx;
                const bot = data[c + ch] + (data[d + ch] - data[c + ch]) * wx;
                out[o + ch] = top + (bot - top) * wy;
            }
            out[o + 3] = 255;
        }
    }
    return out;
}

/**
 * DB post-processing on the probability map: threshold, connected components, score filter, then
 * one rectangle per component at the page's skew angle, grown ("unclipped") by
 * area·ratio/perimeter to recover the full glyph extent. Returns map coordinates:
 * center (cx, cy), unit text direction (ux, uy), extent along/across it (len, thick) and the
 * margin to add on every side (grow).
 */
export function dbPostprocess(prob, w, h, opt = DEFAULT_OPTIONS) {
    const n = w * h;
    const labels = new Uint8Array(n);
    const stack = new Int32Array(n);
    const members = new Int32Array(n);
    const comps = [];
    let used = 0;
    let top = 0;

    for (let start = 0; start < n; start++) {
        if (labels[start] !== 0 || prob[start] <= opt.binThresh) continue;
        top = 0;
        stack[top++] = start;
        labels[start] = 1;
        const first = used;
        let minX = w, minY = h, maxX = -1, maxY = -1, sum = 0;
        let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;

        while (top > 0) {
            const idx = stack[--top];
            members[used++] = idx;
            const x = idx % w;
            const y = (idx - x) / w;
            sum += prob[idx];
            sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
            // 4-connectivity: diagonal touches between neighbouring lines must not merge them
            if (x > 0) push(idx - 1);
            if (x < w - 1) push(idx + 1);
            if (y > 0) push(idx - w);
            if (y < h - 1) push(idx + w);
        }

        const count = used - first;
        const bw = maxX - minX + 1;
        const bh = maxY - minY + 1;
        if (Math.min(bw, bh) < opt.minBoxSide || sum / count < opt.boxThresh) {
            used = first;
            continue;
        }
        const mx = sx / count, my = sy / count;
        const cxx = sxx / count - mx * mx, cyy = syy / count - my * my, cxy = sxy / count - mx * my;
        comps.push({ first, count, bw, bh, angle: 0.5 * Math.atan2(2 * cxy, cxx - cyy) });
    }

    const angle = pageSkew(comps);
    const ux = Math.cos(angle), uy = Math.sin(angle);

    return comps.map(({ first, count }) => {
        let sMin = Infinity, sMax = -Infinity, tMin = Infinity, tMax = -Infinity;
        for (let i = first; i < first + count; i++) {
            const idx = members[i];
            const x = idx % w;
            const y = (idx - x) / w;
            const s = x * ux + y * uy;
            const t = -x * uy + y * ux;
            if (s < sMin) sMin = s;
            if (s > sMax) sMax = s;
            if (t < tMin) tMin = t;
            if (t > tMax) tMax = t;
        }
        // +1: pixel extents are inclusive
        const len = sMax - sMin + 1;
        const thick = tMax - tMin + 1;
        const sc = (sMin + sMax + 1) / 2, tc = (tMin + tMax + 1) / 2;
        return {
            cx: sc * ux - tc * uy,
            cy: sc * uy + tc * ux,
            ux, uy, len, thick,
            grow: (len * thick * opt.unclipRatio) / (2 * (len + thick)),
        };
    });

    function push(i) {
        if (labels[i] === 0 && prob[i] > opt.binThresh) {
            labels[i] = 1;
            stack[top++] = i;
        }
    }
}

const MAX_SKEW = (10 * Math.PI) / 180;

// Weighted median orientation of the elongated components (text lines); 0 if there are none
export function pageSkew(comps) {
    const lines = comps
        .filter(c => c.bw >= 5 * c.bh && Math.abs(c.angle) <= MAX_SKEW)
        .map(c => ({ angle: c.angle, weight: c.bw }))
        .sort((a, b) => a.angle - b.angle);
    const total = lines.reduce((acc, l) => acc + l.weight, 0);
    let acc = 0;
    for (const l of lines) {
        acc += l.weight;
        if (acc >= total / 2) return l.angle;
    }
    return 0;
}

/** Greedy CTC decoding of one sequence; score is the mean probability of the emitted chars. */
export function ctcDecode(data, offset, steps, classes, alphabet) {
    let text = '';
    let scoreSum = 0;
    let emitted = 0;
    let prev = -1;
    for (let t = 0; t < steps; t++) {
        const row = offset + t * classes;
        let best = 0;
        let bestP = data[row];
        for (let c = 1; c < classes; c++) {
            if (data[row + c] > bestP) { bestP = data[row + c]; best = c; }
        }
        if (best !== 0 && best !== prev) {
            text += alphabet[best] ?? '';
            scoreSum += bestP;
            emitted++;
        }
        prev = best;
    }
    return { text, score: emitted ? scoreSum / emitted : 0 };
}
