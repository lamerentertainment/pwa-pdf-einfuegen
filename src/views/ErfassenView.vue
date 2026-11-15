<script setup>
import { computed, onActivated, onMounted, ref } from 'vue';
import { ArrowUpTrayIcon, ChevronDownIcon, ClipboardDocumentIcon, ArrowDownTrayIcon, XMarkIcon } from '@heroicons/vue/24/outline';
import ReviewPane from '../components/ReviewPane.vue';
import { cancel, closeDocument, documentState, openFile } from '../capture/documentStore.js';
import { joinPages } from '../capture/joinPages.js';
import ocrService, { LAYOUT_MODEL_ID, OCR_MODEL_ID } from '../ocr/ocrService.js';
import { EXAMPLES, exampleUrl, loadExample } from '../capture/examples.js';
import { formatBytes, models, modelSize } from '../models/modelStore.js';
import ModelInfo from '../components/ModelInfo.vue';

const emit = defineEmits(['navigate']);

const installed = ref({ ocr: false, layout: false });
// Status aller Modelle der Erfassung, nach ID
const status = ref({});
const captureModels = models.filter(model => model.stage === 1);
const isInstalledId = id => Boolean(status.value[id]);
const isInstalled = model => isInstalledId(model.id);
const optionAvailable = model => isInstalled(model) && (!model.requires || isInstalledId(model.requires));
const dragging = ref(false);
const fileInput = ref(null);
const pageMarkers = ref(false);
const copied = ref(false);
const exampleMenu = ref(null);

async function refreshModels() {
    status.value = Object.fromEntries(await Promise.all(
        captureModels.map(async model => [model.id, await ocrService.isInstalled(model.id)]),
    ));
    installed.value = {
        ocr: await ocrService.isInstalled(OCR_MODEL_ID),
        layout: await ocrService.isInstalled(LAYOUT_MODEL_ID),
    };
    if (!installed.value.layout || !installed.value.ocr) documentState.options.layout = false;
}
onMounted(refreshModels);
onActivated(refreshModels);

const hasDocument = computed(() => documentState.pages.length > 0);
const fullText = computed(() => joinPages(documentState.pages, { pageMarkers: pageMarkers.value }));
const stats = computed(() => {
    const pages = documentState.pages;
    return {
        total: pages.length,
        ocr: pages.filter(p => p.source.startsWith('ocr')).length,
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
        <h2 class="card-title">Stufe 1 · PDF erfassen</h2>
        <p class="text-sm opacity-80">
          Digitale Seiten liefern ihren Text direkt. Gescannte Seiten werden mit der lokalen Texterkennung gelesen.
          Danach stehen PDF und Text nebeneinander, damit du die Erfassung prüfen und korrigieren kannst.
          Das PDF verlässt dabei deinen Browser nicht und wird nirgends gespeichert.
        </p>

        <!-- 1. Modelle und Einstellungen: vor dem Einlesen festlegen -->
        <div class="space-y-4 rounded-box border border-base-300 p-4">
          <h3 class="font-semibold">1 · Modelle und Einstellungen</h3>

          <div>
            <p class="mb-2 text-sm opacity-80">
              <strong>Modelle</strong> wirken beim Einlesen und nur auf gescannten Seiten. Digitale PDFs brauchen keines.
            </p>
            <div class="grid gap-3 xl:grid-cols-2">
              <div
                v-for="model in captureModels"
                :key="model.id"
                class="flex flex-col gap-3 rounded-box border p-3"
                :class="isInstalled(model) ? 'border-success/40 bg-success/5' : 'border-base-300'"
                :data-model="model.id"
              >
                <div class="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p class="font-medium">{{ model.name }}</p>
                    <p class="text-xs opacity-70">{{ model.purpose }} {{ formatBytes(modelSize(model)) }}.</p>
                  </div>
                  <span class="badge badge-sm whitespace-nowrap" :class="isInstalled(model) ? 'badge-success' : 'badge-warning'">
                    {{ isInstalled(model) ? '✓ installiert' : 'nicht installiert' }}
                  </span>
                </div>
                <ModelInfo :model="model" compact />
                <div class="mt-auto flex flex-wrap items-center gap-3 border-t border-base-300 pt-2 text-sm">
                  <template v-if="model.option">
                    <label class="flex items-center gap-2" :class="{ 'opacity-50': !optionAvailable(model) }">
                      <input
                        v-model="documentState.options[model.option]"
                        type="checkbox"
                        class="checkbox checkbox-sm"
                        :disabled="!optionAvailable(model)"
                      />
                      Layoutmodell verwenden
                    </label>
                    <span v-if="isInstalled(model) && model.requires && !isInstalledId(model.requires)" class="text-xs text-warning">
                      braucht zusätzlich die Texterkennung
                    </span>
                  </template>
                  <span v-else-if="isInstalled(model)" class="text-xs opacity-70">Wird automatisch für gescannte Seiten verwendet.</span>
                  <button v-if="!isInstalled(model)" class="btn btn-xs ml-auto" @click="emit('navigate', 'modelle')">Installieren …</button>
                </div>
              </div>
            </div>
          </div>

          <div>
            <p class="mb-2 text-sm opacity-80">
              <strong>Textaufbau</strong> braucht kein Modell und lässt sich später in der Prüfansicht ändern, ohne das PDF neu einzulesen.
            </p>
            <div class="grid gap-x-8 gap-y-2 text-sm md:grid-cols-2">
              <label class="flex items-center gap-2">
                <input v-model="documentState.options.structure" type="checkbox" class="checkbox checkbox-sm" />
                Einrückungen und Spalten-Text erhalten
              </label>
              <label class="flex items-center gap-2">
                <input v-model="documentState.options.tables" type="checkbox" class="checkbox checkbox-sm" />
                Tabellen erkennen (ab 3 Spalten)
              </label>
              <label class="flex items-center gap-2">
                <input v-model="documentState.options.keepLineNumbers" type="checkbox" class="checkbox checkbox-sm" />
                Zeilennummern am Rand behalten
              </label>
              <label class="flex items-center gap-2" :class="{ 'opacity-60': !installed.ocr }">
                <input v-model="documentState.options.markUncertain" type="checkbox" class="checkbox checkbox-sm" />
                Unsichere Zeilen mit [?] markieren
                <span class="text-xs opacity-70">(nur bei Texterkennung)</span>
              </label>
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
                        <span v-if="example.needsOcr && !installed.ocr" class="text-xs text-warning">
                          Ohne installierte Texterkennung nur mit der fehlerhaften Textebene des Scanners
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
          <div v-for="(notice, i) in documentState.notices" :key="i" role="alert" class="alert alert-warning alert-soft py-2 text-sm">
            <span>{{ noticeText(notice) }}</span>
            <button v-if="notice.type === 'model-missing'" class="btn btn-xs" @click="emit('navigate', 'modelle')">Modell installieren</button>
          </div>
        </div>
      </section>
      <ReviewPane :key="documentState.fileName" />
    </template>
  </div>
</template>
