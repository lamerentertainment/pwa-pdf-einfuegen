// Verwaltung der lokalen Modelle: laden, prüfen, löschen.
//
// Was überhaupt geladen werden kann, steht in models/catalog.json (feste Revision, SHA-256).
// Modelle werden nur auf Knopfdruck geladen, nur im Modus «verbunden», und erst gespeichert,
// wenn ihre Prüfsumme stimmt. Der Torwächter liefert sie danach ohne Netz aus.
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
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

/**
 * SHA-256 über einen Datenstrom, Stück für Stück: auch mehrere Gigabyte grosse Modelldateien
 * müssen so nie ganz im Arbeitsspeicher liegen.
 */
export async function hashStream(stream, onBytes) {
    const hasher = sha256.create();
    const reader = stream.getReader();
    let received = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        hasher.update(value);
        received += value.byteLength;
        onBytes?.(received);
    }
    return bytesToHex(hasher.digest());
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
    const { usage, quota } = await storageInfo();
    if (quota && total > quota - usage) {
        throw new Error(`Zu wenig Speicher im Browser: ${formatBytes(total)} nötig, ${formatBytes(quota - usage)} frei.`);
    }
    // Grosse Modelle: den Browser bitten, sie nicht von sich aus zu löschen
    if (total > 200e6) await requestPersistence();

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
        // Ein Strom geht direkt in den Speicher, der andere durch die Prüfsumme
        const [toCache, toHash] = response.body.tee();
        const stored = cache.put(file.url, new Response(toCache, {
            headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(file.size) },
        }));
        let actual;
        try {
            [actual] = await Promise.all([
                hashStream(toHash, n => onProgress?.(Math.min(1, (done + n) / total))),
                stored,
            ]);
        } catch (err) {
            await cache.delete(file.url);
            throw err;
        }
        if (actual !== file.sha256) {
            await cache.delete(file.url);
            throw new Error(`${file.name}: Die Prüfsumme stimmt nicht. Die Datei wurde verworfen.`);
        }
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
        if (!response || (await hashStream(response.body)) !== file.sha256) broken.push(file.name);
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
