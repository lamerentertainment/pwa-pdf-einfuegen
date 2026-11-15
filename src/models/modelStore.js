// Verwaltung der lokalen Modelle: laden, prüfen, löschen.
//
// Was überhaupt geladen werden kann, steht in models/catalog.json (feste Revision, SHA-256).
// Modelle werden nur auf Knopfdruck geladen, nur im Modus «verbunden», und erst gespeichert,
// wenn ihre Prüfsumme stimmt. Der Torwächter liefert sie danach ohne Netz aus.
import catalog from '../../models/catalog.json';
import { isBlocked } from '../net/connection.js';

export const MODEL_CACHE = 'models-v1'; // gleich wie in public/sw.js
export const models = catalog.models;

export function modelSize(model) {
    return model.files.reduce((sum, file) => sum + file.size, 0);
}

export function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
    if (bytes < 1e6) return `${Math.max(1, Math.round(bytes / 1e3))} kB`;
    if (bytes < 1e9) return `${(bytes / 1e6).toFixed(bytes < 1e7 ? 1 : 0)} MB`;
    return `${(bytes / 1e9).toFixed(1)} GB`;
}

export async function sha256Hex(data) {
    const digest = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}

/** Liest eine Antwort vollständig und meldet dabei die gelesenen Bytes. */
export async function readWithProgress(response, onBytes) {
    if (!response.body) {
        const buffer = new Uint8Array(await response.arrayBuffer());
        onBytes?.(buffer.byteLength);
        return buffer;
    }
    const reader = response.body.getReader();
    const chunks = [];
    let received = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.byteLength;
        onBytes?.(received);
    }
    const result = new Uint8Array(received);
    let offset = 0;
    for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return result;
}

/** @returns {Promise<'installiert'|'unvollstaendig'|'fehlt'>} */
export async function getStatus(model) {
    const cache = await caches.open(MODEL_CACHE);
    const present = await Promise.all(model.files.map(file => cache.match(file.url)));
    const count = present.filter(Boolean).length;
    if (count === 0) return 'fehlt';
    return count === model.files.length ? 'installiert' : 'unvollstaendig';
}

export async function download(model, { onProgress, signal } = {}) {
    const total = modelSize(model);
    const cache = await caches.open(MODEL_CACHE);
    let done = 0;
    for (const file of model.files) {
        if (await cache.match(file.url)) {
            done += file.size;
            onProgress?.(done / total);
            continue;
        }
        // no-store: das Modell soll nicht ein zweites Mal im HTTP-Cache des Browsers liegen
        const response = await fetch(file.url, { signal, cache: 'no-store' });
        if (isBlocked(response)) throw new Error('Die App ist im Modus «lokal». Bitte zuerst verbinden.');
        if (!response.ok) throw new Error(`${file.name}: Server antwortet mit ${response.status}.`);
        const bytes = await readWithProgress(response, n => onProgress?.(Math.min(1, (done + n) / total)));
        const actual = await sha256Hex(bytes);
        if (actual !== file.sha256) {
            throw new Error(`${file.name}: Die Prüfsumme stimmt nicht. Die Datei wurde verworfen.`);
        }
        await cache.put(file.url, new Response(bytes, {
            headers: {
                'Content-Type': 'application/octet-stream',
                'Content-Length': String(bytes.byteLength),
                'X-Sha256': actual,
            },
        }));
        done += file.size;
        onProgress?.(done / total);
    }
}

/** Prüft die gespeicherten Dateien erneut gegen den Katalog. Liefert die fehlerhaften Dateinamen. */
export async function verify(model) {
    const cache = await caches.open(MODEL_CACHE);
    const broken = [];
    for (const file of model.files) {
        const response = await cache.match(file.url);
        if (!response || (await sha256Hex(await response.arrayBuffer())) !== file.sha256) broken.push(file.name);
    }
    return broken;
}

export async function remove(model) {
    const cache = await caches.open(MODEL_CACHE);
    await Promise.all(model.files.map(file => cache.delete(file.url)));
}

export async function storageInfo() {
    const estimate = (await navigator.storage?.estimate?.()) ?? {};
    const persisted = (await navigator.storage?.persisted?.()) ?? false;
    return { usage: estimate.usage ?? 0, quota: estimate.quota ?? 0, persisted };
}

/** Bittet den Browser, die gespeicherten Modelle nicht von sich aus zu löschen. */
export async function requestPersistence() {
    return (await navigator.storage?.persist?.()) ?? false;
}
