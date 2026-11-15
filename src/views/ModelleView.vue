<script setup>
import { computed, onActivated, onMounted, reactive, ref } from 'vue';
import { connection } from '../net/connection.js';
import ocrService from '../ocr/ocrService.js';
import {
    download, formatBytes, getStatus, models, modelSize, remove, requestPersistence, storageInfo, verify,
} from '../models/modelStore.js';

const STATUS_LABEL = { installiert: 'Installiert', unvollstaendig: 'Unvollständig', fehlt: 'Nicht installiert' };

// Pro Modell: Status, laufender Vorgang, Fortschritt und Meldung
const rows = reactive(Object.fromEntries(models.map(model => [model.id, {
    status: null, busy: null, progress: 0, message: null, error: false, controller: null,
}])));
const storage = ref({ usage: 0, quota: 0, persisted: false });
const connected = computed(() => connection.mode === 'verbunden');

async function refresh() {
    for (const model of models) rows[model.id].status = await getStatus(model);
    storage.value = await storageInfo();
}
onMounted(refresh);
onActivated(refresh);

function report(row, message, error = false) {
    row.message = message;
    row.error = error;
}

async function load(model) {
    const row = rows[model.id];
    row.busy = 'laden';
    row.progress = 0;
    row.controller = new AbortController();
    report(row, null);
    try {
        await download(model, { signal: row.controller.signal, onProgress: p => { row.progress = p; } });
        report(row, 'Geladen und Prüfsumme bestätigt.');
    } catch (err) {
        report(row, err.name === 'AbortError' ? 'Abgebrochen.' : err.message, err.name !== 'AbortError');
    } finally {
        row.busy = null;
        row.controller = null;
        await refresh();
    }
}

async function check(model) {
    const row = rows[model.id];
    row.busy = 'pruefen';
    try {
        const broken = await verify(model);
        report(row, broken.length ? `Fehlerhaft oder fehlend: ${broken.join(', ')}` : 'Alle Dateien unverändert (SHA-256 geprüft).', broken.length > 0);
    } finally {
        row.busy = null;
    }
}

async function del(model) {
    const row = rows[model.id];
    row.busy = 'loeschen';
    try {
        // Ein geladenes Modell auch aus dem Arbeitsspeicher entfernen
        ocrService.dispose();
        await remove(model);
        report(row, 'Aus dem Browser entfernt.');
    } finally {
        row.busy = null;
        await refresh();
    }
}

async function persist() {
    await requestPersistence();
    storage.value = await storageInfo();
}
</script>

<template>
  <div class="space-y-4">
    <section class="card bg-base-100 shadow-sm">
      <div class="card-body gap-3">
        <h2 class="card-title">Modelle in diesem Browser</h2>
        <p class="text-sm opacity-80">
          Hier entscheidest du, welche Modelle in deinem Browser gespeichert sind. Geladen wird nur auf Knopfdruck
          und nur im Modus <strong>Verbunden</strong>. Jede Datei hat eine feste Version und wird vor dem Speichern
          mit ihrer Prüfsumme (SHA-256) verglichen. Danach laufen die Modelle ohne Internet.
        </p>
        <div class="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
          <span>Belegter Speicher: <strong>{{ formatBytes(storage.usage) }}</strong>
            <template v-if="storage.quota"> von {{ formatBytes(storage.quota) }}</template></span>
          <span v-if="storage.persisted" class="text-success">Speicher geschützt: Der Browser löscht nichts von sich aus.</span>
          <button v-else class="btn btn-xs" @click="persist">Speicher schützen</button>
        </div>
      </div>
    </section>

    <section v-for="model in models" :key="model.id" class="card bg-base-100 shadow-sm">
      <div class="card-body gap-3">
        <div class="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h3 class="font-semibold">{{ model.name }}</h3>
            <p class="text-sm opacity-80">{{ model.purpose }}</p>
          </div>
          <span
            class="badge"
            :class="{
              'badge-success': rows[model.id].status === 'installiert',
              'badge-warning': rows[model.id].status === 'unvollstaendig',
              'badge-ghost': rows[model.id].status === 'fehlt',
            }"
          >{{ STATUS_LABEL[rows[model.id].status] ?? '…' }}</span>
        </div>

        <div class="flex flex-wrap gap-x-5 gap-y-1 text-xs opacity-70">
          <span>Stufe {{ model.stage }}</span>
          <span>{{ formatBytes(modelSize(model)) }}</span>
          <span>Lizenz {{ model.license }}</span>
          <a class="link" :href="model.source" target="_blank" rel="noopener noreferrer">Quelle: {{ model.publisher }}</a>
        </div>

        <details class="text-xs">
          <summary class="cursor-pointer opacity-70">Dateien und Prüfsummen</summary>
          <ul class="mt-2 space-y-1">
            <li v-for="file in model.files" :key="file.name" class="break-all">
              <strong>{{ file.name }}</strong> ({{ file.role }}, {{ formatBytes(file.size) }})<br />
              <span class="opacity-70">{{ file.url }}</span><br />
              <code class="opacity-70">sha256 {{ file.sha256 }}</code>
            </li>
          </ul>
        </details>

        <progress
          v-if="rows[model.id].busy === 'laden'"
          class="progress w-full"
          :value="Math.round(rows[model.id].progress * 100)"
          max="100"
        />
        <p v-if="rows[model.id].message" class="text-sm" :class="rows[model.id].error ? 'text-error' : 'text-success'">
          {{ rows[model.id].message }}
        </p>

        <div class="card-actions">
          <template v-if="rows[model.id].busy === 'laden'">
            <button class="btn btn-sm" @click="rows[model.id].controller.abort()">Abbrechen</button>
          </template>
          <template v-else>
            <button
              v-if="rows[model.id].status !== 'installiert'"
              class="btn btn-sm btn-primary"
              :disabled="!connected || rows[model.id].busy"
              :title="connected ? '' : 'Zuerst oben «Verbinden» wählen'"
              @click="load(model)"
            >
              Laden ({{ formatBytes(modelSize(model)) }})
            </button>
            <button
              v-if="rows[model.id].status === 'installiert'"
              class="btn btn-sm"
              :disabled="rows[model.id].busy"
              @click="check(model)"
            >
              Prüfen
            </button>
            <button
              v-if="rows[model.id].status && rows[model.id].status !== 'fehlt'"
              class="btn btn-sm btn-ghost text-error"
              :disabled="rows[model.id].busy"
              @click="del(model)"
            >
              Löschen
            </button>
            <span v-if="!connected && rows[model.id].status !== 'installiert'" class="self-center text-xs opacity-60">
              Zum Laden zuerst oben «Verbinden» wählen.
            </span>
          </template>
        </div>
      </div>
    </section>
  </div>
</template>
