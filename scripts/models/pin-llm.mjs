#!/usr/bin/env node
/**
 * Legt die Dateien der Sprachmodelle (Stufe 3) im Modellkatalog fest: feste Revision (Commit),
 * Grösse und SHA-256 jeder Datei. Grosse Dateien (Git LFS) bringen ihre SHA-256 von Hugging Face
 * mit; kleine Dateien werden heruntergeladen und hier gehasht.
 *
 *   node scripts/models/pin-llm.mjs           # schreibt models/catalog.json
 *
 * Geladen wird nur der Textteil: Konfiguration, Tokenizer und die ONNX-Dateien des gewählten
 * Datentyps (Bild- und Audio-Encoder der multimodalen Gemma-4-Modelle werden nicht gebraucht).
 */
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = join(import.meta.dirname, '../..');
const HF = 'https://huggingface.co';

// Kleine Dateien, die transformers.js für ein Textmodell liest
const CONFIG_FILES = ['config.json', 'generation_config.json', 'tokenizer.json', 'tokenizer_config.json', 'chat_template.jinja', 'special_tokens_map.json'];

const LLMS = [
    {
        id: 'gemma-3-1b',
        repo: 'onnx-community/gemma-3-1b-it-ONNX',
        modelClass: 'AutoModelForCausalLM',
        dtype: 'q4f16',
        onnx: ['onnx/model_q4f16.onnx', 'onnx/model_q4f16.onnx_data'],
    },
    {
        id: 'gemma-4-e2b',
        repo: 'onnx-community/gemma-4-E2B-it-ONNX',
        modelClass: 'Gemma4ForCausalLM',
        dtype: 'q4f16',
        onnx: [
            'onnx/embed_tokens_q4f16.onnx', 'onnx/embed_tokens_q4f16.onnx_data',
            'onnx/decoder_model_merged_q4f16.onnx', 'onnx/decoder_model_merged_q4f16.onnx_data',
        ],
    },
    {
        id: 'gemma-4-e4b',
        repo: 'onnx-community/gemma-4-E4B-it-ONNX',
        modelClass: 'Gemma4ForCausalLM',
        dtype: 'q4f16',
        onnx: [
            'onnx/embed_tokens_q4f16.onnx', 'onnx/embed_tokens_q4f16.onnx_data',
            'onnx/decoder_model_merged_q4f16.onnx', 'onnx/decoder_model_merged_q4f16.onnx_data',
            'onnx/decoder_model_merged_q4f16.onnx_data_1',
        ],
    },
];

async function json(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    return res.json();
}

async function pin(llm) {
    const info = await json(`${HF}/api/models/${llm.repo}?blobs=true`);
    const revision = info.sha;
    const siblings = new Map(info.siblings.map(s => [s.rfilename, s]));
    const names = [...CONFIG_FILES.filter(n => siblings.has(n)), ...llm.onnx];
    const files = [];
    for (const name of names) {
        const sibling = siblings.get(name);
        if (!sibling) throw new Error(`${llm.repo}: ${name} fehlt`);
        const url = `${HF}/${llm.repo}/resolve/${revision}/${name}`;
        let { sha256, size } = sibling.lfs ?? {};
        if (!sha256) {
            const res = await fetch(url);
            if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
            const buf = Buffer.from(await res.arrayBuffer());
            sha256 = createHash('sha256').update(buf).digest('hex');
            size = buf.length;
        }
        files.push({ name, role: name.startsWith('onnx/') ? 'Modellgewichte' : 'Konfiguration/Tokenizer', url, sha256, size });
    }
    return {
        revision,
        license: { 'apache-2.0': 'Apache-2.0', gemma: 'Gemma-Nutzungsbedingungen' }[info.cardData?.license] ?? info.cardData?.license ?? 'siehe Quelle',
        files,
        runtime: { library: 'transformers.js', repo: llm.repo, revision, modelClass: llm.modelClass, dtype: llm.dtype, device: 'webgpu' },
    };
}

const path = join(root, 'models/catalog.json');
const catalog = JSON.parse(await readFile(path, 'utf8'));
for (const llm of LLMS) {
    const entry = catalog.models.find(m => m.id === llm.id);
    if (!entry) throw new Error(`Katalog hat keinen Eintrag ${llm.id} (Beschreibung zuerst von Hand anlegen)`);
    const pinned = await pin(llm);
    entry.license = pinned.license;
    entry.source = `${HF}/${llm.repo}`;
    entry.runtime = pinned.runtime;
    entry.files = pinned.files;
    const total = pinned.files.reduce((s, f) => s + f.size, 0);
    console.log(`${llm.id}: ${pinned.files.length} Dateien, ${(total / 1e9).toFixed(2)} GB, Revision ${pinned.revision.slice(0, 7)}`);
}
await writeFile(path, JSON.stringify(catalog, null, 2) + '\n');
