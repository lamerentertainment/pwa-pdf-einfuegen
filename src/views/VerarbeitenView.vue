<script setup>
import { computed, nextTick, reactive, ref, toRef, watch } from 'vue';
import { ArrowDownTrayIcon, ArrowTopRightOnSquareIcon, ClipboardDocumentIcon, DocumentArrowDownIcon } from '@heroicons/vue/24/outline';
import { documentState } from '../capture/documentStore.js';
import { joinPages } from '../capture/joinPages.js';
import { MODES, processText, WORDLIST_SOURCE } from '../process/rules.js';
import { diffParagraphs } from '../process/diff.js';
import { mapPosition } from '../process/align.js';
import { findCitations } from '../process/citations.js';
import { processState } from '../process/processStore.js';
import LineBreakBackdrop from '../components/LineBreakBackdrop.vue';
import { usePreference } from '../components/usePreference.js';
import { elementVisibleTop, scrollElementTo, scrollTextareaTo, textareaVisibleTop } from '../components/textPosition.js';

// Gemeinsam mit Stufe 3 (processStore), damit diese das Ergebnis übernehmen kann
const input = toRef(processState, 'input');
const output = toRef(processState, 'output');
const mode = ref('einfuegen');
const keepParagraphs = ref(true);
const highlight = ref(true);
const copied = ref(false);
const error = ref(null);

const hasDocument = computed(() => documentState.pages.length > 0);

// Neu berechnen, wenn sich Eingabe oder Einstellungen ändern (verzögert, damit lange Texte
// beim Tippen nicht bremsen). Eigene Änderungen am Ergebnis gehen dabei verloren.
let timer;
watch([input, mode, keepParagraphs], () => {
    clearTimeout(timer);
    timer = setTimeout(run, 250);
});

function run() {
    error.value = null;
    try {
        output.value = input.value.trim() ? processText(input.value, mode.value, { keepParagraphs: keepParagraphs.value }) : '';
    } catch (err) {
        error.value = err.message;
        console.error(err);
    }
}

function fromCapture() {
    input.value = joinPages(documentState.pages);
}

// Wörter des Ergebnisses mit ihrer Lage im Ergebnistext (für die Zuordnung per Klick)
const tokens = computed(() => {
    if (!highlight.value || !output.value) return null;
    const list = diffParagraphs(input.value, output.value);
    if (!list) return null;
    let cursor = 0;
    return list.map(token => {
        const start = output.value.indexOf(token.text, cursor);
        const at = start >= 0 ? start : cursor;
        cursor = at + token.text.length;
        return { ...token, start: at, end: cursor, word: !/^\s+$/.test(token.text) };
    });
});
// Erkannte Fundstellen (wie die Makros «BGerAufruf» und «GesetzAufruf»): im Ergebnis, weil dort
// Zeilenumbrüche und Worttrennungen bereinigt sind; solange es keines gibt, in der Eingabe
const citations = computed(() => findCitations(output.value || input.value));
const citationGroups = computed(() => [
    { title: 'Bundesgerichtsentscheide', site: 'bger.li', items: citations.value.filter(c => c.kind !== 'artikel') },
    { title: 'Gesetzesartikel', site: 'fedlex.admin.ch', items: citations.value.filter(c => c.kind === 'artikel') },
].filter(group => group.items.length));

const changedCount = computed(() => tokens.value?.filter(t => t.changed).length ?? 0);

// --- Klick auf eine Stelle: entsprechende Stelle im anderen Feld auf dieselbe Höhe setzen ---
const inputEl = ref(null);
// Zeilenumbrüche von Eingabe und Ergebnis als graue Zeichen anzeigen (Standard: an, vom Browser gemerkt)
const showBreaks = usePreference('verarbeiten.umbrueche', true);
const outputEl = ref(null); // Textfeld oder hervorgehobene Ansicht
const inputBox = ref(null);
const outputBox = ref(null);
const marker = reactive({ pane: null, top: 0, height: 0, key: 0 });
const flashStart = ref(-1);
let markerTimer;

function showMarker(pane, box, el, place) {
    marker.pane = pane;
    marker.top = el.getBoundingClientRect().top - box.getBoundingClientRect().top + place.top;
    marker.height = place.height;
    marker.key++;
    clearTimeout(markerTimer);
    markerTimer = setTimeout(() => { marker.pane = null; flashStart.value = -1; }, 1600);
}

async function alignFromInput() {
    const el = inputEl.value;
    if (!output.value || !el || el.selectionStart !== el.selectionEnd) return;
    const target = mapPosition(input.value, output.value, el.selectionStart);
    if (!target) return;
    const visible = textareaVisibleTop(el, el.selectionStart);
    await nextTick();
    const out = outputEl.value;
    if (tokens.value) {
        const span = out.querySelector(`[data-start="${target.start}"]`);
        if (!span) return;
        flashStart.value = target.start;
        showMarker('output', outputBox.value, out, scrollElementTo(out, span, visible));
    } else {
        showMarker('output', outputBox.value, out, scrollTextareaTo(out, target.start, visible));
    }
}

function alignFromOutput(offset, visible) {
    const target = mapPosition(output.value, input.value, offset);
    if (!target) return;
    const el = inputEl.value;
    showMarker('input', inputBox.value, el, scrollTextareaTo(el, target.start, visible));
}

function onOutputTextClick() {
    const el = outputEl.value;
    if (el.selectionStart !== el.selectionEnd) return;
    alignFromOutput(el.selectionStart, textareaVisibleTop(el, el.selectionStart));
}

function onOutputTokenClick(event) {
    const span = event.target.closest('[data-start]');
    if (!span) return;
    flashStart.value = -1;
    alignFromOutput(Number(span.dataset.start), elementVisibleTop(outputEl.value, span));
}

async function copy() {
    await navigator.clipboard.writeText(output.value);
    copied.value = true;
    setTimeout(() => { copied.value = false; }, 2000);
}

function download() {
    const url = URL.createObjectURL(new Blob([output.value], { type: 'text/plain;charset=utf-8' }));
    const name = `${(documentState.fileName || 'text').replace(/\.pdf$/i, '')}-${mode.value}.txt`;
    Object.assign(document.createElement('a'), { href: url, download: name }).click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}
</script>

<template>
  <div class="space-y-4">
    <section class="card bg-base-100 shadow-sm">
      <div class="card-body gap-3 py-4">
        <div class="flex flex-wrap items-center gap-3">
          <h2 class="card-title">2 · Text mit hartkodierten Algorithmen transformieren (KRG-Makros)</h2>
          <div class="join ml-auto" role="radiogroup" aria-label="Umwandlung">
            <button
              v-for="(m, key) in MODES"
              :key="key"
              class="btn btn-sm join-item"
              :class="{ 'btn-primary': mode === key }"
              role="radio"
              :aria-checked="mode === key"
              @click="mode = key"
            >
              {{ m.label }}
            </button>
          </div>
        </div>
        <p class="text-sm opacity-80">
          Feste Regeln und Wortlisten, übernommen aus den KRG-Makros. Kein Modell, kein Internet: Derselbe Text
          ergibt immer dasselbe Ergebnis, und jede Änderung lässt sich hervorheben und nachprüfen.
        </p>
        <ul class="list-disc space-y-1 pl-5 text-sm opacity-80">
          <li>
            <strong>Zeilen zusammenfügen</strong> (immer): Zeilenumbrüche aus dem PDF entfernen und Worttrennungen am
            Zeilenende auflösen («Jung- geselle» → «Junggeselle»), doppelte Leerzeichen kürzen, «» durch "
            ersetzen, Frankenbeträge vereinheitlichen («CHF 50.00» → «Fr. 50.--») und typische Fehler der
            Texterkennung korrigieren («lch» → «Ich», «,,» → ").
          </li>
          <li :class="{ 'opacity-60': mode === 'einfuegen' }">
            <strong>Als Aussage (Mann/Frau)</strong> (zusätzlich): in die indirekte Rede umwandeln, also erste in dritte
            Person und Verben in den Konjunktiv, auch im Präteritum («Ich bin unschuldig» →
            «{{ mode === 'frau' ? 'Sie' : 'Er' }} sei unschuldig», «Ich ging nach Hause» → «{{ mode === 'frau' ? 'Sie' : 'Er' }} sei nach Hause gegangen»).
            Das basiert auf fest einprogrammierten Worttransformationen: Das Ergebnis immer prüfen und meist überarbeiten.
          </li>
          <li>
            <strong>Fundstellen erkennen</strong> (immer, neu): Bundesgerichtsentscheide (Geschäftsnummern wie
            6B_123/2020 und BGE 145 IV 1) und Gesetzesartikel (Art. 47 StGB, Art. 12a Abs. 2 BetmG) werden
            im Ergebnis gefunden und unten als Links angeboten: Entscheide auf bger.li, Artikel auf Fedlex. Das
            ersetzt die Makros «BGerAufruf» und «GesetzAufruf», ohne dass man die Stelle zuerst markieren muss.
            Abgerufen wird nichts; erst ein Klick öffnet einen neuen Tab.
          </li>
        </ul>
        <div class="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
          <label class="flex items-center gap-2">
            <input v-model="keepParagraphs" type="checkbox" class="checkbox checkbox-sm" /> Absätze erhalten
          </label>
          <label class="flex items-center gap-2">
            <input v-model="highlight" type="checkbox" class="checkbox checkbox-sm" /> Änderungen hervorheben
          </label>
        </div>
      </div>
    </section>

    <div class="grid gap-4 lg:grid-cols-2">
      <section class="card bg-base-100 shadow-sm">
        <div class="card-body gap-2 p-4">
          <div class="flex flex-wrap items-center gap-2">
            <h3 class="font-semibold">Eingabe</h3>
            <label class="flex items-center gap-1.5 text-xs opacity-80" title="Zeigt jeden Zeilenumbruch als graues ↵ (nur Anzeige, der Text bleibt unverändert)">
              <input v-model="showBreaks" type="checkbox" class="checkbox checkbox-xs" /> Umbrüche ↵
            </label>
            <button v-if="hasDocument" class="btn btn-xs ml-auto" @click="fromCapture">
              <DocumentArrowDownIcon class="size-4" /> Text aus Stufe 1 übernehmen
            </button>
            <button v-if="input" class="btn btn-xs btn-ghost" :class="{ 'ml-auto': !hasDocument }" @click="input = ''">Leeren</button>
          </div>
          <div ref="inputBox" class="relative">
            <LineBreakBackdrop v-if="showBreaks" :target="inputEl" :text="input" />
            <textarea
              ref="inputEl"
              v-model="input"
              class="textarea relative h-[65vh] min-h-48 w-full resize-y font-mono text-sm leading-6 [scrollbar-gutter:stable]"
              :class="{ 'bg-transparent': showBreaks }"
              placeholder="Text hier einfügen, z. B. eine Passage aus einem PDF oder einer Einvernahme …"
              spellcheck="false"
              aria-label="Eingabe"
              @click="alignFromInput"
            />
            <div v-if="marker.pane === 'input'" :key="marker.key" class="align-marker" :style="{ top: `${marker.top}px`, height: `${marker.height}px` }" />
          </div>
        </div>
      </section>

      <section class="card bg-base-100 shadow-sm">
        <div class="card-body gap-2 p-4">
          <div class="flex flex-wrap items-center gap-2">
            <h3 class="font-semibold">Ergebnis</h3>
            <label v-if="!(highlight && tokens)" class="flex items-center gap-1.5 text-xs opacity-80" title="Zeigt jeden Zeilenumbruch als graues ↵ (nur Anzeige, der Text bleibt unverändert)">
              <input v-model="showBreaks" type="checkbox" class="checkbox checkbox-xs" /> Umbrüche ↵
            </label>
            <span v-if="highlight && tokens" class="text-xs opacity-70">{{ changedCount }} Wörter verändert</span>
            <div class="ml-auto flex gap-2">
              <button class="btn btn-xs" :disabled="!output" @click="copy">
                <ClipboardDocumentIcon class="size-4" /> {{ copied ? 'Kopiert' : 'Kopieren' }}
              </button>
              <button class="btn btn-xs" :disabled="!output" @click="download">
                <ArrowDownTrayIcon class="size-4" /> .txt
              </button>
            </div>
          </div>
          <p v-if="error" class="text-sm text-error">{{ error }}</p>
          <div ref="outputBox" class="relative">
            <div
              v-if="highlight && tokens"
              ref="outputEl"
              class="relative h-[65vh] min-h-48 resize-y overflow-auto whitespace-pre-wrap rounded-field border border-base-300 p-3 font-mono text-sm leading-6"
              aria-label="Ergebnis mit hervorgehobenen Änderungen"
              data-testid="ergebnis"
              @click="onOutputTokenClick"
            ><template v-for="(token, i) in tokens" :key="i"><span
              v-if="token.word"
              :data-start="token.start"
              :class="{ 'rounded bg-warning/25': token.changed, 'flash-word': token.start === flashStart }"
            >{{ token.text }}</span><template v-else>{{ token.text }}</template></template></div>
            <LineBreakBackdrop v-if="showBreaks && !(highlight && tokens)" :target="outputEl" :text="output" />
            <textarea
              v-if="!(highlight && tokens)"
              ref="outputEl"
              v-model="output"
              class="textarea relative h-[65vh] min-h-48 w-full resize-y font-mono text-sm leading-6 [scrollbar-gutter:stable]"
              :class="{ 'bg-transparent': showBreaks }"
              spellcheck="false"
              aria-label="Ergebnis"
              @click="onOutputTextClick"
            />
            <div v-if="marker.pane === 'output'" :key="marker.key" class="align-marker" :style="{ top: `${marker.top}px`, height: `${marker.height}px` }" />
          </div>
          <p v-if="highlight && output && !tokens" class="text-xs opacity-60">Der Text ist zu lang, um Änderungen hervorzuheben.</p>
          <p class="text-xs opacity-60">
            {{ highlight ? 'Zum Bearbeiten «Änderungen hervorheben» ausschalten.' : 'Eigene Änderungen gehen verloren, wenn sich die Eingabe ändert.' }}
          </p>
        </div>
      </section>
    </div>

    <section v-if="citationGroups.length" class="card bg-base-100 shadow-sm" aria-label="Fundstellen">
      <div class="card-body gap-3 p-4">
        <div class="flex flex-wrap items-baseline gap-x-3">
          <h3 class="font-semibold">Fundstellen</h3>
          <span class="text-xs opacity-70">
            Automatisch erkannt. Ein Klick öffnet die Fundstelle in einem neuen Tab; dabei wird nur sie übertragen, nicht der Text.
          </span>
        </div>
        <div v-for="group in citationGroups" :key="group.title" class="flex flex-wrap items-center gap-2">
          <span class="w-full text-xs font-medium opacity-70 sm:w-56">{{ group.title }} <span class="font-normal">({{ group.site }})</span></span>
          <a
            v-for="item in group.items"
            :key="item.label"
            class="btn btn-xs btn-outline"
            :href="item.url"
            target="_blank"
            rel="noopener noreferrer"
            :title="`${item.label} auf ${group.site} öffnen`"
          >
            {{ item.label }}
            <span v-if="item.count > 1" class="badge badge-xs badge-ghost">{{ item.count }}×</span>
            <ArrowTopRightOnSquareIcon class="size-3.5 opacity-60" />
          </a>
        </div>
      </div>
    </section>

    <p class="text-xs opacity-60">
      Tipp: Ein Klick auf eine Stelle in einem Feld setzt die entsprechende Stelle im anderen Feld auf dieselbe Höhe.
    </p>
    <p class="text-xs opacity-60">
      Regeln und Wortlisten aus «PDF einfügen» ({{ WORDLIST_SOURCE }}), Fundstellen nach den Makros «BGerAufruf» und «GesetzAufruf».
    </p>
  </div>
</template>

<style scoped>
/* Markierung der zugeordneten Stelle: erscheint kurz und verblasst */
.align-marker {
    position: absolute;
    left: 0;
    right: 0;
    pointer-events: none;
    border-left: 3px solid var(--color-primary);
    background: color-mix(in oklab, var(--color-primary) 14%, transparent);
    animation: align-fade 1.6s ease-out forwards;
}
.flash-word { outline: 2px solid var(--color-primary); border-radius: 0.2em; }
@keyframes align-fade {
    0%, 60% { opacity: 1; }
    100% { opacity: 0; }
}
</style>
