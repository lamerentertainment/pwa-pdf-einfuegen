// Promptbibliothek für Stufe 3: eingebaute Prompts (aus der promptlibrary) und eigene.
//
// Eingebaute Prompts lassen sich nicht ändern, aber als Vorlage für einen eigenen verwenden oder
// ausblenden. Eigene speichert nur dieser Browser (localStorage, nur auf diesem Gerät); es sind
// Einstellungen, nie Dokumentinhalt. Zum Sichern und Weitergeben gibt es Export und Import als .json.
import { reactive, watch } from 'vue';
import presetData from './presets.json';

export const EINGEBAUT = Object.freeze(presetData.presets.map(p => Object.freeze({ ...p, eingebaut: true })));
export const QUELLE = presetData.quelle;
export const EIGENE_GRUPPE = 'Eigene Prompts';

export const MAX = Object.freeze({ title: 120, group: 60, description: 300, prompt: 50_000 });

/** Prüft die Felder eines Prompts; liefert eine Fehlermeldung oder null. */
export function pruefePrompt(p) {
    if (typeof p?.title !== 'string' || !p.title.trim()) return 'Der Titel darf nicht leer sein.';
    if (typeof p.prompt !== 'string' || !p.prompt.trim()) return 'Der Prompt darf nicht leer sein.';
    for (const feld of ['group', 'description']) {
        if (p[feld] != null && typeof p[feld] !== 'string') return 'Ungültiger Eintrag.';
    }
    for (const [feld, max] of Object.entries(MAX)) {
        if ((p[feld] ?? '').length > max) return `Zu lang (${feld}: höchstens ${max} Zeichen).`;
    }
    return null;
}

/** Hinweise zum Platzhalter {{INPUT}}, ohne die der Prompt trotzdem funktioniert. */
export function platzhalterHinweis(prompt) {
    const n = prompt.split('{{INPUT}}').length - 1;
    if (n === 0) return 'Ohne {{INPUT}} wird der Eingabetext ans Ende des Prompts angehängt.';
    if (n > 1) return `{{INPUT}} kommt ${n}-mal vor; der Eingabetext wird überall eingesetzt.`;
    return null;
}

const bereinigt = p => ({
    title: p.title.trim().slice(0, MAX.title),
    group: (p.group ?? '').trim().slice(0, MAX.group) || EIGENE_GRUPPE,
    description: (p.description ?? '').trim().slice(0, MAX.description),
    prompt: p.prompt,
});

// --- Export und Import -----------------------------------------------------------------------

const FORMAT = 'pdf-einfuegen-prompts';

export function exportDaten(prompts) {
    return {
        format: FORMAT,
        version: 1,
        prompts: prompts.map(({ title, group, description, prompt }) => ({ title, group, description, prompt })),
    };
}

/** Liest eine Exportdatei. Wirft bei ungültigem Inhalt einen Fehler mit verständlicher Meldung. */
export function leseImport(text) {
    let data;
    try {
        data = JSON.parse(text);
    } catch {
        throw new Error('Die Datei ist keine gültige JSON-Datei.');
    }
    if (data?.format !== FORMAT || !Array.isArray(data.prompts)) {
        throw new Error('Die Datei enthält keine Prompts aus dieser App.');
    }
    return data.prompts.map((p, n) => {
        const fehler = pruefePrompt(p);
        if (fehler) throw new Error(`Prompt ${n + 1}: ${fehler}`);
        return bereinigt(p);
    });
}

// --- Speicher im Browser ---------------------------------------------------------------------

const KEY = 'transformieren.prompts';

function laden() {
    try {
        const data = JSON.parse(localStorage.getItem(KEY) ?? 'null');
        if (data && Array.isArray(data.eigene) && Array.isArray(data.ausgeblendet)) return data;
    } catch {
        // kein Speicher oder ungültiger Inhalt
    }
    return { eigene: [], ausgeblendet: [] };
}

export const bibliothek = reactive(laden());

watch(bibliothek, value => {
    try {
        localStorage.setItem(KEY, JSON.stringify(value));
    } catch {
        // nicht merken (privater Modus oder Speicher voll)
    }
}, { deep: true });

const neueId = () => `p-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export function allePrompts() {
    return [...EINGEBAUT, ...bibliothek.eigene];
}

export function findePrompt(id) {
    return allePrompts().find(p => p.id === id) ?? null;
}

export function istAusgeblendet(id) {
    return bibliothek.ausgeblendet.includes(id);
}

export function sichtbarePrompts() {
    return allePrompts().filter(p => !istAusgeblendet(p.id));
}

/** Sichtbare Prompts nach Gruppe, in der Reihenfolge ihres ersten Auftretens. */
export function gruppiert(prompts = sichtbarePrompts()) {
    const map = new Map();
    for (const p of prompts) {
        if (!map.has(p.group)) map.set(p.group, []);
        map.get(p.group).push(p);
    }
    return [...map.entries()];
}

export function setzeAusgeblendet(id, ausblenden) {
    bibliothek.ausgeblendet = bibliothek.ausgeblendet.filter(x => x !== id);
    if (ausblenden) bibliothek.ausgeblendet.push(id);
}

function freierTitel(title) {
    const titel = new Set(allePrompts().map(p => p.title));
    if (!titel.has(title)) return title;
    for (let n = 2; ; n++) if (!titel.has(`${title} (${n})`)) return `${title} (${n})`;
}

/** Neuer eigener Prompt; liefert seine id. */
export function erstellePrompt(felder) {
    const p = bereinigt({ title: 'Neuer Prompt', prompt: '', ...felder });
    p.title = freierTitel(p.title);
    const eintrag = { id: neueId(), ...p };
    bibliothek.eigene.push(eintrag);
    return eintrag.id;
}

export function duplizierePrompt(id, prompt) {
    const vorlage = findePrompt(id);
    return erstellePrompt({
        title: vorlage.eingebaut ? `${vorlage.title} (eigen)` : `Kopie von ${vorlage.title}`,
        group: vorlage.eingebaut ? EIGENE_GRUPPE : vorlage.group,
        description: vorlage.description,
        prompt: prompt ?? vorlage.prompt,
    });
}

export function aenderePrompt(id, felder) {
    const p = bibliothek.eigene.find(x => x.id === id);
    if (!p) return;
    if ('title' in felder) felder = { ...felder, title: felder.title.trim().slice(0, MAX.title) || p.title };
    if ('group' in felder) felder = { ...felder, group: felder.group.trim().slice(0, MAX.group) || EIGENE_GRUPPE };
    if ('description' in felder) felder = { ...felder, description: felder.description.trim().slice(0, MAX.description) };
    Object.assign(p, felder);
}

export function loeschePrompt(id) {
    bibliothek.eigene = bibliothek.eigene.filter(p => p.id !== id);
    bibliothek.ausgeblendet = bibliothek.ausgeblendet.filter(x => x !== id);
}
