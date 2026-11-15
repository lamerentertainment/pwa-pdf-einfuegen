<script setup>
import { computed, ref, watch } from 'vue';
import { ArrowDownTrayIcon, ClipboardDocumentIcon, DocumentArrowDownIcon } from '@heroicons/vue/24/outline';
import { documentState } from '../capture/documentStore.js';
import { joinPages } from '../capture/joinPages.js';
import { MODES, processText, WORDLIST_SOURCE } from '../process/rules.js';
import { diffParagraphs } from '../process/diff.js';

const input = ref('');
const output = ref('');
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

const tokens = computed(() => (highlight.value && output.value ? diffParagraphs(input.value, output.value) : null));
const changedCount = computed(() => tokens.value?.filter(t => t.changed).length ?? 0);

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
          <h2 class="card-title">Stufe 2 · Text weiterverarbeiten</h2>
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
          <template v-if="mode === 'einfuegen'">
            Entfernt Zeilenumbrüche und Worttrennungen, vereinheitlicht Anführungszeichen und Frankenbeträge und
            korrigiert typische Fehler der Texterkennung («lch» → «Ich»).
          </template>
          <template v-else>
            Zusätzlich Umwandlung in die indirekte Rede: erste in dritte Person, Verben in den Konjunktiv
            («Ich bin unschuldig» → «{{ mode === 'mann' ? 'Er' : 'Sie' }} sei unschuldig»).
            Das funktioniert mit festen Wortlisten. Das Ergebnis muss immer geprüft und meist überarbeitet werden.
          </template>
          Alles läuft in diesem Browser, ohne Modell und ohne Internet.
        </p>
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
            <button v-if="hasDocument" class="btn btn-xs ml-auto" @click="fromCapture">
              <DocumentArrowDownIcon class="size-4" /> Text aus Stufe 1 übernehmen
            </button>
            <button v-if="input" class="btn btn-xs btn-ghost" :class="{ 'ml-auto': !hasDocument }" @click="input = ''">Leeren</button>
          </div>
          <textarea
            v-model="input"
            class="textarea h-[65vh] min-h-48 w-full resize-y font-mono text-sm leading-6"
            placeholder="Text hier einfügen, z. B. eine Passage aus einem PDF oder einer Einvernahme …"
            spellcheck="false"
            aria-label="Eingabe"
          />
        </div>
      </section>

      <section class="card bg-base-100 shadow-sm">
        <div class="card-body gap-2 p-4">
          <div class="flex flex-wrap items-center gap-2">
            <h3 class="font-semibold">Ergebnis</h3>
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
          <div
            v-if="highlight && tokens"
            class="h-[65vh] min-h-48 resize-y overflow-auto whitespace-pre-wrap rounded-field border border-base-300 p-3 font-mono text-sm leading-6"
            aria-label="Ergebnis mit hervorgehobenen Änderungen"
            data-testid="ergebnis"
          ><template v-for="(token, i) in tokens" :key="i"><mark v-if="token.changed" class="rounded bg-warning/25 text-inherit">{{ token.text }}</mark><template v-else>{{ token.text }}</template></template></div>
          <textarea
            v-else
            v-model="output"
            class="textarea h-[65vh] min-h-48 w-full resize-y font-mono text-sm leading-6"
            spellcheck="false"
            aria-label="Ergebnis"
          />
          <p v-if="highlight && output && !tokens" class="text-xs opacity-60">Der Text ist zu lang, um Änderungen hervorzuheben.</p>
          <p class="text-xs opacity-60">
            {{ highlight ? 'Zum Bearbeiten «Änderungen hervorheben» ausschalten.' : 'Eigene Änderungen gehen verloren, wenn sich die Eingabe ändert.' }}
          </p>
        </div>
      </section>
    </div>

    <p class="text-xs opacity-60">
      Regeln und Wortlisten aus «PDF einfügen» ({{ WORDLIST_SOURCE }}), Stufe 3 mit einem kleinen lokalen Sprachmodell folgt.
    </p>
  </div>
</template>
