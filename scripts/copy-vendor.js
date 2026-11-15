#!/usr/bin/env node
/**
 * Copies the runtime files the app loads at run time from node_modules into public/vendor/,
 * so they are served from the app's own origin (no CDN) and stored by the service worker
 * together with the app:
 *
 * - ONNX Runtime WebAssembly (OCR engine)
 * - pdf.js worker and its image decoders (JBIG2, JPEG 2000, colour profiles)
 *
 * Folder names carry the package version: a cached file can never be paired with the
 * JavaScript of a different version after an upgrade. Runs before dev, build and preview.
 */
import { copyFile, mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const modules = join(root, 'node_modules');
const vendor = join(root, 'public/vendor');

const version = async pkg => JSON.parse(await readFile(join(modules, pkg, 'package.json'), 'utf8')).version;

async function copy(from, toDir, names) {
    await mkdir(toDir, { recursive: true });
    for (const name of names) await copyFile(join(from, name), join(toDir, name));
}

await rm(vendor, { recursive: true, force: true });

const ort = await version('onnxruntime-web');
await copy(join(modules, 'onnxruntime-web/dist'), join(vendor, `ort-${ort}`), [
    'ort-wasm-simd-threaded.wasm',
    'ort-wasm-simd-threaded.mjs',
]);

const pdfjs = await version('pdfjs-dist');
await copy(join(modules, 'pdfjs-dist/build'), join(vendor, `pdfjs-${pdfjs}`), ['pdf.worker.min.mjs']);
await copy(join(modules, 'pdfjs-dist/wasm'), join(vendor, `pdfjs-${pdfjs}/wasm`), [
    'jbig2.wasm', 'jbig2_nowasm_fallback.js',
    'openjpeg.wasm', 'openjpeg_nowasm_fallback.js',
    'qcms_bg.wasm',
]);

console.log(`vendor: onnxruntime-web ${ort}, pdfjs-dist ${pdfjs} → public/vendor/`);
