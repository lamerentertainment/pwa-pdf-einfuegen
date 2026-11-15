// Runs PP-OCRv5 (and optionally the PP-DocLayout layout model) off the main thread.
// Protocol (all messages carry an `id`):
//   → { id, type: 'init', det, rec, dict, wasmBase, threads? }   ← { id, ok: true, threads }
//   → { id, type: 'initLayout', model }                ← { id, ok: true }
//   → { id, type: 'disposeLayout' }                    ← { id, ok: true }
//   → { id, type: 'recognize', image: {data, width, height}, layout?: boolean }
//       ← { id, ok: true, lines, regions, ocrMs, layoutMs }
//   errors come back as { id, ok: false, error }
// CPU-only build: the models are small, and it avoids loading the WebGPU (jsep) runtime
import * as ort from 'onnxruntime-web/wasm';
import { PaddleOcr } from './paddleOcr.js';
import { LayoutModel } from './layoutModel.js';

let engine = null;
let layout = null;

self.onmessage = async ({ data: msg }) => {
    try {
        if (msg.type === 'init') {
            if (!engine) {
                // Local, versioned copy of the runtime (scripts/copy-vendor.js): no CDN, and a
                // cached .wasm can never be paired with the JS of a different runtime version
                ort.env.wasm.wasmPaths = `${msg.wasmBase}ort-${ort.env.versions.web}/`;
                // Threads need SharedArrayBuffer, i.e. a cross-origin isolated page
                // (msg.threads forces a count: the service retries with 1 if threads hang)
                ort.env.wasm.numThreads = msg.threads ?? (self.crossOriginIsolated
                    ? Math.min(4, self.navigator.hardwareConcurrency || 1)
                    : 1);
                engine = await PaddleOcr.create(ort, msg, { executionProviders: ['wasm'] });
            }
            self.postMessage({ id: msg.id, ok: true, threads: ort.env.wasm.numThreads });
        } else if (msg.type === 'initLayout') {
            if (!engine) throw new Error('OCR engine not initialized');
            if (!layout) layout = await LayoutModel.create(ort, msg.model, { executionProviders: ['wasm'] });
            self.postMessage({ id: msg.id, ok: true });
        } else if (msg.type === 'disposeLayout') {
            await layout?.release();
            layout = null;
            self.postMessage({ id: msg.id, ok: true });
        } else if (msg.type === 'recognize') {
            if (!engine) throw new Error('OCR engine not initialized');
            let regions = null;
            let layoutMs = null;
            if (msg.layout && layout) {
                const t = performance.now();
                regions = await layout.detect(msg.image);
                layoutMs = performance.now() - t;
            }
            const t = performance.now();
            const lines = await engine.recognize(msg.image, msg.options);
            const ocrMs = performance.now() - t;
            self.postMessage({ id: msg.id, ok: true, lines, regions, ocrMs, layoutMs });
        } else {
            throw new Error(`Unknown message type: ${msg.type}`);
        }
    } catch (error) {
        self.postMessage({ id: msg.id, ok: false, error: error?.message || String(error) });
    }
};
