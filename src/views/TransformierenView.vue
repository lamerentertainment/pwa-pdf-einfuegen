<script setup>
import { computed, nextTick, onActivated, onMounted, ref, watch } from 'vue';
import { ArrowDownTrayIcon, ClipboardDocumentIcon, Cog6ToothIcon, DocumentArrowDownIcon, StopIcon, SparklesIcon } from '@heroicons/vue/24/outline';
import { documentState } from '../capture/documentStore.js';
import { joinPages } from '../capture/joinPages.js';
import { processState } from '../process/processStore.js';
import { formatBytes, modelSize } from '../models/modelStore.js';
import llm, { checkWebGPU, fillPrompt, installedLlms, LLM_MODELS } from '../llm/llmService.js';
import { generateIntranet, INTRANET_ID, INTRANET_MODEL, intranet } from '../llm/intranet.js';
import { connection } from '../net/connection.js';
import { setzeEin, teileAuswahl } from '../llm/auswahl.js';
import {
    EINGEBAUT, QUELLE, aenderePrompt, duplizierePrompt, findePrompt, gruppiert, istAusgeblendet, sichtbarePrompts,
} from '../llm/promptBibliothek.js';
import PromptsDialog from '../components/PromptsDialog.vue';
import { usePreference } from '../components/usePreference.js';
import LineBreakBackdrop from '../components/LineBreakBackdrop.vue';

const emit = defineEmits(['navigate']);

const gpu = ref(null); // { ok, name } | { ok: false, reason }
const installed = ref([]);
const modelId = usePreference('transformieren.modell', '');
const presetId = usePreference('transformieren.preset', EINGEBAUT[0].id);
const dialog = ref(null);
// Zeilenumbrüche in den Textfeldern als graue Zeichen (↵) anzeigen, nur Anzeige
const showBreaks = usePreference('transformieren.umbrueche', true);
const promptEl = ref(null);
const inputEl = ref(null);
const outputEl = ref(null);
const promptTemplate = ref('');
const input = ref('');
const output = ref('');
const phase = ref('idle'); // idle | laden | erzeugen
const loadInfo = ref('');
const stats = ref(null);
const error = ref(null);
const copied = ref(false);
const loadedId = ref(null); // welches Modell im Grafikspeicher liegt

const groups = computed(() => gruppiert(sichtbarePrompts()));
// Gelöscht oder ausgeblendet: der erste sichtbare Prompt (oder, wenn alle ausgeblendet sind, der erste eingebaute)
const preset = computed(() => (!istAusgeblendet(presetId.value) && findePrompt(presetId.value)) || sichtbarePrompts()[0] || EINGEBAUT[0]);
watch(preset, p => { if (p.id !== presetId.value) presetId.value = p.id; }, { immediate: true });
// Die interne KI steht zur Wahl, sobald unter «Modelle/Programmupdate» ein API-Key gespeichert ist
const intranetModel = computed(() => (intranet.apiKey ? {
    id: INTRANET_ID,
    name: `Interne KI · ${INTRANET_MODEL}`,
    purpose: 'Läuft auf dem Server im Intranet, nicht in diesem Browser. Der Eingabetext wird dorthin gesendet.',
    remote: true,
} : null));
const choices = computed(() => [...installed.value, ...(intranetModel.value ? [intranetModel.value] : [])]);
const model = computed(() => choices.value.find(m => m.id === modelId.value));
const lokaleKi = computed(() => connection.lokaleKi);
const promptEdited = computed(() => promptTemplate.value !== preset.value.prompt);
const ready = computed(() => model.value && phase.value === 'idle' && (model.value.remote ? lokaleKi.value : gpu.value?.ok));
const canRun = computed(() => ready.value && input.value.trim());

// Markierung im Eingabefeld: nur dieser Teil geht auf Wunsch an das Sprachmodell
const auswahl = ref(null); // { start, end } oder null
function merkeAuswahl() {
    const el = inputEl.value;
    if (!el) return;
    const { selectionStart: start, selectionEnd: end } = el;
    auswahl.value = end > start && el.value.slice(start, end).trim() ? { start, end } : null;
}
watch(input, () => nextTick(merkeAuswahl));
const canRunAuswahl = computed(() => ready.value && auswahl.value);
let controller = null;

// Auch wenn ein eigener Prompt in der Bibliothek geändert wird; vorübergehende Anpassungen gehen dabei verloren
watch(() => preset.value.prompt, p => { promptTemplate.value = p; }, { immediate: true });

function alsEigenenSpeichern() {
    const id = duplizierePrompt(preset.value.id, promptTemplate.value);
    presetId.value = id;
    dialog.value.bearbeite(id);
}

function imPromptSpeichern() {
    aenderePrompt(preset.value.id, { prompt: promptTemplate.value });
}

async function refresh() {
    installed.value = await installedLlms();
    if (!choices.value.some(m => m.id === modelId.value)) modelId.value = choices.value[0]?.id ?? '';
}
watch(() => intranet.apiKey, refresh);
onMounted(async () => {
    gpu.value = await checkWebGPU();
    await refresh();
});
onActivated(refresh);

function fromStage1() {
    input.value = joinPages(documentState.pages);
}

function fromStage2() {
    input.value = processState.output;
}

/** Wendet den Prompt auf den ganzen Eingabetext an oder nur auf den markierten Teil. */
async function run(bereich = null) {
    error.value = null;
    stats.value = null;
    // Mit Markierung: nur sie geht an das Modell, das Ergebnis ersetzt sie im ganzen Text
    const teile = bereich ? teileAuswahl(input.value, bereich.start, bereich.end) : { vor: '', kern: input.value, nach: '' };
    const prompt = fillPrompt(promptTemplate.value, teile.kern);
    output.value = teile.vor;
    const onToken = text => { output.value += text; };
    const fertig = async result => {
        output.value = setzeEin(teile, result.text);
        if (!bereich) return;
        // Die umgeformte Stelle im Ergebnis markieren
        await nextTick();
        const el = outputEl.value;
        el?.focus();
        el?.setSelectionRange(teile.vor.length, output.value.length - teile.nach.length);
    };
    try {
        if (model.value.remote) {
            phase.value = 'erzeugen';
            controller = new AbortController();
            const result = await generateIntranet(prompt, { signal: controller.signal, onToken });
            await fertig(result);
            stats.value = { ...result, loadMs: 0 };
            return;
        }
        phase.value = 'laden';
        loadInfo.value = `${model.value.name} wird in den Grafikspeicher geladen …`;
        loadedId.value = null;
        const loaded = await llm.load(model.value, event => {
            if (event.file) loadInfo.value = `${model.value.name} wird geladen: ${event.file}${event.progress != null ? ` (${Math.round(event.progress)} %)` : ''}`;
        });
        loadedId.value = model.value.id;
        phase.value = 'erzeugen';
        const result = await llm.generate(prompt, { onToken });
        await fertig(result);
        stats.value = { ...result, loadMs: loaded.ms };
    } catch (err) {
        error.value = err.message;
        console.error(err);
    } finally {
        phase.value = 'idle';
        loadInfo.value = '';
        controller = null;
    }
}

function stop() {
    if (controller) controller.abort();
    else llm.stop();
}

function unload() {
    llm.unload();
    loadedId.value = null;
    stats.value = null;
}

async function copy() {
    await navigator.clipboard.writeText(output.value);
    copied.value = true;
    setTimeout(() => { copied.value = false; }, 2000);
}

function download() {
    const url = URL.createObjectURL(new Blob([output.value], { type: 'text/plain;charset=utf-8' }));
    Object.assign(document.createElement('a'), { href: url, download: `${preset.value.eingebaut ? preset.value.id : 'ergebnis'}.txt` }).click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}
</script>

<template>
  <div class="space-y-4">
    <section class="card bg-base-100 shadow-sm">
      <div class="card-body gap-4">
        <h2 class="card-title">3 · Text mit lokalen Mini-LLMs transformieren</h2>
        <p class="text-sm opacity-80">
          Ein kleines Sprachmodell formt den Text nach einem Prompt um, etwa in die indirekte Rede oder als Zusammenfassung.
          Es läuft vollständig in diesem Browser auf der Grafikkarte, ohne Internet. Das Ergebnis ist ein Entwurf und muss immer geprüft werden.
        </p>

        <div v-if="gpu && !gpu.ok && !model?.remote" role="alert" class="alert alert-warning alert-soft text-sm">
          <span>{{ gpu.reason }} Stufe 3 braucht WebGPU, zum Beispiel ein aktuelles Chrome oder Edge. Stufe 1 und 2 funktionieren trotzdem.</span>
        </div>
        <div v-if="model?.remote" role="alert" class="alert alert-info alert-soft text-sm">
          <span>
            Gewählt ist die <strong>interne KI</strong>: Der Eingabetext wird an den Server im Intranet gesendet und dort verarbeitet.
            <template v-if="!lokaleKi"> Dafür oben zuerst «Lokale KI-Anfragen» erlauben.</template>
          </span>
        </div>

        <div class="grid gap-4 md:grid-cols-2">
          <!-- Modell -->
          <div class="space-y-2">
            <p class="text-sm font-semibold">Sprachmodell</p>
            <div v-if="!choices.length" class="rounded-box border border-base-300 p-3 text-sm">
              <p>Noch kein Sprachmodell installiert. Zur Wahl stehen:</p>
              <ul class="mt-1 list-disc pl-5 text-xs opacity-80">
                <li v-for="m in LLM_MODELS" :key="m.id">{{ m.name }} ({{ formatBytes(modelSize(m)) }})</li>
              </ul>
              <button class="btn btn-xs mt-2" @click="emit('navigate', 'modelle')">Zu den Modellen</button>
            </div>
            <template v-else>
              <select v-model="modelId" class="select select-sm w-full" aria-label="Sprachmodell" :disabled="phase !== 'idle'">
                <option v-for="m in choices" :key="m.id" :value="m.id">{{ m.name }}{{ m.remote ? '' : ` · ${formatBytes(modelSize(m))}` }}</option>
              </select>
              <p v-if="model" class="text-xs opacity-70">{{ model.purpose }}</p>
              <div class="flex flex-wrap items-center gap-3 text-xs">
                <span v-if="gpu?.ok && !model?.remote" class="opacity-70">Grafikkarte: {{ gpu.name || 'WebGPU bereit' }}</span>
                <button v-if="loadedId" class="link" :disabled="phase !== 'idle'" @click="unload">Modell aus dem Grafikspeicher entfernen</button>
                <button class="link" @click="emit('navigate', 'modelle')">Weitere Modelle</button>
              </div>
            </template>
          </div>

          <!-- Prompt -->
          <div class="space-y-2">
            <p class="text-sm font-semibold">Prompt</p>
            <div class="flex items-center gap-1">
              <select v-model="presetId" class="select select-sm min-w-0 flex-1" aria-label="Prompt" :disabled="phase !== 'idle'">
                <optgroup v-for="[group, items] in groups" :key="group" :label="group">
                  <option v-for="p in items" :key="p.id" :value="p.id">{{ p.title }}</option>
                </optgroup>
              </select>
              <button class="btn btn-sm btn-ghost btn-square" title="Promptbibliothek: eigene Prompts erstellen, bearbeiten, importieren" aria-label="Promptbibliothek" @click="dialog.open(preset.id)">
                <Cog6ToothIcon class="size-5" />
              </button>
            </div>
            <p class="text-xs opacity-70">{{ preset.description }}</p>
            <details class="text-sm">
              <summary class="cursor-pointer select-none text-xs">Prompt ansehen und anpassen{{ promptEdited ? ' (angepasst)' : '' }}</summary>
              <div class="relative mt-2">
                <LineBreakBackdrop v-if="showBreaks" :target="promptEl" :text="promptTemplate" />
                <textarea
                  ref="promptEl"
                  v-model="promptTemplate"
                  class="textarea relative h-64 w-full resize-y font-mono text-xs leading-5 [scrollbar-gutter:stable]"
                  :class="{ 'bg-transparent': showBreaks }"
                  spellcheck="false"
                  aria-label="Prompt-Text"
                />
              </div>
              <div class="flex flex-wrap items-center gap-3 text-xs opacity-70">
                <span><code v-pre>{{INPUT}}</code> steht für den Eingabetext.</span>
                <template v-if="promptEdited">
                  <button v-if="preset.eingebaut" class="link" @click="alsEigenenSpeichern">Als eigenen Prompt speichern</button>
                  <button v-else class="link" @click="imPromptSpeichern">Im Prompt speichern</button>
                  <button class="link" @click="promptTemplate = preset.prompt">{{ preset.eingebaut ? 'Original' : 'Gespeicherten Prompt' }} wiederherstellen</button>
                </template>
              </div>
            </details>
          </div>
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
            <div class="ml-auto flex flex-wrap gap-2">
              <button v-if="documentState.pages.length" class="btn btn-xs" @click="fromStage1"><DocumentArrowDownIcon class="size-4" /> Aus Stufe 1</button>
              <button v-if="processState.output" class="btn btn-xs" @click="fromStage2"><DocumentArrowDownIcon class="size-4" /> Aus Stufe 2</button>
              <button v-if="input" class="btn btn-xs btn-ghost" @click="input = ''">Leeren</button>
            </div>
          </div>
          <div class="relative">
            <LineBreakBackdrop v-if="showBreaks" :target="inputEl" :text="input" />
            <textarea
              ref="inputEl"
              v-model="input"
              class="textarea relative h-[50vh] min-h-48 w-full resize-y font-mono text-sm leading-6 [scrollbar-gutter:stable]"
              :class="{ 'bg-transparent': showBreaks }"
              placeholder="Text, den das Sprachmodell umformen soll …"
              spellcheck="false"
              aria-label="Eingabe für das Sprachmodell"
              @select="merkeAuswahl"
              @keyup="merkeAuswahl"
              @mouseup="merkeAuswahl"
            />
          </div>
          <div class="flex flex-wrap items-center gap-3">
            <template v-if="phase === 'idle'">
              <button class="btn btn-primary btn-sm" :disabled="!canRun" @click="run()">
                <SparklesIcon class="size-4" /> Umformen (Prompt anwenden)
              </button>
              <button
                class="btn btn-sm"
                :disabled="!canRunAuswahl"
                :title="auswahl ? 'Nur der markierte Text geht an das Sprachmodell; das Ergebnis ersetzt ihn im ganzen Text.' : 'Zuerst im Eingabefeld Text markieren.'"
                @click="run(auswahl)"
              >
                Nur auf markierten Bereich anwenden
              </button>
            </template>
            <button v-else class="btn btn-sm" :disabled="phase === 'laden'" @click="stop">
              <StopIcon class="size-4" /> Stoppen
            </button>
            <span v-if="phase === 'laden'" class="flex items-center gap-2 text-xs opacity-80"><span class="loading loading-spinner loading-xs" /> {{ loadInfo }}</span>
            <span v-if="phase === 'erzeugen'" class="flex items-center gap-2 text-xs opacity-80"><span class="loading loading-dots loading-xs" /> Text wird erzeugt …</span>
            <span v-if="!model && choices.length === 0" class="text-xs opacity-60">Zuerst ein Sprachmodell installieren.</span>
          </div>
        </div>
      </section>

      <section class="card bg-base-100 shadow-sm">
        <div class="card-body gap-2 p-4">
          <div class="flex flex-wrap items-center gap-2">
            <h3 class="font-semibold">Ergebnis</h3>
            <label class="flex items-center gap-1.5 text-xs opacity-80" title="Zeigt jeden Zeilenumbruch als graues ↵ (nur Anzeige, der Text bleibt unverändert)">
              <input v-model="showBreaks" type="checkbox" class="checkbox checkbox-xs" /> Umbrüche ↵
            </label>
            <span v-if="stats" class="text-xs opacity-70">
              {{ stats.tokens }} Tokens in {{ (stats.ms / 1000).toFixed(1) }} s ({{ (stats.tokens / (stats.ms / 1000)).toFixed(1) }} pro Sekunde){{ stats.stopped ? ', gestoppt' : '' }}
            </span>
            <div class="ml-auto flex gap-2">
              <button class="btn btn-xs" :disabled="!output || phase !== 'idle'" @click="copy">
                <ClipboardDocumentIcon class="size-4" /> {{ copied ? 'Kopiert' : 'Kopieren' }}
              </button>
              <button class="btn btn-xs" :disabled="!output || phase !== 'idle'" @click="download"><ArrowDownTrayIcon class="size-4" /> .txt</button>
            </div>
          </div>
          <p v-if="error" class="text-sm text-error">{{ error }}</p>
          <div class="relative">
            <LineBreakBackdrop v-if="showBreaks" :target="outputEl" :text="output" />
            <textarea
              ref="outputEl"
              v-model="output"
              class="textarea relative h-[50vh] min-h-48 w-full resize-y font-mono text-sm leading-6 [scrollbar-gutter:stable]"
              :class="{ 'bg-transparent': showBreaks }"
              :readonly="phase !== 'idle'"
              spellcheck="false"
              aria-label="Ergebnis des Sprachmodells"
            />
          </div>
          <p class="text-xs opacity-60">Entwurf eines Sprachmodells: auf Vollständigkeit und Richtigkeit prüfen, bevor du ihn verwendest.</p>
        </div>
      </section>
    </div>

    <p class="text-xs opacity-60">Eingebaute Prompts aus der promptlibrary ({{ QUELLE }}); eigene speichert nur dieser Browser.</p>

    <PromptsDialog ref="dialog" @waehle="id => (presetId = id)" />
  </div>
</template>
