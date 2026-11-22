// Interne KI im Intranet (OpenWebUI des Kantons): Erreichbarkeit prüfen, API-Key verwalten,
// Text erzeugen lassen.
//
// Anders als die Sprachmodelle im Browser schickt die interne KI den Eingabetext an einen Server,
// allerdings nur an diesen einen im Intranet. Das geht nur, wenn oben «Lokale KI-Anfragen» erlaubt
// sind (unabhängig vom Internet-Modus); der Torwächter (public/sw-policy.js) und die CSP (csp.js)
// lassen genau diese Adresse zu, und jede Anfrage erscheint im Verbindungsprotokoll.
//
// Der API-Key gehört der Nutzerin bzw. dem Nutzer (OpenWebUI → Einstellungen → Konto →
// API-Schlüssel). Die App liefert keinen mit: Er wird nur in diesem Browser gespeichert. Erst mit
// dem Key nimmt die App Kontakt mit dem Server auf; dabei fragt Chrome einmal nach der Berechtigung
// «Lokales Netzwerk».
import { reactive, readonly } from 'vue';
import { isBlocked, setLokaleKi, wakeGatekeeper } from '../net/connection.js';

export const INTRANET_ORIGIN = 'https://aiacoder-v001.kt.lunet.ch'; // gleich wie in sw-policy.js und csp.js
export const INTRANET_MODEL = 'gemma4:31b';
export const INTRANET_ID = `intern:${INTRANET_MODEL}`;
const KEY_STORAGE = 'intern.apiKey';
const CHECK_TIMEOUT_MS = 8000;
// Solange Chrome nach der Berechtigung «Lokales Netzwerk» fragt, wartet die Anfrage auf die Antwort
const PROMPT_TIMEOUT_MS = 120000;

function loadKey() {
    try {
        return localStorage.getItem(KEY_STORAGE) || '';
    } catch {
        return '';
    }
}

const state = reactive({
    /** 'unbekannt' | 'pruefen' | 'erreichbar' | 'nicht-erreichbar' | 'gesperrt' (Chrome-Berechtigung abgelehnt) | 'aus' (Schalter gesperrt) */
    status: 'unbekannt',
    apiKey: loadKey(),
    /** Ergebnis der Key-Prüfung: null | { ok: true } | { ok: false, error } */
    keyCheck: null,
});

export const intranet = readonly(state);

/** Die interne KI ist eingerichtet, sobald ein API-Key gespeichert ist. */
export const isActive = () => Boolean(state.apiKey);

export function setApiKey(key) {
    state.apiKey = key.trim();
    state.keyCheck = null;
    try {
        if (state.apiKey) localStorage.setItem(KEY_STORAGE, state.apiKey);
        else localStorage.removeItem(KEY_STORAGE);
    } catch {
        // ohne Speicher gilt der Key nur bis zum Neuladen
    }
}

const authHeaders = () => ({ Authorization: `Bearer ${state.apiKey}` });
const GESPERRT = 'Lokale KI-Anfragen sind gesperrt. Oben «Lokale KI-Anfragen» erlauben.';

/** Key speichern, lokale KI-Anfragen erlauben und die Verbindung prüfen (löst die Chrome-Rückfrage aus). */
export async function einrichten(key) {
    setApiKey(key);
    if (!state.apiKey) return;
    await setLokaleKi(true, 'API-Key eingetragen');
    await pruefen();
}

/** Key löschen und lokale KI-Anfragen wieder sperren. */
export async function entfernen() {
    setApiKey('');
    state.status = 'unbekannt';
    await setLokaleKi(false, 'API-Key gelöscht');
}

/** Erreichbarkeit und, wenn erreichbar, Key und Modell prüfen. */
export async function pruefen() {
    if ((await checkReachable()) === 'erreichbar') await checkKey();
    else state.keyCheck = null;
}

/**
 * Stand der Chrome-Berechtigung «Lokales Netzwerk» für diese Website: 'granted' | 'prompt' |
 * 'denied', oder null, wenn der Browser sie nicht kennt. Nie nach 'local-network-access' fragen:
 * Ältere Chrome-Versionen stürzen bei diesem Namen ab, ohne dass try/catch hilft.
 */
export async function localNetworkPermission() {
    try {
        return (await navigator.permissions.query({ name: 'local-network' })).state;
    } catch {
        return null;
    }
}

/**
 * Ist der Server erreichbar (also: ist dieser Rechner im Intranet)? /health braucht keinen Key.
 * Ausserhalb des Intranets lässt sich der Name nicht auflösen, die Anfrage scheitert einfach.
 * Im Intranet fragt Chrome beim ersten Mal nach der Berechtigung «Lokales Netzwerk»; dafür muss
 * diese Anfrage von der Seite kommen (der Torwächter lässt sie durch, siehe sw-policy.js).
 */
export async function checkReachable() {
    state.status = 'pruefen';
    await wakeGatekeeper();
    const permission = await localNetworkPermission();
    try {
        const timeout = permission === 'prompt' ? PROMPT_TIMEOUT_MS : CHECK_TIMEOUT_MS;
        const response = await fetch(`${INTRANET_ORIGIN}/health`, { cache: 'no-store', signal: AbortSignal.timeout(timeout) });
        if (isBlocked(response)) state.status = 'aus';
        else state.status = response.ok ? 'erreichbar' : 'nicht-erreichbar';
    } catch {
        state.status = (await localNetworkPermission()) === 'denied' ? 'gesperrt' : 'nicht-erreichbar';
    }
    return state.status;
}

/** Prüft den gespeicherten Key und ob das Modell auf dem Server angeboten wird. */
export async function checkKey() {
    try {
        const response = await fetch(`${INTRANET_ORIGIN}/api/models`, { cache: 'no-store', headers: authHeaders(), signal: AbortSignal.timeout(10000) });
        if (isBlocked(response)) throw new Error(GESPERRT);
        if (response.status === 401 || response.status === 403) throw new Error('Der API-Key wird nicht akzeptiert.');
        if (!response.ok) throw new Error(`Server antwortet mit ${response.status}.`);
        const ids = ((await response.json()).data ?? []).map(m => m.id);
        if (!ids.includes(INTRANET_MODEL)) {
            throw new Error(`Der Key funktioniert, aber das Modell «${INTRANET_MODEL}» wird nicht angeboten. Verfügbar: ${ids.join(', ') || 'keine'}.`);
        }
        state.keyCheck = { ok: true };
    } catch (err) {
        state.keyCheck = { ok: false, error: err.name === 'TimeoutError' ? 'Keine Antwort vom Server.' : err.message };
    }
    return state.keyCheck;
}

/**
 * Zerlegt einen Server-Sent-Events-Strom in die «data:»-Zeilen.
 * @returns {{ events: string[], rest: string }} vollständige Ereignisse und der unvollständige Rest
 */
export function parseSse(buffer) {
    const parts = buffer.replace(/\r\n/g, '\n').split('\n\n');
    const rest = parts.pop();
    const events = [];
    for (const part of parts) {
        const data = part.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
        if (data) events.push(data);
    }
    return { events, rest };
}

/** Text eines Ereignisses der OpenAI-kompatiblen Schnittstelle, '' wenn keiner. */
export function deltaText(data) {
    if (data === '[DONE]') return '';
    try {
        return JSON.parse(data).choices?.[0]?.delta?.content ?? '';
    } catch {
        return '';
    }
}

/**
 * Lässt die interne KI den Prompt beantworten (gestreamt).
 * @returns {Promise<{ text: string, tokens: number, ms: number, stopped: boolean }>}
 */
export async function generateIntranet(prompt, { onToken, signal } = {}) {
    if (!state.apiKey) throw new Error('Für die interne KI zuerst unter «Modelle/Programmupdate» einen API-Key eintragen.');
    const start = performance.now();
    let text = '';
    let tokens = 0;
    try {
        const response = await fetch(`${INTRANET_ORIGIN}/api/chat/completions`, {
            method: 'POST',
            headers: { ...authHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: INTRANET_MODEL, stream: true, messages: [{ role: 'user', content: prompt }] }),
            signal,
        });
        if (isBlocked(response)) throw new Error(GESPERRT);
        if (response.status === 401 || response.status === 403) throw new Error('Der API-Key wird nicht akzeptiert. Unter «Modelle/Programmupdate» prüfen.');
        if (!response.ok) throw new Error(`Die interne KI antwortet mit ${response.status}.`);

        const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
        let buffer = '';
        for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            const parsed = parseSse(buffer + value);
            buffer = parsed.rest;
            for (const event of parsed.events) {
                const piece = deltaText(event);
                if (!piece) continue;
                text += piece;
                tokens += 1;
                onToken?.(piece);
            }
        }
        return { text, tokens, ms: performance.now() - start, stopped: false };
    } catch (err) {
        if (err.name === 'AbortError') return { text, tokens, ms: performance.now() - start, stopped: true };
        if (err instanceof TypeError) throw new Error('Die interne KI ist nicht erreichbar. Nur im Intranet verfügbar.');
        throw err;
    }
}
