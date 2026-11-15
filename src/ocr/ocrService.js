// Main-thread facade for the OCR worker. The models are read straight from the browser's model
// store (Cache Storage, filled on the Modelle page) – this file never downloads anything. A model
// that is not installed is reported as missing, so the user decides whether to fetch it.
import { getStatus, MODEL_CACHE, models } from '../models/modelStore.js';
import { parseCharacterDict } from './paddleOcr.js';

export const OCR_MODEL_ID = 'ppocr-v5-latin';
export const LAYOUT_MODEL_ID = 'pp-doclayout-plus-l';
const VENDOR_BASE = '/vendor/';
// Starting the engine takes about a second. If it takes far longer with WASM threads, the thread
// workers most likely never came up: the runtime then waits forever. Restart single-threaded.
const THREADED_INIT_TIMEOUT_MS = 20000;

export class ModelMissingError extends Error {
    constructor(model) {
        super(`Das Modell «${model.name}» ist nicht installiert.`);
        this.name = 'ModelMissingError';
        this.model = model;
    }
}

class InitTimeout extends Error {}

function withTimeout(promise, ms) {
    let timer;
    return Promise.race([
        promise,
        new Promise((_, reject) => { timer = setTimeout(() => reject(new InitTimeout(`no answer after ${ms} ms`)), ms); }),
    ]).finally(() => clearTimeout(timer));
}

const modelById = id => models.find(m => m.id === id);

async function readModelFile(model, name) {
    const file = model.files.find(f => f.name === name);
    const cache = await caches.open(MODEL_CACHE);
    const response = await cache.match(file.url);
    if (!response) throw new ModelMissingError(model);
    return response.arrayBuffer();
}

class OcrService {
    constructor() {
        this.worker = null;
        this.ready = null;
        this.layoutReady = null;
        this.nextId = 0;
        this.pending = new Map();
        this.threads = 1;
    }

    /** Whether a model is fully stored in this browser. */
    async isInstalled(id) {
        try {
            return (await getStatus(modelById(id))) === 'installiert';
        } catch {
            return false;
        }
    }

    /** Loads the OCR models from the browser's store and starts the worker. */
    init() {
        if (!this.ready) {
            this.ready = this.start().catch(err => {
                this.dispose();
                throw err;
            });
        }
        return this.ready;
    }

    async start() {
        const model = modelById(OCR_MODEL_ID);
        const [det, rec, yml] = await Promise.all([
            readModelFile(model, 'det.onnx'),
            readModelFile(model, 'rec.onnx'),
            readModelFile(model, 'rec.yml'),
        ]);
        const dict = parseCharacterDict(new TextDecoder().decode(yml));
        const wasmBase = new URL(VENDOR_BASE, document.baseURI).href;
        const init = { type: 'init', det, rec, dict, wasmBase };
        try {
            this.spawnWorker();
            const { threads } = await withTimeout(this.call(init), THREADED_INIT_TIMEOUT_MS);
            this.threads = threads || 1;
        } catch (error) {
            if (!(error instanceof InitTimeout)) throw error;
            console.warn('OCR engine did not start with WASM threads; retrying single-threaded');
            this.terminateWorker(new Error('OCR restarted single-threaded'));
            this.spawnWorker();
            await this.call({ ...init, threads: 1 });
            this.threads = 1;
        }
    }

    /** Loads the layout model into the worker. Needs init() first. */
    initLayout() {
        if (!this.layoutReady) {
            this.layoutReady = (async () => {
                await this.ready;
                const model = await readModelFile(modelById(LAYOUT_MODEL_ID), 'layout.onnx');
                await this.call({ type: 'initLayout', model }, [model]);
            })().catch(err => {
                this.layoutReady = null;
                throw err;
            });
        }
        return this.layoutReady;
    }

    spawnWorker() {
        this.worker = new Worker(new URL('./ocr.worker.js', import.meta.url), { type: 'module' });
        this.worker.onmessage = ({ data }) => {
            const entry = this.pending.get(data.id);
            if (!entry) return;
            this.pending.delete(data.id);
            if (data.ok) entry.resolve(data);
            else entry.reject(new Error(data.error));
        };
        this.worker.onerror = event => {
            const error = new Error(event.message || 'OCR worker crashed');
            for (const entry of this.pending.values()) entry.reject(error);
            this.pending.clear();
        };
    }

    terminateWorker(reason) {
        this.worker?.terminate();
        this.worker = null;
        for (const entry of this.pending.values()) entry.reject(reason);
        this.pending.clear();
    }

    call(msg, transfer = []) {
        const id = ++this.nextId;
        return new Promise((resolve, reject) => {
            this.pending.set(id, { resolve, reject });
            this.worker.postMessage({ ...msg, id }, transfer);
        });
    }

    /**
     * OCR plus, if `layout` is set and the layout model is loaded, its regions.
     * @param {{data: Uint8ClampedArray, width: number, height: number}} image RGBA; its buffer is
     *   transferred to the worker and unusable afterwards
     * @returns {Promise<{lines: Array, regions: Array|null, ocrMs: number, layoutMs: number|null}>}
     */
    async recognize(image, layout = false) {
        await this.ready;
        const { lines, regions, ocrMs, layoutMs } = await this.call(
            { type: 'recognize', image, layout },
            [image.data.buffer],
        );
        return { lines, regions, ocrMs, layoutMs };
    }

    /** Frees the models' memory; the next init() reads them again from the store. */
    dispose() {
        this.terminateWorker(new Error('OCR stopped'));
        this.ready = null;
        this.layoutReady = null;
    }
}

export default new OcrService();
