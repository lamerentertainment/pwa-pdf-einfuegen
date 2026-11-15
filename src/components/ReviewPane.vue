<script setup>
// Prüfansicht: links die PDF-Seite mit den erkannten Zeilen, rechts der erfasste Text dieser Seite.
// Ein Klick auf eine Zeile im PDF markiert sie im Text, ein Klick im Text markiert die Zeile im PDF.
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { ChevronLeftIcon, ChevronRightIcon } from '@heroicons/vue/24/outline';
import PageView from './PageView.vue';
import { documentState, relayoutDocument } from '../capture/documentStore.js';
import { hasMarkdownTable, renderMarkdown } from '../capture/markdown.js';
import { usePreference } from './usePreference.js';
import { UNCERTAIN_SCORE } from '../capture/options.js';
import { useResizable } from './useResizable.js';

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
const splitBox = ref(null);
const layout = useResizable('pruefansicht', { ratio: 0.5 });

// Darstellung rechts: bearbeitbarer Text oder gerendertes Markdown (Tabellen, Listen, Überschriften)
const view = usePreference('pruefansicht.ansicht', 'text');
const wrapLines = usePreference('pruefansicht.umbruch', true);
const rendered = computed(() => (view.value === 'markdown' ? renderMarkdown(page.value.text) : ''));
const pageHasTable = computed(() => hasMarkdownTable(page.value.text));

// Textaufbau nachträglich ändern – aus den erkannten Zeilen, ohne neue Texterkennung
const LAYOUT_KEYS = ['tables', 'structure', 'keepLineNumbers', 'markUncertain'];
const draft = reactive(Object.fromEntries(LAYOUT_KEYS.map(key => [key, documentState.options[key]])));
const draftChanged = computed(() => LAYOUT_KEYS.some(key => draft[key] !== documentState.options[key]));
const anyEdited = computed(() => documentState.pages.some(p => p.text !== p.originalText));
const confirmRelayout = ref(false);

function applyRelayout() {
    if (anyEdited.value && !confirmRelayout.value) {
        confirmRelayout.value = true;
        return;
    }
    relayoutDocument({ ...draft });
    confirmRelayout.value = false;
}

function cancelRelayout() {
    for (const key of LAYOUT_KEYS) draft[key] = documentState.options[key];
    confirmRelayout.value = false;
}

function enableTables() {
    draft.tables = true;
    applyRelayout();
}

// Nebeneinander erst ab 1024 px Breite
const media = window.matchMedia('(min-width: 1024px)');
const wide = ref(media.matches);
const onMedia = event => { wide.value = event.matches; };
media.addEventListener('change', onMedia);
onBeforeUnmount(() => media.removeEventListener('change', onMedia));
onMounted(() => layout.fitToWindow(splitBox.value));

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
    // Markieren geht nur im bearbeitbaren Text
    if (view.value !== 'text') {
        view.value = 'text';
        await nextTick();
    }
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

    <div class="flex flex-wrap items-start gap-x-5 gap-y-2 text-sm">
      <div class="join" role="radiogroup" aria-label="Darstellung des Texts">
        <button class="btn btn-xs join-item" :class="{ 'btn-primary': view === 'text' }" role="radio" :aria-checked="view === 'text'" @click="view = 'text'">Text</button>
        <button class="btn btn-xs join-item" :class="{ 'btn-primary': view === 'markdown' }" role="radio" :aria-checked="view === 'markdown'" @click="view = 'markdown'">Markdown</button>
      </div>
      <label v-if="view === 'text'" class="flex items-center gap-2">
        <input v-model="wrapLines" type="checkbox" class="checkbox checkbox-xs" /> Zeilen umbrechen
      </label>
      <details class="ml-auto" @toggle="cancelRelayout">
        <summary class="cursor-pointer select-none">Textaufbau anpassen</summary>
        <div class="mt-2 flex flex-col gap-1.5 rounded-box border border-base-300 bg-base-100 p-3">
          <label class="flex items-center gap-2"><input v-model="draft.tables" type="checkbox" class="checkbox checkbox-xs" /> Tabellen als Markdown-Tabellen</label>
          <label class="flex items-center gap-2"><input v-model="draft.structure" type="checkbox" class="checkbox checkbox-xs" /> Einrückungen und Spalten-Text erhalten</label>
          <label class="flex items-center gap-2"><input v-model="draft.keepLineNumbers" type="checkbox" class="checkbox checkbox-xs" /> Zeilennummern am Rand behalten</label>
          <label class="flex items-center gap-2"><input v-model="draft.markUncertain" type="checkbox" class="checkbox checkbox-xs" /> Unsichere Zeilen mit [?] markieren</label>
          <p class="text-xs opacity-70">Der Text wird aus den bereits erkannten Zeilen neu aufgebaut, ohne neue Texterkennung.</p>
          <p v-if="confirmRelayout" class="text-xs text-warning">Deine Bearbeitungen gehen dabei verloren. Nochmals klicken zum Bestätigen.</p>
          <button class="btn btn-xs btn-primary self-start" :disabled="!draftChanged" @click="applyRelayout">
            {{ confirmRelayout ? 'Trotzdem neu aufbauen' : 'Text neu aufbauen' }}
          </button>
        </div>
      </details>
    </div>

    <!-- Breit: PDF und Text nebeneinander, Trenner seitlich und Höhe unten ziehbar.
         Schmal: untereinander. -->
    <div
      ref="splitBox"
      class="flex gap-0"
      :class="wide ? 'flex-row' : 'flex-col gap-4'"
      :style="wide ? { height: `${layout.size.value}px` } : null"
    >
      <div
        class="overflow-auto rounded-box bg-base-300 p-3"
        :class="wide ? 'min-w-0' : 'h-[70vh]'"
        :style="wide ? { width: `${layout.split.value * 100}%` } : null"
      >
        <PageView
          :pdf="documentState.pdf"
          :page="page"
          :show-boxes="showBoxes"
          :show-regions="showRegions"
          :active-index="activeBox"
          @select="selectBox"
        />
      </div>
      <div
        v-if="wide"
        class="group flex w-4 shrink-0 cursor-col-resize items-center justify-center focus:outline-none"
        role="separator"
        aria-orientation="vertical"
        aria-label="Breite von PDF und Text ändern"
        :aria-valuenow="Math.round(layout.split.value * 100)"
        tabindex="0"
        title="Ziehen, um die Breite zu ändern (Doppelklick: zurücksetzen)"
        @pointerdown="layout.startSplit($event, splitBox)"
        @keydown="layout.splitKey"
        @dblclick="layout.reset()"
      >
        <span class="h-16 w-1 rounded-full bg-base-content/25 transition-colors group-hover:bg-primary group-focus:bg-primary" />
      </div>
      <div class="flex min-w-0 flex-1 flex-col gap-2" :class="{ 'h-[70vh]': !wide }">
        <template v-if="view === 'markdown'">
          <div v-if="!documentState.options.tables" role="note" class="alert alert-info alert-soft py-2 text-xs">
            <span>Tabellen erscheinen hier, wenn der Textaufbau sie als Markdown-Tabellen erkennt.</span>
            <button class="btn btn-xs" @click="enableTables">{{ confirmRelayout ? 'Trotzdem (Bearbeitungen gehen verloren)' : 'Tabellen erkennen' }}</button>
          </div>
          <!-- Bereinigt durch DOMPurify (src/capture/markdown.js) -->
          <div
            class="markdown h-full overflow-auto rounded-field border border-base-300 bg-base-100 p-4 text-sm"
            data-testid="markdown"
            :aria-label="`Seite ${page.number} als Markdown`"
            v-html="rendered"
          />
          <p v-if="documentState.options.tables && !pageHasTable" class="text-xs opacity-60">Auf dieser Seite wurde keine Tabelle erkannt.</p>
        </template>
        <textarea
          v-else
          ref="textarea"
          v-model="page.text"
          class="textarea h-full w-full resize-none font-mono text-sm leading-6"
          :class="{ 'overflow-x-auto whitespace-pre': !wrapLines }"
          :wrap="wrapLines ? 'soft' : 'off'"
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
    <div
      v-if="wide"
      class="group -mt-1 flex h-4 cursor-row-resize items-center justify-center focus:outline-none"
      role="separator"
      aria-orientation="horizontal"
      aria-label="Höhe der Prüfansicht ändern"
      tabindex="0"
      title="Ziehen, um die Höhe zu ändern (Doppelklick: zurücksetzen)"
      @pointerdown="layout.startHeight"
      @keydown="layout.heightKey"
      @dblclick="layout.reset()"
    >
      <span class="h-1 w-16 rounded-full bg-base-content/25 transition-colors group-hover:bg-primary group-focus:bg-primary" />
    </div>
  </div>
</template>

<style scoped>
.legend { display: inline-block; width: 1.5em; height: 0.8em; border-width: 1.5px; vertical-align: middle; margin-right: 0.25em; }
</style>
