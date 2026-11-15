// Führt ein lokales Sprachmodell (transformers.js, WebGPU) in einem eigenen Thread aus.
//
// Die Modelldateien kommen ausschliesslich aus dem geprüften Modellspeicher des Browsers
// (Cache Storage, gefüllt auf der Seite «Modelle»): transformers.js darf nichts aus dem Netz laden
// und nichts selbst speichern. Fehlt eine Datei, schlägt das Laden mit einer Meldung fehl.
//
// Protokoll (jede Nachricht trägt eine id):
//   → { type: 'load', runtime, wasmBase }        ← { type: 'progress', … } … { type: 'loaded', ms }
//   → { type: 'generate', prompt, maxNewTokens }  ← { type: 'token', text } … { type: 'done', text, tokens, ms }
//   → { type: 'stop' }                            (bricht eine laufende Erzeugung ab)
//   → { type: 'unload' }                          ← { type: 'unloaded' }
//   Fehler kommen als { type: 'error', error }
import {
    AutoModelForCausalLM, AutoTokenizer, env, Gemma4ForCausalLM, InterruptableStoppingCriteria, TextStreamer,
} from '@huggingface/transformers';
import { resolvePinned } from './pinned.js';

const MODEL_CACHE = 'models-v1'; // gleich wie in src/models/modelStore.js
const MODEL_CLASSES = { AutoModelForCausalLM, Gemma4ForCausalLM };

env.allowLocalModels = false;
// «Entfernt» ist formal erlaubt (transformers.js verlangt eine Quelle), aber env.fetch unten
// liefert nur aus dem lokalen Modellspeicher: transformers.js erreicht das Netz nie.
env.allowRemoteModels = true;
env.useBrowserCache = false;
env.useCustomCache = true;
// Revision des gerade geladenen Modells: transformers.js 4.3.2 fragt einzelne Dateien
// (get_file_metadata für tokenizer_config.json) unter «main» statt der angegebenen Revision ab.
// Solche Anfragen beantwortet der Cache mit der festgelegten, geprüften Revision.
let pinned = null; // { repo, revision }

env.customCache = {
    async match(request) {
        const cache = await caches.open(MODEL_CACHE);
        return cache.match(resolvePinned(typeof request === 'string' ? request : request.url, pinned));
    },
    // Gespeichert wird nur über die Modellverwaltung (mit Prüfsumme), nie von transformers.js
    async put() {},
};
env.fetch = async url => {
    const cache = await caches.open(MODEL_CACHE);
    const hit = await cache.match(resolvePinned(String(url), pinned));
    return hit ?? new Response(null, { status: 404, statusText: 'Nicht im lokalen Modellspeicher' });
};
// Die Laufzeit nicht als Blob-URL laden (verbietet die Content Security Policy)
env.useWasmCache = false;

let loaded = null; // { key, tokenizer, model }
const stopping = new InterruptableStoppingCriteria();

const post = (id, message) => self.postMessage({ id, ...message });

async function load(id, { runtime, wasmBase }) {
    const key = `${runtime.repo}@${runtime.revision}:${runtime.dtype}`;
    if (loaded?.key === key) {
        post(id, { type: 'loaded', ms: 0 });
        return;
    }
    await unload();
    // Versionierte Kopie der ONNX Runtime aus /vendor (scripts/copy-vendor.js), nicht vom CDN
    const version = env.backends.onnx.versions.web;
    env.backends.onnx.wasm.wasmPaths = {
        mjs: `${wasmBase}ort-${version}/ort-wasm-simd-threaded.asyncify.mjs`,
        wasm: `${wasmBase}ort-${version}/ort-wasm-simd-threaded.asyncify.wasm`,
    };
    pinned = { repo: runtime.repo, revision: runtime.revision };
    const started = performance.now();
    const options = {
        revision: runtime.revision,
        progress_callback: info => {
            if (info.status === 'progress' || info.status === 'progress_total') {
                post(id, { type: 'progress', file: info.file, progress: info.progress ?? null });
            }
        },
    };
    const tokenizer = await AutoTokenizer.from_pretrained(runtime.repo, options);
    const Model = MODEL_CLASSES[runtime.modelClass];
    if (!Model) throw new Error(`Unbekannte Modellklasse ${runtime.modelClass}`);
    const model = await Model.from_pretrained(runtime.repo, { ...options, dtype: runtime.dtype, device: runtime.device });
    loaded = { key, tokenizer, model };
    post(id, { type: 'loaded', ms: performance.now() - started });
}

async function generate(id, { prompt, maxNewTokens = 2048 }) {
    if (!loaded) throw new Error('Kein Modell geladen.');
    const { tokenizer, model } = loaded;
    const inputs = tokenizer.apply_chat_template([{ role: 'user', content: prompt }], {
        add_generation_prompt: true,
        return_dict: true,
    });
    const promptTokens = inputs.input_ids.dims.at(-1);
    const streamer = new TextStreamer(tokenizer, {
        skip_prompt: true,
        skip_special_tokens: true,
        callback_function: text => post(id, { type: 'token', text }),
    });
    stopping.reset();
    const started = performance.now();
    const output = await model.generate({
        ...inputs,
        max_new_tokens: maxNewTokens,
        // Feste statt zufällige Wortwahl: gleicher Text, gleiches Ergebnis
        do_sample: false,
        streamer,
        stopping_criteria: stopping,
    });
    const generated = output.slice(null, [promptTokens, null]);
    const text = tokenizer.batch_decode(generated, { skip_special_tokens: true })[0];
    post(id, {
        type: 'done',
        text,
        promptTokens,
        tokens: generated.dims.at(-1),
        ms: performance.now() - started,
        stopped: stopping.interrupted,
    });
}

async function unload() {
    if (!loaded) return;
    await loaded.model.dispose?.();
    loaded = null;
}

self.onmessage = async ({ data: msg }) => {
    try {
        if (msg.type === 'load') await load(msg.id, msg);
        else if (msg.type === 'generate') await generate(msg.id, msg);
        else if (msg.type === 'stop') stopping.interrupt();
        else if (msg.type === 'unload') {
            await unload();
            post(msg.id, { type: 'unloaded' });
        } else throw new Error(`Unbekannte Nachricht: ${msg.type}`);
    } catch (error) {
        post(msg.id, { type: 'error', error: error?.message || String(error) });
    }
};
