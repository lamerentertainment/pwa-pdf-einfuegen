// Ziehbare Aufteilung (Breite links/rechts) und Höhe eines Bereichs. Die Werte merkt sich
// der Browser (localStorage, nur Layout – kein Inhalt); ohne Speicher gelten die Standardwerte.
import { onBeforeUnmount, ref, watch } from 'vue';

function load(key, fallback) {
    try {
        const value = Number(localStorage.getItem(key));
        return Number.isFinite(value) && value > 0 ? value : fallback;
    } catch {
        return fallback;
    }
}

function save(key, value) {
    try {
        localStorage.setItem(key, String(value));
    } catch {
        // privater Modus o. ä.: dann eben nicht merken
    }
}

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/**
 * @param {string} key Name für den Speicher
 * @param {{ratio?: number, height?: number, minRatio?: number, maxRatio?: number, minHeight?: number}} [defaults]
 */
export function useResizable(key, { ratio = 0.5, height, minRatio = 0.2, maxRatio = 0.8, minHeight = 300 } = {}) {
    let defaultHeight = height ?? Math.max(minHeight, Math.round(window.innerHeight * 0.7));
    const split = ref(clamp(load(`${key}.ratio`, ratio), minRatio, maxRatio));
    const storedHeight = load(`${key}.height`, 0);
    const size = ref(Math.max(minHeight, storedHeight || defaultHeight));
    watch(split, value => save(`${key}.ratio`, value.toFixed(3)));

    let stop = null;
    function drag(event, onMove) {
        event.preventDefault();
        const move = e => onMove(e);
        const up = () => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
            document.body.style.userSelect = '';
            stop = null;
        };
        document.body.style.userSelect = 'none';
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
        stop = up;
    }

    /** Trenner zwischen links und rechts; `container` ist das Element, das beide umfasst. */
    function startSplit(event, container) {
        const rect = container.getBoundingClientRect();
        drag(event, e => {
            split.value = clamp((e.clientX - rect.left) / rect.width, minRatio, maxRatio);
        });
    }

    /** Griff am unteren Rand. */
    function startHeight(event) {
        const startY = event.clientY;
        const startSize = size.value;
        drag(event, e => {
            size.value = Math.max(minHeight, startSize + e.clientY - startY);
            save(`${key}.height`, Math.round(size.value));
        });
    }

    // Tastatur: Pfeiltasten auf dem fokussierten Trenner
    function splitKey(event) {
        const step = event.shiftKey ? 0.1 : 0.02;
        if (event.key === 'ArrowLeft') split.value = clamp(split.value - step, minRatio, maxRatio);
        else if (event.key === 'ArrowRight') split.value = clamp(split.value + step, minRatio, maxRatio);
        else return;
        event.preventDefault();
    }

    function heightKey(event) {
        const step = event.shiftKey ? 200 : 40;
        if (event.key === 'ArrowUp') size.value = Math.max(minHeight, size.value - step);
        else if (event.key === 'ArrowDown') size.value += step;
        else return;
        save(`${key}.height`, Math.round(size.value));
        event.preventDefault();
    }

    /**
     * Standardhöhe so wählen, dass der Bereich ab `element` mitsamt Griff ins Fenster passt.
     * Eine selbst eingestellte Höhe bleibt unangetastet.
     */
    function fitToWindow(element, margin = 40) {
        if (!element || height !== undefined) return;
        const top = element.getBoundingClientRect().top + window.scrollY;
        defaultHeight = Math.max(minHeight, Math.round(window.innerHeight - top - margin));
        if (!storedHeight) size.value = defaultHeight;
    }

    function reset() {
        split.value = ratio;
        size.value = defaultHeight;
        save(`${key}.height`, 0);
    }

    onBeforeUnmount(() => stop?.());
    return { split, size, startSplit, startHeight, splitKey, heightKey, reset, fitToWindow };
}
