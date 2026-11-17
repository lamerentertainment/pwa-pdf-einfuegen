// Seitenseite des Sprachmodell-Workers: Modell laden, Text erzeugen (gestreamt), abbrechen.
import { getStatus, models } from '../models/modelStore.js';

export const LLM_MODELS = models.filter(model => model.stage === 3);
const VENDOR_BASE = '/vendor/';

/** Setzt den Eingabetext in einen Prompt ein ({{INPUT}}). */
export function fillPrompt(template, input) {
    return template.includes('{{INPUT}}') ? template.split('{{INPUT}}').join(input.trim()) : `${template.trim()}\n\n${input.trim()}`;
}

/** Prüft, ob der Browser WebGPU mit 16-Bit-Gleitkomma (für die 4-Bit-Modelle) bereitstellt. */
export async function checkWebGPU() {
    if (!navigator.gpu) return { ok: false, reason: 'Dieser Browser unterstützt kein WebGPU.' };
    try {
        const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
        if (!adapter) return { ok: false, reason: 'WebGPU ist vorhanden, aber keine Grafikkarte verfügbar.' };
        if (!adapter.features.has('shader-f16')) {
            return { ok: false, reason: 'Die Grafikkarte unterstützt kein 16-Bit-Rechnen (shader-f16), das die Modelle brauchen.' };
        }
        const info = adapter.info ?? {};
        return { ok: true, name: [info.vendor, info.architecture || info.description].filter(Boolean).join(' ') };
    } catch (err) {
        return { ok: false, reason: `WebGPU nicht verfügbar: ${err.message}` };
    }
}

export async function installedLlms() {
    const result = [];
    for (const model of LLM_MODELS) if ((await getStatus(model)) === 'installiert') result.push(model);
    return result;
}

class LlmService {
    constructor() {
        this.worker = null;
        this.nextId = 0;
        this.handlers = new Map();
        this.loadedId = null;
    }

    ensureWorker() {
        if (this.worker) return;
        this.worker = new Worker(new URL('./llm.worker.js', import.meta.url), { type: 'module' });
        this.worker.onmessage = ({ data }) => this.handlers.get(data.id)?.(data);
        this.worker.onerror = event => {
            const error = event.message || 'Der Sprachmodell-Worker ist abgestürzt.';
            for (const handler of this.handlers.values()) handler({ type: 'error', error });
            this.handlers.clear();
            this.worker = null;
            this.loadedId = null;
        };
    }

    /** Schickt eine Nachricht und sammelt Zwischenmeldungen, bis eine der Endmeldungen kommt. */
    request(message, onEvent, endTypes) {
        this.ensureWorker();
        const id = ++this.nextId;
        return new Promise((resolve, reject) => {
            this.handlers.set(id, data => {
                if (data.type === 'error') {
                    this.handlers.delete(id);
                    reject(new Error(data.error));
                } else if (endTypes.includes(data.type)) {
                    this.handlers.delete(id);
                    resolve(data);
                } else {
                    onEvent?.(data);
                }
            });
            this.worker.postMessage({ ...message, id });
        });
    }

    /** Lädt ein installiertes Modell in den Grafikspeicher. */
    async load(model, onProgress) {
        if (this.loadedId === model.id) return { ms: 0 };
        this.loadedId = null;
        const wasmBase = new URL(VENDOR_BASE, document.baseURI).href;
        // Einfache Kopie: reaktive Vue-Objekte lassen sich nicht an den Worker schicken
        const runtime = JSON.parse(JSON.stringify(model.runtime));
        const result = await this.request({ type: 'load', runtime, wasmBase }, onProgress, ['loaded']);
        this.loadedId = model.id;
        return result;
    }

    generate(prompt, { onToken, maxNewTokens } = {}) {
        return this.request({ type: 'generate', prompt, maxNewTokens }, data => data.type === 'token' && onToken?.(data.text), ['done']);
    }

    stop() {
        this.worker?.postMessage({ type: 'stop' });
    }

    /** Gibt den Grafikspeicher frei (Worker beenden ist am gründlichsten). */
    unload() {
        this.worker?.terminate();
        this.worker = null;
        this.handlers.clear();
        this.loadedId = null;
    }
}

export default new LlmService();
