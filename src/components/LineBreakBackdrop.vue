<script setup>
// Zeigt die Zeilenumbrüche eines Textfelds als graue Zeichen (↵) an. Liegt hinter dem Textfeld
// (das dafür einen durchsichtigen Hintergrund hat), mit derselben Schrift, Breite und Bildlauf-
// position. Nur Anzeige: Der Text im Feld bleibt unverändert, auch beim Kopieren.
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { MIRRORED } from './textPosition.js';

const props = defineProps({
    target: { type: Object, default: null }, // das Textfeld (HTMLTextAreaElement)
    text: { type: String, required: true },
});

const backdrop = ref(null);
let observer = null;

// Zeilen; nach jeder ausser der letzten steht ein Umbruch
const lines = computed(() => props.text.split('\n'));

function sync() {
    const el = props.target;
    const box = backdrop.value;
    if (!el || !box) return;
    const style = getComputedStyle(el);
    for (const prop of MIRRORED) box.style[prop] = style[prop];
    Object.assign(box.style, {
        // Felder mit wrap="off" (Prüfansicht ohne «Zeilen umbrechen») brechen nicht um
        whiteSpace: el.getAttribute('wrap') === 'off' ? 'pre' : 'pre-wrap',
        top: `${el.offsetTop}px`,
        left: `${el.offsetLeft}px`,
        width: `${el.offsetWidth}px`,
        height: `${el.offsetHeight}px`,
        borderColor: 'transparent',
    });
    box.scrollTop = el.scrollTop;
    box.scrollLeft = el.scrollLeft;
}

function onScroll() {
    if (!backdrop.value || !props.target) return;
    backdrop.value.scrollTop = props.target.scrollTop;
    backdrop.value.scrollLeft = props.target.scrollLeft;
}

function attach(el, old) {
    old?.removeEventListener('scroll', onScroll);
    observer?.disconnect();
    if (!el) return;
    el.addEventListener('scroll', onScroll, { passive: true });
    observer = new ResizeObserver(sync);
    observer.observe(el);
    sync();
}

onMounted(() => attach(props.target));
watch(() => props.target, attach);
// Nach einer Eingabe kann sich die Bildlaufposition ändern (neue Zeile am Ende)
watch(() => props.text, () => requestAnimationFrame(sync));
// Umbruch des Felds umgeschaltet (wrap-Attribut): das ändert seine Grösse nicht
const observeWrap = new MutationObserver(() => requestAnimationFrame(sync));
watch(() => props.target, el => {
    observeWrap.disconnect();
    if (el) observeWrap.observe(el, { attributes: true, attributeFilter: ['wrap', 'class'] });
}, { immediate: true });
onBeforeUnmount(() => observeWrap.disconnect());
onBeforeUnmount(() => attach(null, props.target));
</script>

<template>
  <div ref="backdrop" class="line-break-backdrop" aria-hidden="true"><template v-for="(line, i) in lines" :key="i">{{ line }}<template v-if="i < lines.length - 1"><span class="nl" />{{ '\n' }}</template></template>{{ ' ' }}</div>
</template>

<style scoped>
.line-break-backdrop {
  position: absolute;
  overflow: hidden;
  pointer-events: none;
  white-space: pre-wrap;
  overflow-wrap: break-word;
  color: transparent;
  scrollbar-gutter: stable;
}
/* Das Zeichen nimmt keinen Platz ein, damit der Umbruch der Zeilen genau gleich bleibt */
.nl { position: relative; }
.nl::after {
  content: '↵';
  position: absolute;
  left: 0.15em;
  color: color-mix(in oklab, var(--color-base-content) 35%, transparent);
}
</style>
