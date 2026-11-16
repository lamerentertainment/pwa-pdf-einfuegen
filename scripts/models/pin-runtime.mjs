#!/usr/bin/env node
/**
 * Legt die Laufzeit der Sprachmodelle (ONNX Runtime Web mit WebGPU, rund 27 MB) im Modellkatalog
 * fest: Pfad, Grösse und SHA-256 der Dateien in public/vendor. Sie gehört nicht zur App, die beim
 * ersten Aufruf gespeichert wird, sondern wird erst mit dem ersten Sprachmodell geladen.
 *
 *   npm run prebuild && node scripts/models/pin-runtime.mjs   # schreibt models/catalog.json
 *
 * Der Build prüft, dass Katalog und Dateien übereinstimmen (vite.config.js).
 */
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = join(import.meta.dirname, '../..');
const ortPkg = join(root, 'node_modules/@huggingface/transformers/node_modules/onnxruntime-web/package.json');
const version = JSON.parse(await readFile(ortPkg, 'utf8')).version;
const dir = `vendor/ort-${version}`;
const NAMES = ['ort-wasm-simd-threaded.asyncify.mjs', 'ort-wasm-simd-threaded.asyncify.wasm'];

const files = [];
for (const name of NAMES) {
    const buf = await readFile(join(root, 'public', dir, name));
    files.push({
        name,
        role: name.endsWith('.wasm') ? 'Laufzeit (WebAssembly)' : 'Laufzeit (JavaScript)',
        url: `/${dir}/${name}`,
        sha256: createHash('sha256').update(buf).digest('hex'),
        size: buf.length,
    });
}

const path = join(root, 'models/catalog.json');
const catalog = JSON.parse(await readFile(path, 'utf8'));
const entry = {
    id: 'llm-laufzeit',
    name: 'Laufzeit für Sprachmodelle',
    purpose: `ONNX Runtime Web ${version} mit WebGPU, gemeinsam für alle Sprachmodelle. Wird mit dem ersten Sprachmodell geladen und mit dem letzten wieder gelöscht.`,
    license: 'MIT',
    publisher: 'Microsoft (onnxruntime-web)',
    source: `https://www.npmjs.com/package/onnxruntime-web/v/${version}`,
    files,
};
catalog.components = [...(catalog.components ?? []).filter(c => c.id !== entry.id), entry];
await writeFile(path, JSON.stringify(catalog, null, 2) + '\n');
console.log(`llm-laufzeit: onnxruntime-web ${version}, ${(files.reduce((s, f) => s + f.size, 0) / 1e6).toFixed(1)} MB`);
