/*
 * Torwächter der App (Service Worker).
 *
 * Jede Anfrage der App läuft hier durch. Was im Browser gespeichert ist (App-Dateien, geladene
 * Modelle), wird ohne Netz geliefert. Alles andere entscheiden die Regeln in sw-policy.js:
 * im Modus «lokal» wird es blockiert, im Modus «verbunden» nur zu freigegebenen Zielen erlaubt.
 * Jede Anfrage, die nicht aus dem Speicher kommt, landet im Verbindungsprotokoll.
 *
 * Updates: Eine neue App-Version wird nur installiert, wenn der Nutzer sie angefordert hat.
 * Der Browser prüft sw.js von sich aus gelegentlich (höchstens etwa einmal pro Tag); findet er
 * dabei eine neue Version, verwirft dieser Service Worker sie und schreibt das ins Protokoll.
 */
importScripts('/sw-policy.js');

// Beim Build eingesetzt (vite.config.js): Version und Liste aller App-Dateien
const BUILD = /* inject:build */ null || { version: 'dev', id: 'dev' };
const PRECACHE = /* inject:precache */ [];

const APP_CACHE = `app-${BUILD.id}`;
const MODEL_CACHE = 'models-v1'; // gleich wie in src/models/modelStore.js
const DB_NAME = 'pwa-pdf-einfuegen';
const LOG_LIMIT = 500;
const UPDATE_WINDOW_MS = 5 * 60 * 1000;
// Antworten aus dem Speicher ohne Rücksicht auf "Vary" (z. B. "Vary: Origin" des Vite-Servers)
const MATCH = { ignoreVary: true };

// --- IndexedDB: Modus, Update-Freigabe und Verbindungsprotokoll ------------------------------

let dbPromise;
function db() {
    dbPromise ||= new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = () => {
            request.result.createObjectStore('state');
            request.result.createObjectStore('netlog', { keyPath: 'id', autoIncrement: true });
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => { dbPromise = null; reject(request.error); };
    });
    return dbPromise;
}

async function tx(store, mode, fn) {
    const database = await db();
    return new Promise((resolve, reject) => {
        const transaction = database.transaction(store, mode);
        const request = fn(transaction.objectStore(store));
        transaction.oncomplete = () => resolve(request ? request.result : undefined);
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
    });
}

const getState = key => tx('state', 'readonly', store => store.get(key));
const setState = (key, value) => tx('state', 'readwrite', store => store.put(value, key));

// Zuletzt gelesener Modus im Arbeitsspeicher: Für die Prüfung der internen KI muss der
// fetch-Handler sofort entscheiden, ohne auf die Datenbank zu warten (siehe passThrough in
// sw-policy.js). Nach einem Neustart des Service Workers ist er leer und gilt als «lokal»; die
// Seite weckt den Torwächter deshalb vor der Prüfung mit GET_STATUS.
let modeMemo = null;

async function currentMode() {
    const mode = swPolicy.effectiveMode(await getState('mode'), Date.now());
    modeMemo = mode;
    return mode;
}

async function broadcast(message) {
    const clients = await self.clients.matchAll({ includeUncontrolled: true });
    for (const client of clients) client.postMessage(message);
}

async function log(entry) {
    const full = { ts: Date.now(), ...entry };
    try {
        full.id = await tx('netlog', 'readwrite', store => store.add(full));
        await tx('netlog', 'readwrite', store => {
            const count = store.count();
            count.onsuccess = () => {
                let surplus = count.result - LOG_LIMIT;
                if (surplus <= 0) return;
                store.openCursor().onsuccess = event => {
                    const cursor = event.target.result;
                    if (cursor && surplus-- > 0) {
                        cursor.delete();
                        cursor.continue();
                    }
                };
            };
        });
    } catch (err) {
        console.warn('Verbindungsprotokoll nicht gespeichert:', err);
    }
    await broadcast({ type: 'NETLOG', entry: full });
}

// --- Antworten -------------------------------------------------------------------------------

// Die Seite ist "cross-origin isolated" (für WASM-Threads der OCR). Gespeicherte Antworten
// erhalten deshalb dieselben Header, die auch der Server schickt.
function withIsolationHeaders(response, sameOrigin) {
    if (!response || response.type === 'opaque' || response.headers.has('Cross-Origin-Embedder-Policy')) {
        return response;
    }
    const headers = new Headers(response.headers);
    headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
    headers.set('Cross-Origin-Opener-Policy', 'same-origin');
    if (sameOrigin) headers.set('Cross-Origin-Resource-Policy', 'same-origin');
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function blockedResponse(request, verdict) {
    const headers = { 'X-Torwaechter': 'blockiert', 'Cache-Control': 'no-store' };
    if (request.mode === 'navigate') {
        const html = `<!doctype html><meta charset="utf-8"><title>Blockiert</title>
<p style="font-family:system-ui;margin:2rem">Blockiert: ${verdict.reason}.<br><a href="/">Zurück zur App</a></p>`;
        return new Response(html, { status: 503, headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8' } });
    }
    return new Response(`Blockiert: ${verdict.reason}`, {
        status: 503,
        headers: { ...headers, 'Content-Type': 'text/plain; charset=utf-8' },
    });
}

async function handle(request) {
    const url = new URL(request.url);
    const sameOrigin = url.origin === self.location.origin;

    if (request.method === 'GET') {
        // Die App hat nur eine Seite: jede Navigation innerhalb der App ist index.html
        const cached = sameOrigin && request.mode === 'navigate'
            ? await caches.match('/index.html', MATCH)
            : await caches.match(request, MATCH);
        if (cached) return withIsolationHeaders(cached, sameOrigin);
    }

    const { mode } = await currentMode();
    const verdict = swPolicy.decide({ url: request.url, origin: self.location.origin, method: request.method, mode });
    const entry = { kind: 'netz', url: request.url, method: request.method, purpose: verdict.purpose, label: verdict.label };

    if (!verdict.allow) {
        await log({ ...entry, allow: false, reason: verdict.reason });
        return blockedResponse(request, verdict);
    }
    try {
        const response = await fetch(request);
        await log({ ...entry, allow: true, status: response.status, reason: verdict.reason });
        return response;
    } catch (err) {
        await log({ ...entry, allow: true, status: 0, reason: `Netzwerkfehler: ${err.message}` });
        return Response.error();
    }
}

self.addEventListener('fetch', event => {
    const { request } = event;
    const mode = swPolicy.effectiveMode(modeMemo, Date.now()).mode;
    if (swPolicy.passThrough({ url: request.url, method: request.method, mode })) {
        // Kein respondWith: Der Browser führt die Anfrage für die Seite aus (Rückfrage «Lokales Netzwerk»)
        const verdict = swPolicy.decide({ url: request.url, origin: self.location.origin, method: request.method, mode });
        event.waitUntil(log({
            kind: 'netz', url: request.url, method: request.method, purpose: verdict.purpose, label: verdict.label,
            allow: true, reason: 'Verbunden-Modus, direkt von der Seite (Chrome-Berechtigung «Lokales Netzwerk»)',
        }));
        return;
    }
    event.respondWith(handle(request));
});

// --- Installation und Updates ----------------------------------------------------------------

// Chrome startet bei einem «kalten» Service Worker die Seitenanfrage vorsorglich parallel übers
// Netz (ServiceWorkerAutoPreload), auch wenn die Antwort danach aus dem Speicher kommt. Eine
// statische Route beantwortet den Aufruf der App direkt aus dem App-Speicher, ganz ohne Netz.
// Browser ohne diese Funktion (Firefox, Safari) kennen auch die Vorab-Anfrage nicht.
function addStaticRoutes(event) {
    if (typeof event.addRoutes !== 'function' || typeof URLPattern !== 'function') return;
    return event.addRoutes([{
        condition: { requestMode: 'navigate', urlPattern: new URLPattern({ pathname: '/{index.html}?' }) },
        source: { cacheName: APP_CACHE },
    }]).catch(err => console.warn('Statische Route nicht gesetzt:', err));
}

self.addEventListener('install', event => {
    const routes = addStaticRoutes(event);
    event.waitUntil((async () => {
        await routes;
        const isUpdate = Boolean(self.registration.active);
        if (isUpdate) {
            const requested = await getState('updateRequested');
            if (!requested || requested.until < Date.now()) {
                await log({
                    kind: 'app',
                    allow: false,
                    purpose: 'app-update',
                    label: `Neue App-Version (${BUILD.id.slice(0, 7)})`,
                    reason: 'Der Browser hat von sich aus nach einer neuen Version gesucht. '
                        + 'Sie wurde nicht angefordert und deshalb verworfen.',
                });
                throw new Error('Update nicht angefordert');
            }
        }
        const cache = await caches.open(APP_CACHE);
        // cache: 'reload' umgeht den HTTP-Cache, damit wirklich die Dateien dieser Version landen
        await cache.addAll(PRECACHE.map(path => new Request(path, { cache: 'reload' })));
        await setState('updateRequested', null);
        await log({
            kind: 'app',
            allow: true,
            purpose: 'app-update',
            label: isUpdate ? 'App-Update' : 'Erstinstallation',
            reason: `Version ${BUILD.version} (${BUILD.id.slice(0, 7)}) gespeichert, ${PRECACHE.length} Dateien`,
        });
        // Erstinstallation sofort aktiv; ein Update wartet, bis der Nutzer «Neu laden» wählt
        if (!isUpdate) await self.skipWaiting();
    })());
});

self.addEventListener('activate', event => {
    event.waitUntil((async () => {
        for (const key of await caches.keys()) {
            if (key.startsWith('app-') && key !== APP_CACHE) await caches.delete(key);
        }
        await self.clients.claim();
        await broadcast({ type: 'ACTIVATED', build: BUILD });
    })());
});

// --- Nachrichten der App ---------------------------------------------------------------------

async function onMessage(type, data) {
    switch (type) {
        case 'GET_STATUS':
            return { ...(await currentMode()), build: BUILD };
        case 'SET_MODE': {
            const before = await currentMode();
            await setState('mode', swPolicy.modeState(data.mode, Date.now(), data.minutes));
            const after = await currentMode();
            if (before.mode !== after.mode) {
                await log({
                    kind: 'modus',
                    purpose: 'modus',
                    label: after.mode === 'verbunden' ? 'Verbunden' : 'Lokal',
                    reason: after.mode === 'verbunden'
                        ? `Verbindung erlaubt bis ${new Date(after.until).toLocaleTimeString('de-CH')}`
                        : (data.reason || 'Internetverbindung gesperrt'),
                });
            }
            await broadcast({ type: 'MODE', ...after });
            return after;
        }
        case 'REQUEST_UPDATE':
            await setState('updateRequested', { until: Date.now() + UPDATE_WINDOW_MS });
            return true;
        case 'ACTIVATE_UPDATE':
            await self.skipWaiting();
            return true;
        case 'GET_LOG':
            return (await tx('netlog', 'readonly', store => store.getAll())).reverse();
        case 'CLEAR_LOG':
            await tx('netlog', 'readwrite', store => store.clear());
            return true;
        default:
            throw new Error(`Unbekannte Nachricht: ${type}`);
    }
}

self.addEventListener('message', event => {
    const { type, ...data } = event.data || {};
    const port = event.ports[0];
    event.waitUntil(
        onMessage(type, data).then(
            result => port?.postMessage({ ok: true, result }),
            err => port?.postMessage({ ok: false, error: err.message }),
        ),
    );
});
