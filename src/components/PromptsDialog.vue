<script setup>
// «Promptbibliothek»: eingebaute Prompts als Vorlage verwenden oder ausblenden, eigene erstellen,
// bearbeiten, löschen, exportieren und importieren. Gespeichert wird nur im Browser.
import { computed, ref } from 'vue';
import { ArrowDownTrayIcon, ArrowLeftIcon, ArrowUpTrayIcon, PlusIcon } from '@heroicons/vue/24/outline';
import {
    EIGENE_GRUPPE, MAX, aenderePrompt, allePrompts, bibliothek, duplizierePrompt, erstellePrompt, exportDaten,
    findePrompt, gruppiert, istAusgeblendet, leseImport, loeschePrompt, platzhalterHinweis, setzeAusgeblendet,
} from '../llm/promptBibliothek.js';

const emit = defineEmits(['waehle']);

const dialog = ref(null);
const bearbeiteId = ref(null);
const loeschId = ref(null);
const meldung = ref('');

function open(id = null) {
    bearbeiteId.value = id && !findePrompt(id)?.eingebaut ? id : null;
    loeschId.value = null;
    importVorschau.value = null;
    importFehler.value = '';
    meldung.value = '';
    dialog.value.showModal();
}
defineExpose({ open, bearbeite });

const gruppen = computed(() => gruppiert(allePrompts()));
const gruppenNamen = computed(() => [...new Set([EIGENE_GRUPPE, ...allePrompts().map(p => p.group)])]);

function alsVorlage(id) {
    bearbeite(duplizierePrompt(id));
}

function neu() {
    bearbeite(erstellePrompt({ title: 'Neuer Prompt', prompt: 'Anweisung an das Sprachmodell …\n\n{{INPUT}}' }));
}

function bearbeite(id) {
    bearbeiteId.value = id;
    emit('waehle', id);
    if (!dialog.value.open) dialog.value.showModal();
}

function loeschen(id) {
    loeschePrompt(id);
    loeschId.value = null;
}

// --- Export und Import ---
function exportieren() {
    const json = JSON.stringify(exportDaten(bibliothek.eigene), null, 2);
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    Object.assign(document.createElement('a'), { href: url, download: 'prompts.json' }).click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const dateiEl = ref(null);
const importVorschau = ref(null);
const importFehler = ref('');

async function dateiGewaehlt(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    importVorschau.value = null;
    importFehler.value = '';
    meldung.value = '';
    if (!file) return;
    try {
        if (file.size > 5_000_000) throw new Error('Die Datei ist zu gross.');
        importVorschau.value = leseImport(await file.text());
        if (!importVorschau.value.length) throw new Error('Die Datei enthält keine Prompts.');
    } catch (err) {
        importVorschau.value = null;
        importFehler.value = err.message;
    }
}

function importieren() {
    for (const p of importVorschau.value) erstellePrompt(p);
    meldung.value = `${importVorschau.value.length} ${importVorschau.value.length === 1 ? 'Prompt' : 'Prompts'} übernommen.`;
    importVorschau.value = null;
}

// --- Bearbeiten ---
const prompt = computed(() => (bearbeiteId.value ? findePrompt(bearbeiteId.value) : null));
const hinweis = computed(() => (prompt.value ? platzhalterHinweis(prompt.value.prompt) : null));
const setze = (feld, wert) => aenderePrompt(prompt.value.id, { [feld]: wert });
</script>

<template>
  <dialog ref="dialog" class="modal">
    <div class="modal-box flex max-h-[90vh] max-w-4xl flex-col gap-3">
      <!-- Übersicht -->
      <template v-if="!prompt">
        <h3 class="text-lg font-semibold">Promptbibliothek</h3>
        <p class="text-sm opacity-80">
          Eingebaute Prompts lassen sich nicht ändern, aber als Vorlage für einen eigenen verwenden oder
          ausblenden. Eigene Prompts speichert nur dieser Browser – mit «Exportieren» sichern oder weitergeben.
        </p>
        <div class="overflow-y-auto rounded-box border border-base-300">
          <template v-for="[gruppe, items] in gruppen" :key="gruppe">
            <div class="sticky top-0 bg-base-200 px-3 py-1 text-xs font-semibold">{{ gruppe }}</div>
            <ul class="divide-y divide-base-300">
              <li v-for="p in items" :key="p.id" class="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2" :class="{ 'opacity-60': istAusgeblendet(p.id) }">
                <div class="min-w-0 flex-1">
                  <div class="truncate font-medium">{{ p.title }}</div>
                  <div class="truncate text-xs opacity-70">
                    {{ p.eingebaut ? 'eingebaut' : 'eigen' }}<template v-if="p.description"> · {{ p.description }}</template><template v-if="istAusgeblendet(p.id)"> · ausgeblendet</template>
                  </div>
                </div>
                <template v-if="p.eingebaut">
                  <button class="btn btn-xs" @click="alsVorlage(p.id)">Als Vorlage verwenden</button>
                  <button class="btn btn-xs btn-ghost" @click="setzeAusgeblendet(p.id, !istAusgeblendet(p.id))">
                    {{ istAusgeblendet(p.id) ? 'Einblenden' : 'Ausblenden' }}
                  </button>
                </template>
                <template v-else-if="loeschId === p.id">
                  <span class="text-xs">Endgültig löschen?</span>
                  <button class="btn btn-xs btn-error" @click="loeschen(p.id)">Löschen</button>
                  <button class="btn btn-xs btn-ghost" @click="loeschId = null">Abbrechen</button>
                </template>
                <template v-else>
                  <button class="btn btn-xs" @click="bearbeite(p.id)">Bearbeiten</button>
                  <button class="btn btn-xs btn-ghost" @click="alsVorlage(p.id)">Duplizieren</button>
                  <button class="btn btn-xs btn-ghost text-error" @click="loeschId = p.id">Löschen</button>
                </template>
              </li>
            </ul>
          </template>
        </div>

        <div v-if="importVorschau" class="rounded-box border border-primary/40 bg-primary/5 p-3 text-sm">
          <p class="font-medium">In der Datei gefunden:</p>
          <ul class="my-1 list-disc pl-5">
            <li v-for="(p, i) in importVorschau" :key="i">{{ p.title }} <span class="opacity-70">({{ p.group }})</span></li>
          </ul>
          <p class="text-xs opacity-70">Wird zusätzlich zu den bestehenden gespeichert; nichts wird überschrieben.</p>
          <div class="mt-2 flex gap-2">
            <button class="btn btn-sm btn-primary" @click="importieren">Übernehmen</button>
            <button class="btn btn-sm btn-ghost" @click="importVorschau = null">Abbrechen</button>
          </div>
        </div>
        <p v-if="importFehler" class="text-sm text-error">{{ importFehler }}</p>
        <p v-if="meldung" class="text-sm text-success">{{ meldung }}</p>

        <div class="flex flex-wrap gap-2">
          <button class="btn btn-sm" @click="neu"><PlusIcon class="size-4" /> Neuer Prompt</button>
          <button class="btn btn-sm btn-ghost" :disabled="!bibliothek.eigene.length" @click="exportieren">
            <ArrowDownTrayIcon class="size-4" /> Exportieren
          </button>
          <button class="btn btn-sm btn-ghost" @click="dateiEl.click()"><ArrowUpTrayIcon class="size-4" /> Importieren …</button>
          <input ref="dateiEl" type="file" accept=".json,application/json" class="hidden" @change="dateiGewaehlt" />
          <form method="dialog" class="ml-auto"><button class="btn btn-sm">Schliessen</button></form>
        </div>
      </template>

      <!-- Bearbeiten -->
      <template v-else>
        <div class="flex flex-wrap items-center gap-2">
          <button class="btn btn-sm btn-ghost" @click="bearbeiteId = null"><ArrowLeftIcon class="size-4" /> Alle</button>
          <h3 class="text-lg font-semibold">Prompt bearbeiten</h3>
        </div>
        <div class="grid gap-2 sm:grid-cols-2">
          <label class="flex flex-col gap-0.5 text-xs">
            Titel
            <input
              :value="prompt.title"
              class="input input-sm w-full font-semibold"
              :maxlength="MAX.title"
              @change="e => setze('title', e.target.value)"
            />
          </label>
          <label class="flex flex-col gap-0.5 text-xs">
            Gruppe
            <input
              :value="prompt.group"
              class="input input-sm w-full"
              list="prompt-gruppen"
              :maxlength="MAX.group"
              @change="e => setze('group', e.target.value)"
            />
            <datalist id="prompt-gruppen"><option v-for="g in gruppenNamen" :key="g" :value="g" /></datalist>
          </label>
        </div>
        <label class="flex flex-col gap-0.5 text-xs">
          Beschreibung (erscheint unter der Auswahl)
          <input
            :value="prompt.description"
            class="input input-sm w-full"
            :maxlength="MAX.description"
            @change="e => setze('description', e.target.value)"
          />
        </label>
        <label class="flex min-h-0 flex-1 flex-col gap-0.5 text-xs">
          Prompt
          <textarea
            :value="prompt.prompt"
            class="textarea min-h-64 w-full flex-1 resize-y font-mono text-xs leading-5"
            spellcheck="false"
            :maxlength="MAX.prompt"
            @input="e => setze('prompt', e.target.value)"
          />
        </label>
        <p class="text-xs" :class="hinweis ? 'text-warning' : 'opacity-70'">
          <template v-if="hinweis">{{ hinweis }}</template>
          <template v-else><code v-pre>{{INPUT}}</code> steht für den Eingabetext.</template>
          Änderungen werden sofort gespeichert.
        </p>
        <div class="flex justify-end">
          <form method="dialog"><button class="btn btn-sm">Fertig</button></form>
        </div>
      </template>
    </div>
    <form method="dialog" class="modal-backdrop"><button>schliessen</button></form>
  </dialog>
</template>
