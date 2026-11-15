<script setup>
// Prüfansicht: links die PDF-Seite mit den erkannten Zeilen, rechts der erfasste Text dieser Seite.
// Ein Klick auf eine Zeile im PDF markiert sie im Text, ein Klick im Text markiert die Zeile im PDF.
import { computed, nextTick, ref, watch } from 'vue';
import { ChevronLeftIcon, ChevronRightIcon } from '@heroicons/vue/24/outline';
import PageView from './PageView.vue';
import { documentState } from '../capture/documentStore.js';
import { UNCERTAIN_SCORE } from '../capture/options.js';

const SOURCE_LABEL = {
    text: { text: 'Eingebetteter Text', cls: 'badge-info' },
    leer: { text: 'Kein Text auf der Seite', cls: 'badge-ghost' },
    ocr: { text: 'Texterkennung (OCR)', cls: 'badge-success' },
    'ocr-layout': { text: 'Texterkennung mit Layoutmodell', cls: 'badge-success' },
    'ocr-fehlt': { text: 'Scan – Texterkennung nicht installiert', cls: 'badge-warning' },
    'text-ocr-fehlt': { text: 'Scan – nur verborgene Textebene des Scanners', cls: 'badge-warning' },
};

const index = ref(0);
const showBoxes = ref(true);
const showRegions = ref(true);
const activeBox = ref(-1);
const hint = ref('');
const textarea = ref(null);

const pages = computed(() => documentState.pages);
const page = computed(() => pages.value[index.value]);
const source = computed(() => SOURCE_LABEL[page.value.source] ?? { text: page.value.source, cls: 'badge-ghost' });
const edited = computed(() => page.value.text !== page.value.originalText);
const uncertain = computed(() => page.value.boxes
    .map((box, i) => (box.score !== undefined && box.score < UNCERTAIN_SCORE ? i : -1))
    .filter(i => i >= 0));
const uncertainTotal = computed(() => pages.value.reduce(
    (sum, p) => sum + p.boxes.filter(b => b.score !== undefined && b.score < UNCERTAIN_SCORE).length, 0));

watch(index, () => {
    activeBox.value = -1;
    hint.value = '';
});

function go(delta) {
    index.value = Math.min(pages.value.length - 1, Math.max(0, index.value + delta));
}

/** Findet den Text einer Box im Seitentext: zuerst ganz, sonst über den Anfang. */
function locate(text, boxText) {
    const needle = boxText.trim();
    if (!needle) return null;
    let at = text.indexOf(needle);
    if (at >= 0) return [at, at + needle.length];
    const head = needle.slice(0, Math.min(16, needle.length));
    at = head.length >= 4 ? text.indexOf(head) : -1;
    return at >= 0 ? [at, at + head.length] : null;
}

async function selectBox(i) {
    activeBox.value = i;
    const box = page.value.boxes[i];
    const range = locate(page.value.text, box.text);
    hint.value = range ? '' : `«${box.text}» kommt im Text nicht mehr wörtlich vor (bearbeitet oder zusammengefügt).`;
    if (!range) return;
    await nextTick();
    const el = textarea.value;
    el.focus({ preventScroll: true });
    el.setSelectionRange(range[0], range[1]);
    const line = page.value.text.slice(0, range[0]).split('\n').length - 1;
    const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 20;
    el.scrollTop = Math.max(0, line * lineHeight - el.clientHeight / 3);
}

/** Zeile an der Schreibmarke → passende Box im PDF. */
function syncFromText() {
    const el = textarea.value;
    const text = page.value.text;
    const start = text.lastIndexOf('\n', el.selectionStart - 1) + 1;
    const endAt = text.indexOf('\n', el.selectionStart);
    const line = text.slice(start, endAt < 0 ? text.length : endAt).trim();
    if (line.length < 3) return;
    const found = page.value.boxes.findIndex(box => {
        const t = box.text.trim();
        return t.length >= 3 && (line.includes(t.slice(0, 20)) || t.includes(line.slice(0, 20)));
    });
    if (found >= 0) {
        activeBox.value = found;
        hint.value = '';
    }
}

function nextUncertain() {
    if (!uncertain.value.length) return;
    const next = uncertain.value.find(i => i > activeBox.value) ?? uncertain.value[0];
    selectBox(next);
}

function reset() {
    page.value.text = page.value.originalText;
}
</script>

<template>
  <div class="space-y-3">
    <div class="flex flex-wrap items-center gap-3">
      <div class="join">
        <button class="btn btn-sm join-item" :disabled="index === 0" aria-label="Vorherige Seite" @click="go(-1)">
          <ChevronLeftIcon class="size-4" />
        </button>
        <select v-model.number="index" class="select select-sm join-item w-36" aria-label="Seite">
          <option v-for="(p, i) in pages" :key="p.number" :value="i">Seite {{ p.number }} / {{ pages.length }}</option>
        </select>
        <button class="btn btn-sm join-item" :disabled="index === pages.length - 1" aria-label="Nächste Seite" @click="go(1)">
          <ChevronRightIcon class="size-4" />
        </button>
      </div>
      <span class="badge" :class="source.cls">{{ source.text }}</span>
      <span v-if="edited" class="badge badge-neutral">bearbeitet</span>
      <span v-if="uncertain.length" class="text-sm">
        {{ uncertain.length }} unsichere Zeile{{ uncertain.length === 1 ? '' : 'n' }}
        <button class="btn btn-xs btn-warning ml-1" @click="nextUncertain">Nächste zeigen</button>
      </span>
      <span v-else-if="uncertainTotal" class="text-sm opacity-60">Im ganzen Dokument: {{ uncertainTotal }} unsichere Zeilen</span>
      <div class="ml-auto flex flex-wrap items-center gap-4 text-sm">
        <label class="flex items-center gap-2"><input v-model="showBoxes" type="checkbox" class="checkbox checkbox-xs" /> Zeilen anzeigen</label>
        <label v-if="page.regions" class="flex items-center gap-2"><input v-model="showRegions" type="checkbox" class="checkbox checkbox-xs" /> Layoutbereiche</label>
      </div>
    </div>

    <div class="flex flex-wrap gap-x-4 gap-y-1 text-xs opacity-70">
      <span><span class="legend border-blue-500/60" /> eingebetteter Text</span>
      <span><span class="legend border-green-600/60" /> erkannt</span>
      <span><span class="legend border-orange-600 bg-orange-500/20" /> unsicher erkannt (unter {{ Math.round(UNCERTAIN_SCORE * 100) }} %)</span>
      <span>Klick auf eine Zeile markiert sie im Text und umgekehrt.</span>
    </div>

    <div class="grid gap-4 lg:grid-cols-2">
      <div class="h-[72vh] overflow-auto rounded-box bg-base-300 p-3">
        <PageView
          :pdf="documentState.pdf"
          :page="page"
          :show-boxes="showBoxes"
          :show-regions="showRegions"
          :active-index="activeBox"
          @select="selectBox"
        />
      </div>
      <div class="flex h-[72vh] flex-col gap-2">
        <textarea
          ref="textarea"
          v-model="page.text"
          class="textarea h-full w-full resize-none font-mono text-sm leading-6"
          spellcheck="false"
          :aria-label="`Text von Seite ${page.number}`"
          @click="syncFromText"
          @keyup="syncFromText"
        />
        <div class="flex flex-wrap items-center gap-2 text-xs">
          <span v-if="hint" class="text-warning">{{ hint }}</span>
          <button v-if="edited" class="btn btn-xs btn-ghost ml-auto" @click="reset">Änderungen dieser Seite verwerfen</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.legend { display: inline-block; width: 1.5em; height: 0.8em; border-width: 1.5px; vertical-align: middle; margin-right: 0.25em; }
</style>
