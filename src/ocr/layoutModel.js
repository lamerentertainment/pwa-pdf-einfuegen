// PP-DocLayout_plus-L (PaddlePaddle, Apache-2.0): finds layout regions (text, title, header,
// footer, page number, table, ...) on a page image. Optional and experimental: the model is
// ~130 MB and only used when the user has installed it on the Modelle page.
//
// Model I/O (official ONNX export, RT-DETR):
//   in  image        float32 [1, 3, 800, 800]  RGB / 255, stretched to 800×800 (no aspect ratio)
//       im_shape     float32 [1, 2]            [800, 800]
//       scale_factor float32 [1, 2]            [800 / height, 800 / width]
//   out fetch_name_0 float32 [300, 6]          [class, score, x1, y1, x2, y2] in original pixels
//       fetch_name_1 int32   [1]               number of rows (always 300)

export const LAYOUT_INPUT_SIZE = 800;

// label_list from the model's inference.yml, in class-id order
export const LAYOUT_LABELS = [
    'paragraph_title', 'image', 'text', 'number', 'abstract', 'content', 'figure_title', 'formula',
    'table', 'reference', 'doc_title', 'footnote', 'header', 'algorithm', 'footer', 'seal', 'chart',
    'formula_number', 'aside_text', 'reference_content',
];

// Regions whose text is page furniture rather than document content
export const FURNITURE_LABELS = new Set(['header', 'footer', 'number']);

export const LAYOUT_SCORE_THRESHOLD = 0.5;
// Two boxes this similar describe the same region (the model sometimes emits one per class)
const DUPLICATE_IOU = 0.9;

/**
 * RGBA image → normalized planar RGB tensor data, stretched to size×size (bilinear).
 * @param {{data: Uint8ClampedArray, width: number, height: number}} image
 */
export function preprocess(image, size = LAYOUT_INPUT_SIZE) {
    const { data, width, height } = image;
    const plane = size * size;
    const out = new Float32Array(3 * plane);
    const sx = width / size;
    const sy = height / size;
    for (let y = 0; y < size; y++) {
        const fy = Math.min(height - 1, Math.max(0, (y + 0.5) * sy - 0.5));
        const y0 = Math.floor(fy);
        const y1 = Math.min(height - 1, y0 + 1);
        const wy = fy - y0;
        for (let x = 0; x < size; x++) {
            const fx = Math.min(width - 1, Math.max(0, (x + 0.5) * sx - 0.5));
            const x0 = Math.floor(fx);
            const x1 = Math.min(width - 1, x0 + 1);
            const wx = fx - x0;
            const a = (y0 * width + x0) * 4;
            const b = (y0 * width + x1) * 4;
            const c = (y1 * width + x0) * 4;
            const d = (y1 * width + x1) * 4;
            const o = y * size + x;
            for (let ch = 0; ch < 3; ch++) {
                const top = data[a + ch] * (1 - wx) + data[b + ch] * wx;
                const bottom = data[c + ch] * (1 - wx) + data[d + ch] * wx;
                out[ch * plane + o] = (top * (1 - wy) + bottom * wy) / 255;
            }
        }
    }
    return out;
}

function iou(a, b) {
    const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
    const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
    const inter = ix * iy;
    const union = a.w * a.h + b.w * b.h - inter;
    return union > 0 ? inter / union : 0;
}

/**
 * Raw detector rows → regions in image pixels, best first, without near-duplicates.
 * @param {ArrayLike<number>} rows flat [class, score, x1, y1, x2, y2] × n
 * @param {number} cols values per row (6)
 * @returns {Array<{label: string, score: number, x: number, y: number, w: number, h: number}>}
 */
export function postprocess(rows, cols = 6, { threshold = LAYOUT_SCORE_THRESHOLD, width = Infinity, height = Infinity } = {}) {
    const candidates = [];
    for (let i = 0; i + cols <= rows.length; i += cols) {
        const [cls, score, x1, y1, x2, y2] = [rows[i], rows[i + 1], rows[i + 2], rows[i + 3], rows[i + 4], rows[i + 5]];
        if (!(score >= threshold)) continue;
        const left = Math.max(0, x1);
        const top = Math.max(0, y1);
        const right = Math.min(width, x2);
        const bottom = Math.min(height, y2);
        if (right <= left || bottom <= top) continue;
        candidates.push({
            label: LAYOUT_LABELS[Math.round(cls)] ?? `class_${Math.round(cls)}`,
            score,
            x: left, y: top, w: right - left, h: bottom - top,
        });
    }
    candidates.sort((a, b) => b.score - a.score);
    const kept = [];
    for (const c of candidates) {
        if (!kept.some(k => iou(k, c) >= DUPLICATE_IOU)) kept.push(c);
    }
    return kept;
}

/**
 * The region a text line belongs to: the one containing the line's centre, smallest first
 * (a title inside a text block wins over the block).
 */
export function regionOfLine(line, regions) {
    const cx = line.x + line.w / 2;
    const cy = line.y + line.h / 2;
    let best = null;
    for (const r of regions) {
        if (cx >= r.x && cx <= r.x + r.w && cy >= r.y && cy <= r.y + r.h) {
            if (!best || r.w * r.h < best.w * best.h) best = r;
        }
    }
    return best;
}

/** Drops OCR lines that lie in a region with one of the given labels. */
export function dropLinesInRegions(lines, regions, labels = FURNITURE_LABELS) {
    const drop = regions.filter(r => labels.has(r.label));
    if (drop.length === 0) return lines;
    return lines.filter(line => {
        const region = regionOfLine(line, regions);
        return !region || !labels.has(region.label);
    });
}

export class LayoutModel {
    constructor(ort, session) {
        this.ort = ort;
        this.session = session;
    }

    /** @param {ArrayBuffer|Uint8Array} model ONNX bytes */
    static async create(ort, model, sessionOptions = {}) {
        const bytes = model instanceof Uint8Array ? model : new Uint8Array(model);
        const session = await ort.InferenceSession.create(bytes, {
            graphOptimizationLevel: 'all',
            logSeverityLevel: 3,
            ...sessionOptions,
        });
        return new LayoutModel(ort, session);
    }

    /** @returns {Promise<Array>} regions in image pixels (see postprocess) */
    async detect(image) {
        const { ort } = this;
        const size = LAYOUT_INPUT_SIZE;
        const feeds = {
            image: new ort.Tensor('float32', preprocess(image, size), [1, 3, size, size]),
            im_shape: new ort.Tensor('float32', new Float32Array([size, size]), [1, 2]),
            scale_factor: new ort.Tensor('float32', new Float32Array([size / image.height, size / image.width]), [1, 2]),
        };
        const out = await this.session.run(feeds);
        const boxes = out.fetch_name_0 ?? out[this.session.outputNames[0]];
        const regions = postprocess(boxes.data, boxes.dims[1], { width: image.width, height: image.height });
        for (const tensor of Object.values(out)) tensor.dispose?.();
        return regions;
    }

    async release() {
        await this.session.release?.();
    }
}
