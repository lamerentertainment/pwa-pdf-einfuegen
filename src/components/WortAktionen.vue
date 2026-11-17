<script setup>
// Klick auf ein Wort im Ergebnis: zeigt, welche Regeln es verändert haben, und erlaubt, eine
// Regel zu entfernen (bzw. einen Schritt der Bereinigung auszuschalten) oder eine neue Regel für
// dieses Wort anzulegen. Die Änderungen selbst nimmt die Ansicht vor (Ereignisse).
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { XMarkIcon } from '@heroicons/vue/24/outline';
import { beschreibeHerkunft } from '../process/herkunft.js';
import { LISTEN, pruefeEintrag } from '../process/konvertierungen.js';
import { SCHRITTE } from '../process/rules.js';

const props = defineProps({
    wort: { type: String, required: true },
    kette: { type: Array, default: () => [] },
    satzanfang: { type: Boolean, default: false },
    // Wortlisten der gewählten Konvertierung (null: keine) und ihr Name
    listen: { type: Object, default: null },
    konvName: { type: String, default: '' },
    eigen: { type: Boolean, default: false },
    istEigen: { type: Function, default: () => false },
    x: { type: Number, required: true },
    y: { type: Number, required: true },
    oben: { type: Boolean, default: false },
});
const emit = defineEmits(['schliessen', 'entfernen', 'schrittAus', 'hinzufuegen']);

const box = ref(null);
const LISTEN_IDS = new Set(LISTEN.map(l => l.id));
const SCHRITT_IDS = new Set(SCHRITTE.map(s => s.id));

const zeilen = computed(() => {
    const texte = beschreibeHerkunft(props.kette, props.istEigen);
    return props.kette.map((k, i) => ({
        ...texte[i],
        entfernbar: LISTEN_IDS.has(k.stufe) && k.eintrag ? k : null,
        schritt: !LISTEN_IDS.has(k.stufe) && SCHRITT_IDS.has(k.stufe) ? k.stufe : null,
    }));
});

// --- Neue Regel: Ausgangswort ist das Wort vor der ersten Änderung, ohne Satzzeichen ---
const ohneSatzzeichen = w => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
const ausgang = computed(() => {
    const w = ohneSatzzeichen(props.kette[0]?.vorher ?? props.wort);
    // Am Satzanfang grossgeschrieben: Regeln stehen kleingeschrieben und gelten auch am Satzanfang
    return props.satzanfang ? w.charAt(0).toLowerCase() + w.slice(1) : w;
});

const liste = ref('pronomen');
const felder = ref([]);
const fehler = ref('');
const vorhanden = computed(() => props.listen?.[liste.value]?.find(e => e[0] === felder.value[0]?.trim()) ?? null);

function vorbelegen() {
    // Gibt es das Wort schon in einer Liste, diese wählen (dann wird der Eintrag geändert)
    const treffer = props.listen && LISTEN.find(l => props.listen[l.id].some(e => e[0] === ausgang.value));
    // sonst die Pronomen-Liste: einfache Wortersetzung mit neutralen Spalten (Wort, Ersatz)
    liste.value = treffer?.id ?? 'pronomen';
    belegeFelder();
}
function belegeFelder() {
    const spalten = LISTEN.find(l => l.id === liste.value).spalten.length;
    const bestehend = props.listen?.[liste.value]?.find(e => e[0] === ausgang.value);
    felder.value = bestehend ? [...bestehend] : [ausgang.value, ...Array(spalten - 1).fill('')];
    fehler.value = '';
}
watch(() => [props.wort, props.kette], vorbelegen, { immediate: true });

function hinzufuegen() {
    const eintrag = felder.value.map(v => v.trim());
    fehler.value = pruefeEintrag(liste.value, eintrag) ?? '';
    if (!fehler.value && !eintrag[1]) fehler.value = 'Bitte einen Ersatz angeben.';
    if (fehler.value) return;
    emit('hinzufuegen', liste.value, eintrag);
}

const ziel = computed(() => (props.eigen
    ? `Wird in «${props.konvName}» gespeichert.`
    : props.konvName
        ? `Legt eine eigene Konvertierung auf Grundlage von «${props.konvName}» an und wählt sie.`
        : 'Legt eine eigene Konvertierung an und wählt sie.'));

// Schliessen: Escape oder Klick ausserhalb (ein Klick auf ein anderes Wort öffnet es dort neu)
function onKey(event) {
    if (event.key === 'Escape') emit('schliessen');
}
function onPointer(event) {
    if (box.value && !box.value.contains(event.target) && !event.target.closest?.('[data-index]')) emit('schliessen');
}
onMounted(() => {
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer, true);
});
onUnmounted(() => {
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('pointerdown', onPointer, true);
});
</script>

<template>
  <div
    ref="box"
    class="fixed z-50 w-[min(26rem,calc(100vw-1rem))] rounded-box border border-base-300 bg-base-100 p-3 text-sm shadow-xl"
    :class="{ '-translate-y-full': oben }"
    :style="{ left: `${x}px`, top: `${y}px` }"
    role="dialog"
    aria-label="Regeln für dieses Wort"
  >
    <div class="mb-2 flex items-center gap-2">
      <span class="font-mono font-semibold">{{ wort }}</span>
      <button class="btn btn-ghost btn-xs btn-square ml-auto" aria-label="Schliessen" @click="emit('schliessen')"><XMarkIcon class="size-4" /></button>
    </div>

    <div v-if="zeilen.length" class="mb-3 space-y-1.5">
      <p class="text-xs opacity-70">Verändert durch</p>
      <div v-for="(z, i) in zeilen" :key="i" class="flex flex-wrap items-center gap-x-1.5 gap-y-1">
        <span class="font-semibold">{{ z.label }}</span>
        <span class="font-mono text-xs">{{ z.regel }}</span>
        <span v-if="z.eigen" class="badge badge-xs badge-primary">eigener Eintrag</span>
        <button
          v-if="z.entfernbar"
          class="btn btn-xs btn-outline btn-error ml-auto"
          :title="eigen ? `Entfernt den Eintrag aus «${konvName}»` : 'Legt eine eigene Konvertierung ohne diesen Eintrag an'"
          @click="emit('entfernen', z.entfernbar.stufe, z.entfernbar.eintrag)"
        >
          Regel entfernen
        </button>
        <button
          v-else-if="z.schritt"
          class="btn btn-xs btn-outline ml-auto"
          title="Schaltet diesen Schritt für alle Texte aus (oben unter «Zeilen zusammenfügen + Formatierungsvereinheitlichung + typische Fehler» wieder einschaltbar)"
          @click="emit('schrittAus', z.schritt)"
        >
          Schritt ausschalten
        </button>
      </div>
      <p v-if="zeilen.some(z => z.entfernbar) && !eigen" class="text-xs opacity-60">
        «Regel entfernen» legt eine eigene Konvertierung an; die eingebaute bleibt unverändert.
      </p>
    </div>

    <form class="space-y-2 border-t border-base-300 pt-2" @submit.prevent="hinzufuegen">
      <div class="flex items-center gap-2">
        <span class="text-xs font-medium">{{ vorhanden ? 'Regel ändern' : 'Neue Regel' }}</span>
        <select v-model="liste" class="select select-xs ml-auto w-auto" aria-label="Wortliste" @change="belegeFelder">
          <option v-for="l in LISTEN" :key="l.id" :value="l.id">{{ l.label }}</option>
        </select>
      </div>
      <div class="flex items-end gap-1.5">
        <label v-for="(spalte, i) in LISTEN.find(l => l.id === liste).spalten" :key="spalte" class="flex min-w-0 flex-1 flex-col gap-0.5 text-xs">
          {{ spalte }}
          <input v-model="felder[i]" class="input input-xs w-full font-mono" />
        </label>
        <button class="btn btn-xs btn-primary">{{ vorhanden ? 'Ändern' : 'Hinzufügen' }}</button>
      </div>
      <p v-if="fehler" class="text-xs text-error">{{ fehler }}</p>
      <p class="text-xs opacity-60">{{ ziel }}</p>
    </form>
  </div>
</template>
