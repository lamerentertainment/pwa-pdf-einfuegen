<script setup>
import { computed, nextTick, onActivated, onMounted, ref, watch, watchEffect } from 'vue';
import { ArrowUpTrayIcon, ChevronDownIcon, ClipboardDocumentIcon, ArrowDownTrayIcon, XMarkIcon } from '@heroicons/vue/24/outline';
import ReviewPane from '../components/ReviewPane.vue';
import { cancel, closeDocument, documentState, openFile } from '../capture/documentStore.js';
import { joinPages } from '../capture/joinPages.js';
import { planPagination } from '../capture/actPagination.js';
import ocrService from '../ocr/ocrService.js';
import { EXAMPLES, exampleUrl, loadExample } from '../capture/examples.js';
import { formatBytes, models, modelSize } from '../models/modelStore.js';
import ModelInfo from '../components/ModelInfo.vue';
import { usePreference } from '../components/usePreference.js';

const emit = defineEmits(['navigate']);

// Status aller Modelle der Erfassung, nach ID
const status = ref({});
const captureModels = models.filter(model => model.stage === 1);
const isInstalledId = id => Boolean(status.value[id]);
const isInstalled = model => isInstalledId(model.id);

// «Aktiviert» merkt sich der Browser (nur die Einstellung). Wirksam ist ein Modell, wenn es
// installiert und aktiviert ist; das Layoutmodell zusätzlich nur mit wirksamer Texterkennung.
const active = { ocr: usePreference('erfassen.texterkennung', true), layout: usePreference('erfassen.layoutmodell', false) };
const modelById = id => captureModels.find(m => m.id === id);
const isEffective = model => isInstalled(model) && active[model.option].value
    && (!model.requires || isEffective(modelById(model.requires)));
const canActivate = model => isInstalled(model) && (!model.requires || isEffective(modelById(model.requires)));
// Die Erfassung prüft die Installation selbst (und meldet ein fehlendes Modell); hier zählt,
// ob ausgeschaltet. Das Layoutmodell nur mit wirksamer Texterkennung.
watchEffect(() => {
    for (const model of captureModels) {
        documentState.options[model.option] = active[model.option].value
            && (!model.requires || isEffective(modelById(model.requires)));
    }
});
const ocrEffective = computed(() => captureModels.some(m => m.option === 'ocr' && isEffective(m)));
const dragging = ref(false);
const fileInput = ref(null);
const pageMarkers = ref(false);
const copied = ref(false);
const exampleMenu = ref(null);
// Hover-Kästen (Modelle nach ID, «textaufbau»), die per Klick auf den Titel eingeklappt wurden
// (bis die Maus den Bereich verlässt)
const collapsed = ref(new Set());
function toggleDetails(id) {
    const next = new Set(collapsed.value);
    if (!next.delete(id)) next.add(id);
    collapsed.value = next;
}
function resetDetails(id) {
    if (!collapsed.value.has(id)) return;
    const next = new Set(collapsed.value);
    next.delete(id);
    collapsed.value = next;
}

async function refreshModels() {
    status.value = Object.fromEntries(await Promise.all(
        captureModels.map(async model => [model.id, await ocrService.isInstalled(model.id)]),
    ));
}
onMounted(refreshModels);
onActivated(refreshModels);

const hasDocument = computed(() => documentState.pages.length > 0);
// Seitenmarker mit Aktenpaginierung, wenn der Dateiname einer Konvention folgt (actPagination.js).
// Bewusst ohne Hinweis in der Oberfläche, solange keine Konvention erkannt wird.
const paginationPlan = computed(() => documentState.fileName
    ? planPagination(documentState.fileName, documentState.pages.length) : null);
const pageStart = computed(() => documentState.pageStart ?? paginationPlan.value?.start);
const pageName = computed(() => {
    const plan = paginationPlan.value;
    return plan ? n => plan.pagination.name(pageStart.value + n - 1) : undefined;
});
const fullText = computed(() => joinPages(documentState.pages, { pageMarkers: pageMarkers.value, pageName: pageName.value }));

// Erklärt, woher der erste Beleg kommt
const paginationInfo = computed(() => {
    const plan = paginationPlan.value;
    if (!plan) return '';
    const { pagination: { name, first }, excerpt } = plan;
    const start = name(pageStart.value);
    if (documentState.pageStart !== null && documentState.pageStart !== plan.start) {
        return `Seitenmarker ab ${start} (von Hand gesetzt).`;
    }
    if (excerpt) {
        return `Ausschnitt aus «${excerpt.source}», das bei ${name(first)} beginnt. Die erste Seite des Ausschnitts ist dort `
            + `Seite ${excerpt.from}, also ${excerpt.from - 1} Belege weiter: Seitenmarker ab ${start}.`;
    }
    return `Seitenmarker ab ${start}, nach dem Dateinamen.`;
});

// Fragt den ersten Beleg, wenn der Dateiname ihn nicht bestimmt – erst, wenn Seitenmarker an sind
const startDialog = ref(null);
const startInput = ref(null);
const startValue = ref('');
const startValid = computed(() => /^\d+$/.test(String(startValue.value).trim()));
const startPreview = computed(() => {
    const plan = paginationPlan.value;
    if (!plan || !startValid.value) return '';
    const start = Number(startValue.value);
    return `${plan.pagination.name(start)} bis ${plan.pagination.name(start + documentState.pages.length - 1)}`;
});
const startQuestion = computed(() => {
    const plan = paginationPlan.value;
    if (!plan?.ask) return '';
    const { pagination: { name, first, last, scope }, excerpt, ask } = plan;
    const file = `«${documentState.fileName}»`;
    const count = documentState.pages.length;
    const pages = excerpt && (excerpt.from === excerpt.to ? excerpt.from : `${excerpt.from}–${excerpt.to}`);
    switch (ask) {
        case 'mismatch':
            return `Der Dateiname ${file} nennt ${last - first + 1} Belege (${name(first)} bis ${name(last)}), das PDF hat aber ${count} Seiten.`;
        case 'open':
            return `Der Dateiname ${file} nennt nur den Anfang (${name(first)} ff.).`;
        case 'register':
            return `Der Dateiname ${file} nennt nur das Register (${scope}).`;
        case 'excerptRegister':
            return `${file} enthält Seite ${pages} aus «${excerpt.source}», das nur das Register nennt (${scope}). `
                + 'Beginnt das Register mit Beleg 1, ist der Vorschlag richtig.';
        default:
            return `${file} enthält Seite ${pages} aus «${excerpt.source}», das passt aber nicht zu den ${count} Seiten `
                + 'des PDFs bzw. zu den Belegen im Dateinamen.';
    }
});

async function askPageStart() {
    startValue.value = String(pageStart.value);
    startDialog.value.showModal();
    await nextTick();
    startInput.value?.select();
}
function confirmPageStart() {
    if (!startValid.value) return;
    documentState.pageStart = Number(startValue.value);
    startDialog.value.close();
}
function keepPageStart() {
    documentState.pageStart = paginationPlan.value.start;
    startDialog.value.close();
}
watch([pageMarkers, paginationPlan], ([markers, plan]) => {
    if (markers && plan?.ask && documentState.pageStart === null) askPageStart();
});
const stats = computed(() => {
    const pages = documentState.pages;
    return {
        total: pages.length,
        ocr: pages.filter(p => p.source === 'ocr' || p.source === 'ocr-layout').length,
        edited: pages.filter(p => p.text !== p.originalText).length,
    };
});

function pick(files) {
    const file = [...files].find(f => f.type === 'application/pdf' || /\.pdf$/i.test(f.name));
    if (!file) {
        documentState.error = 'Bitte eine PDF-Datei wählen.';
        return;
    }
    openFile(file);
}

function onDrop(event) {
    dragging.value = false;
    pick(event.dataTransfer.files);
}

async function openExample(example) {
    if (exampleMenu.value) exampleMenu.value.open = false;
    try {
        openFile(await loadExample(example));
    } catch (err) {
        documentState.error = err.message;
    }
}

async function copyAll() {
    await navigator.clipboard.writeText(fullText.value);
    copied.value = true;
    setTimeout(() => { copied.value = false; }, 2000);
}

function download() {
    // Die Datei entsteht im Browser und wird direkt gespeichert – kein Upload
    const blob = new Blob([fullText.value], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), {
        href: url,
        download: `${(documentState.fileName || 'dokument').replace(/\.pdf$/i, '')}.txt`,
    });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function noticeText(notice) {
    switch (notice.type) {
        case 'model-missing':
            return `${notice.count} Seite${notice.count === 1 ? ' ist' : 'n sind'} gescannt. Das Texterkennungsmodell ist nicht installiert, `
                + 'darum wurde nur übernommen, was als Text im PDF steckt (bei Scans meist nichts oder eine fehlerhafte Textebene des Scanners).';
        case 'ocr-off':
            return `${notice.count} Seite${notice.count === 1 ? ' ist' : 'n sind'} gescannt. Die Texterkennung ist ausgeschaltet, `
                + 'darum wurde nur übernommen, was als Text im PDF steckt (bei Scans meist nichts oder eine fehlerhafte Textebene des Scanners).';
        case 'ocr-failed':
            return `Texterkennung auf Seite ${notice.page} fehlgeschlagen: ${notice.message}. Der eingebettete Text der Seite wurde behalten.`;
        case 'layout-failed':
            return `Das Layoutmodell konnte nicht gestartet werden (${notice.message}). Die Seiten wurden ohne erkannt.`;
        default:
            return notice.message ?? notice.type;
    }
}
</script>

<template>
  <div class="space-y-4">
    <!-- Datei wählen -->
    <section v-if="!hasDocument" class="card bg-base-100 shadow-sm">
      <div class="card-body gap-4">
        <h2 class="card-title">1 · PDF-Seiten (mit Text- und/oder Layouterkennung) erfassen</h2>
        <p class="text-sm opacity-80">
          Bei digital erzeugten PDF wird der mitgelieferte Text ausgelesen. Gescannte Seiten werden, soweit aktiviert,
          mit den lokal installierten Text- und Layouterkennungsmodellen gelesen.
          Danach stehen PDF und Text zur Prüfung und Korrektur der Erfassung nebeneinander.
          Das PDF verlässt dabei deinen Browser nie und wird nicht dauerhaft gespeichert.
        </p>

        <!-- 1. Modelle und Einstellungen: vor dem Einlesen festlegen -->
        <div class="space-y-4 rounded-box border border-base-300 p-4">
          <h3 class="font-semibold">1 · Modelle und Einstellungen</h3>

          <div>
            <div class="grid items-start gap-3 xl:grid-cols-2">
              <div
                v-for="model in captureModels"
                :key="model.id"
                class="group relative flex flex-col gap-3 rounded-box border p-3 hover:z-30 has-[:focus-visible]:z-30 has-[select:focus]:z-30"
                :class="isInstalled(model) ? 'border-success/40 bg-success/5' : 'border-base-300'"
                :data-model="model.id"
                @mouseleave="resetDetails(model.id)"
              >
                <div class="flex items-start justify-between gap-3">
                  <div class="min-w-0">
                    <button
                      type="button"
                      class="flex cursor-pointer items-center gap-1 text-left font-medium"
                      :aria-expanded="!collapsed.has(model.id)"
                      :title="collapsed.has(model.id) ? 'Details einblenden' : 'Details einklappen'"
                      data-testid="modell-titel"
                      @click="toggleDetails(model.id)"
                    >
                      {{ model.name }}
                      <ChevronDownIcon
                        class="size-3.5 opacity-50 transition-transform"
                        :class="{ 'group-hover:rotate-180': !collapsed.has(model.id) }"
                        aria-hidden="true"
                      />
                    </button>
                    <p class="text-xs opacity-70">{{ model.summary ?? model.purpose }} {{ formatBytes(modelSize(model)) }}.</p>
                  </div>
                  <div class="flex shrink-0 flex-wrap items-center justify-end gap-x-3 gap-y-1">
                    <span class="badge badge-sm whitespace-nowrap" :class="isInstalled(model) ? 'badge-success' : 'badge-warning'">
                      {{ isInstalled(model) ? '✓ installiert' : 'nicht installiert' }}
                    </span>
                    <label class="flex items-center gap-1.5 text-sm" :class="{ 'opacity-50': !canActivate(model) }">
                      <input
                        v-model="active[model.option].value"
                        type="checkbox"
                        class="toggle toggle-sm toggle-success"
                        :disabled="!canActivate(model)"
                        :aria-label="`${model.name} aktiviert`"
                        data-testid="aktiviert"
                      />
                      {{ active[model.option].value ? 'aktiviert' : 'deaktiviert' }}
                    </label>
                  </div>
                </div>
                <p v-if="!isInstalled(model)" class="flex flex-wrap items-center gap-2 text-xs">
                  <span class="opacity-70">Zum Aktivieren zuerst installieren.</span>
                  <button class="btn btn-xs" @click="emit('navigate', 'modelle')">Installieren …</button>
                </p>
                <p v-else-if="model.requires && !canActivate(model)" class="text-xs text-warning">
                  Braucht die installierte und aktivierte {{ modelById(model.requires)?.name }}.
                </p>

                <!-- Einstellungen und Details: nur eingeblendet, solange die Maus über der Karte
                     oder dem Kasten ist (bzw. ein Feld darin per Tastatur oder Auswahlliste fokussiert).
                     Klick auf den Titel klappt ihn ein bzw. wieder aus. -->
                <div
                  v-show="!collapsed.has(model.id)"
                  class="absolute inset-x-0 top-full z-30 hidden pt-1 group-hover:block group-has-[:focus-visible]:block group-has-[select:focus]:block"
                  data-testid="modell-details"
                >
                  <div class="flex flex-col gap-3 rounded-box border border-base-300 bg-base-100 p-3 shadow-lg">
                    <!-- Einstellungen, die zu diesem Modell gehören -->
                    <p class="-mb-1.5 text-xs font-semibold uppercase tracking-wide opacity-70">Modellkonfiguration</p>
                    <div
                      v-if="model.option === 'ocr'"
                      class="flex flex-col gap-1.5 text-sm"
                      :class="{ 'opacity-50': !isEffective(model) }"
                    >
                      <label class="flex items-center gap-2">
                        <input v-model="documentState.options.markUncertain" type="checkbox" class="checkbox checkbox-sm" :disabled="!isEffective(model)" />
                        Unsichere Zeilen im Text mit [?] markieren
                      </label>
                      <label class="flex items-start gap-2">
                        <input v-model="documentState.options.forceOcr" type="checkbox" class="checkbox checkbox-sm mt-0.5" :disabled="!isEffective(model)" data-testid="force-ocr" />
                        <span>
                          Auch digitale Seiten erkennen
                          <span class="block text-xs opacity-70">Übergeht den eingebetteten Text und liest jede Seite mit der Texterkennung (und dem Layoutmodell, falls aktiviert). Langsamer.</span>
                        </span>
                      </label>
                    </div>
                    <div
                      v-if="model.option === 'layout'"
                      class="flex flex-col gap-1.5 text-sm"
                      :class="{ 'opacity-50': !isEffective(model) }"
                      data-testid="layout-optionen"
                    >
                      <label class="flex items-center gap-2">
                        <input v-model="documentState.options.headings" type="checkbox" class="checkbox checkbox-sm" :disabled="!isEffective(model)" />
                        Überschriften als Markdown (#) formatieren
                      </label>
                      <label class="flex items-center gap-2">
                        Fussnoten
                        <select v-model="documentState.options.footnotes" class="select select-xs w-auto" :disabled="!isEffective(model)" aria-label="Fussnoten">
                          <option value="seite">an ihrer Stelle belassen</option>
                          <option value="dokument">ans Dokumentende setzen</option>
                          <option value="markdown">als Markdown-Fussnoten [^1] ans Dokumentende setzen</option>
                        </select>
                      </label>
                      <label class="flex items-center gap-2">
                        <input v-model="documentState.options.placeholders" type="checkbox" class="checkbox checkbox-sm" :disabled="!isEffective(model)" />
                        Platzhalter für Bilder (mit Bildunterschrift) und Stempel
                      </label>
                    </div>

                    <div class="space-y-2 border-t border-base-300 pt-2 text-sm">
                      <p class="text-xs font-semibold uppercase tracking-wide opacity-70">Was das Modell kann</p>
                      <p v-if="model.summary" class="text-xs opacity-70">{{ model.purpose }}</p>
                      <ModelInfo :model="model" compact bare />
                      <p class="text-xs opacity-70">{{ model.usage }}</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Konfiguration des Textaufbaus: Optionen nur beim Darüberfahren (Klick auf den Titel klappt ein) -->
          <div class="group relative w-fit" @mouseleave="resetDetails('textaufbau')">
            <button
              type="button"
              class="flex cursor-pointer items-center gap-1 text-left text-sm font-semibold"
              :aria-expanded="!collapsed.has('textaufbau')"
              :title="collapsed.has('textaufbau') ? 'Optionen einblenden' : 'Optionen einklappen'"
              data-testid="textaufbau-titel"
              @click="toggleDetails('textaufbau')"
            >
              Konfiguration des Textaufbaus
              <ChevronDownIcon
                class="size-3.5 opacity-50 transition-transform"
                :class="{ 'group-hover:rotate-180': !collapsed.has('textaufbau') }"
                aria-hidden="true"
              />
            </button>
            <div
              v-show="!collapsed.has('textaufbau')"
              class="absolute left-0 top-full z-30 hidden w-max max-w-[min(42rem,calc(100vw-4rem))] pt-1 group-hover:block group-has-[:focus-visible]:block"
              data-testid="textaufbau-optionen"
            >
              <div class="flex flex-col gap-3 rounded-box border border-base-300 bg-base-100 p-3 shadow-lg">
                <p class="text-xs opacity-70">
                  Braucht kein Modell und lässt sich später in der Prüfansicht ändern, ohne das PDF neu einzulesen.
                </p>
                <div class="flex flex-col gap-1.5 text-sm">
                  <label class="flex items-center gap-2">
                    <input v-model="documentState.options.structure" type="checkbox" class="checkbox checkbox-sm" />
                    Einrückungen und Spalten-Formatierung erhalten
                  </label>
                  <label class="flex items-center gap-2">
                    <input v-model="documentState.options.tables" type="checkbox" class="checkbox checkbox-sm" />
                    <span>
                      Tabellen als Markdown formatieren
                      <span class="text-xs opacity-70">{{ documentState.options.layout ? '(Scans: in den Tabellenbereichen des Layoutmodells, ab 2 Spalten; sonst ab 3 Spalten)' : '(ab 3 Spalten)' }}</span>
                    </span>
                  </label>
                  <label class="flex items-center gap-2">
                    <input v-model="documentState.options.lists" type="checkbox" class="checkbox checkbox-sm" />
                    Aufzählungen mit «-» als Markdown formatieren
                  </label>
                  <label class="flex items-center gap-2">
                    <input v-model="documentState.options.keepLineNumbers" type="checkbox" class="checkbox checkbox-sm" />
                    Allfällige bestehende Zeilennummern am linken Rand beibehalten
                  </label>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- 2. PDF wählen -->
        <div class="space-y-3">
          <h3 class="font-semibold">2 · PDF wählen</h3>
          <div
            class="flex flex-col items-center justify-center gap-3 rounded-box border-2 border-dashed p-10 text-center transition-colors"
            :class="dragging ? 'border-primary bg-base-200' : 'border-base-300'"
            @dragover.prevent="dragging = true"
            @dragleave.prevent="dragging = false"
            @drop.prevent="onDrop"
          >
            <template v-if="documentState.busy">
              <p class="text-sm">{{ documentState.status }}</p>
              <progress class="progress w-full max-w-md" :value="Math.round(documentState.progress * 100)" max="100" />
              <button class="btn btn-sm" @click="cancel">Abbrechen</button>
            </template>
            <template v-else>
              <ArrowUpTrayIcon class="size-8 opacity-50" />
              <p class="text-sm">PDF hierher ziehen oder</p>
              <div class="flex flex-wrap items-center justify-center gap-2">
                <button class="btn btn-primary btn-sm" @click="fileInput.click()">PDF auswählen</button>
                <!-- Beispiele zum Ausprobieren, bewusst unauffällig in einem Menü -->
                <details ref="exampleMenu" class="dropdown dropdown-center">
                  <summary class="btn btn-ghost btn-sm">Beispiel öffnen <ChevronDownIcon class="size-4" /></summary>
                  <ul class="menu dropdown-content z-10 mt-1 w-80 rounded-box border border-base-300 bg-base-100 p-2 text-left shadow-lg">
                    <li v-for="example in EXAMPLES" :key="example.file">
                      <button class="flex flex-col items-start gap-0.5" @click="openExample(example)">
                        <span class="font-medium">{{ example.title }}</span>
                        <span class="text-xs opacity-70">{{ example.description }}</span>
                        <span v-if="example.needsOcr && !ocrEffective" class="text-xs text-warning">
                          Ohne Texterkennung nur mit der fehlerhaften Textebene des Scanners
                        </span>
                      </button>
                    </li>
                    <li class="menu-title pt-2 text-xs font-normal">
                      <span>Herunterladen:
                        <template v-for="(example, i) in EXAMPLES" :key="`dl-${example.file}`">
                          <template v-if="i > 0"> · </template>
                          <a class="link" :href="exampleUrl(example)" :download="example.file">{{ example.file }}</a>
                        </template>
                      </span>
                    </li>
                  </ul>
                </details>
              </div>
              <input ref="fileInput" type="file" accept="application/pdf,.pdf" class="hidden" @change="pick($event.target.files); $event.target.value = ''" />
            </template>
          </div>

          <p v-if="documentState.error" class="text-sm text-error">{{ documentState.error }}</p>
        </div>
      </div>
    </section>

    <!-- Prüfansicht -->
    <template v-else>
      <section class="card bg-base-100 shadow-sm">
        <div class="card-body gap-3 py-4">
          <div class="flex flex-wrap items-center gap-3">
            <h2 class="font-semibold">{{ documentState.fileName }}</h2>
            <span class="text-sm opacity-70">
              {{ stats.total }} Seiten<template v-if="stats.ocr">, davon {{ stats.ocr }} mit Texterkennung</template><template v-if="stats.edited">, {{ stats.edited }} bearbeitet</template>
            </span>
            <div class="ml-auto flex flex-wrap items-center gap-2">
              <label class="flex items-center gap-2 text-sm">
                <input v-model="pageMarkers" type="checkbox" class="checkbox checkbox-xs" /> Seitenmarker
              </label>
              <button class="btn btn-sm" @click="copyAll">
                <ClipboardDocumentIcon class="size-4" /> {{ copied ? 'Kopiert' : 'Gesamttext kopieren' }}
              </button>
              <button class="btn btn-sm" @click="download"><ArrowDownTrayIcon class="size-4" /> Als .txt speichern</button>
              <button class="btn btn-sm btn-ghost" @click="closeDocument"><XMarkIcon class="size-4" /> Schliessen</button>
            </div>
          </div>
          <p v-if="pageMarkers && paginationPlan" class="text-sm opacity-70">
            {{ paginationInfo }}
            <button class="link" @click="askPageStart">Ersten Beleg ändern</button>
          </p>
          <div v-for="(notice, i) in documentState.notices" :key="i" role="alert" class="alert alert-warning alert-soft py-2 text-sm">
            <span>{{ noticeText(notice) }}</span>
            <button v-if="notice.type === 'model-missing'" class="btn btn-xs" @click="emit('navigate', 'modelle')">Modell installieren</button>
          </div>
        </div>
      </section>
      <ReviewPane :key="documentState.fileName" />
    </template>

    <!-- Erster Beleg der Seitenmarker, wenn der Dateiname ihn nicht bestimmt -->
    <dialog ref="startDialog" class="modal" @cancel.prevent="keepPageStart">
      <form class="modal-box max-w-md" @submit.prevent="confirmPageStart">
        <h3 class="mb-2 text-lg font-bold">Ab welchem Beleg?</h3>
        <p v-if="startQuestion" class="mb-4 text-sm">{{ startQuestion }} Mit welchem Beleg beginnt das PDF?</p>
        <label class="flex flex-col gap-1">
          <span class="text-sm">Erster Beleg im PDF</span>
          <input ref="startInput" v-model="startValue" type="number" min="0" step="1" required class="input w-full" />
        </label>
        <p v-if="startPreview" class="mt-2 text-xs opacity-70">Seitenmarker: {{ startPreview }}</p>
        <div class="modal-action">
          <button type="button" class="btn btn-outline" @click="keepPageStart">Wie im Dateinamen</button>
          <button type="submit" class="btn btn-primary" :disabled="!startValid">Übernehmen</button>
        </div>
      </form>
    </dialog>
  </div>
</template>
