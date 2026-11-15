// Eine Ansichtseinstellung, die sich der Browser merkt (localStorage, nur Einstellungen, nie
// Dokumentinhalt). Ohne Speicher (privater Modus) gilt einfach der Standardwert.
import { ref, watch } from 'vue';

export function usePreference(key, fallback) {
    let initial = fallback;
    try {
        const stored = localStorage.getItem(key);
        if (stored !== null) initial = JSON.parse(stored);
    } catch {
        // kein Speicher oder ungültiger Wert
    }
    const value = ref(typeof initial === typeof fallback ? initial : fallback);
    watch(value, v => {
        try {
            localStorage.setItem(key, JSON.stringify(v));
        } catch {
            // nicht merken
        }
    });
    return value;
}
