<script setup>
// «Konvertierungen verwalten»: eingebaute als Vorlage verwenden oder ausblenden, eigene erstellen,
// bearbeiten, löschen, exportieren und importieren. Gespeichert wird nur im Browser.
import { computed, ref, watch } from 'vue';
import { ArrowDownTrayIcon, ArrowLeftIcon, ArrowUpTrayIcon, ExclamationTriangleIcon, PlusIcon } from '@heroicons/vue/24/outline';
import {
    GRUNDLAGEN, LISTEN, aendereKonvertierung, alleKonvertierungen, anzahlAenderungen, dupliziereKonvertierung,
    entferneEintrag, erstelleKonvertierung, exportDaten, findeKonvertierung, istAusgeblendet, kettenWarnungen,
    konvertierungen, leseImport, listenFuer, loescheKonvertierung, pruefeEintrag, setzeAusgeblendet, setzeEintrag,
    stelleWiederHer, zeilen,
} from '../process/konvertierungen.js';
import { processText } from '../process/rules.js';

const props = defineProps({ schritte: { type: Object, required: true } });
const emit = defineEmits(['waehle']);

const dialog = ref(null);
const bearbeiteId = ref(null);
const loeschId = ref(null);
const meldung = ref('');

function open(id = null) {
    bearbeiteId.value = id && !findeKonvertierung(id)?.eingebaut ? id : null;
    loeschId.value = null;
    importVorschau.value = null;
    importFehler.value = '';
    meldung.value = '';
    dialog.value.showModal();
}
defineExpose({ open });

const liste = computed(() => alleKonvertierungen());

function beschreibung(konv) {
    if (konv.eingebaut) return 'eingebaut, nicht änderbar';
    const { neu, entfernt } = anzahlAenderungen(konv);
    const teile = [`Grundlage ${GRUNDLAGEN[konv.grundlage]}`];
    if (neu) teile.push(`${neu} eigene ${neu === 1 ? 'Eintrag' : 'Einträge'}`);
    if (entfernt) teile.push(`${entfernt} entfernt`);
    return teile.join(' · ');
}

function alsVorlage(id) {
    bearbeite(dupliziereKonvertierung(id));
}

function neu() {
    bearbeite(erstelleKonvertierung({ name: 'Neue Konvertierung', grundlage: 'leer' }));
}

function bearbeite(id) {
    bearbeiteId.value = id;
    emit('waehle', id);
}

function loeschen(id) {
    loescheKonvertierung(id);
    loeschId.value = null;
}

// --- Export und Import ---
function exportieren() {
    const json = JSON.stringify(exportDaten(konvertierungen.eigene), null, 2);
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    Object.assign(document.createElement('a'), { href: url, download: 'konvertierungen.json' }).click();
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
        if (!importVorschau.value.length) throw new Error('Die Datei enthält keine Konvertierungen.');
    } catch (err) {
        importVorschau.value = null;
        importFehler.value = err.message;
    }
}

function importieren() {
    for (const k of importVorschau.value) erstelleKonvertierung(k);
    meldung.value = `${importVorschau.value.length} ${importVorschau.value.length === 1 ? 'Konvertierung' : 'Konvertierungen'} übernommen.`;
    importVorschau.value = null;
}

// --- Bearbeiten ---
const konv = computed(() => (bearbeiteId.value ? findeKonvertierung(bearbeiteId.value) : null));
const reiter = ref('pronomen');
const reiterInfo = computed(() => LISTEN.find(l => l.id === reiter.value));
const suche = ref('');
const nurEigene = ref(false);
const formular = ref([]);
const formFehler = ref('');
const MAX_ZEILEN = 150;

watch([reiter, bearbeiteId], () => {
    formular.value = reiterInfo.value.spalten.map(() => '');
    formFehler.value = '';
}, { immediate: true });

const alleZeilen = computed(() => (konv.value ? zeilen(konv.value, reiter.value) : []));
const gefiltert = computed(() => {
    const q = suche.value.trim().toLowerCase();
    return alleZeilen.value.filter(z => (!nurEigene.value || z.stand !== 'eingebaut')
        && (!q || z.eintrag.some(v => v.toLowerCase().includes(q))));
});
const aenderungenJeListe = computed(() => Object.fromEntries(LISTEN.map(l => [
    l.id, (konv.value?.aenderungen?.[l.id]?.neu?.length ?? 0) + (konv.value?.aenderungen?.[l.id]?.entfernt?.length ?? 0),
])));
const vorhanden = computed(() => alleZeilen.value.find(z => z.eintrag[0] === formular.value[0]?.trim()));

function aendern(aenderungen) {
    aendereKonvertierung(konv.value.id, { aenderungen });
}

function uebernehmen() {
    const eintrag = formular.value.map((v, i) => (i === 0 ? v.trim() : v));
    formFehler.value = pruefeEintrag(reiter.value, eintrag) ?? '';
    if (formFehler.value) return;
    aendern(setzeEintrag(konv.value, reiter.value, eintrag));
    formular.value = reiterInfo.value.spalten.map(() => '');
}

function inFormular(z) {
    formular.value = [...z.eintrag];
    formFehler.value = '';
}

const STAND = { geaendert: 'geändert', neu: 'neu', entfernt: 'entfernt' };

const warnungen = computed(() => (konv.value ? kettenWarnungen(konv.value) : []));
const pfeil = e => `${e[0]} → ${e.slice(1).filter(Boolean).join(' … ')}`;

const probesatz = ref('Ich habe mir nichts dabei gedacht. Ich ging dann nach Hause.');
const probeErgebnis = computed(() => {
    if (!konv.value || !probesatz.value.trim()) return '';
    try {
        return processText(probesatz.value, { schritte: props.schritte, listen: listenFuer(konv.value) });
    } catch (err) {
        return `Fehler: ${err.message}`;
    }
});
</script>

<template>
  <dialog ref="dialog" class="modal">
    <div class="modal-box flex max-h-[90vh] max-w-4xl flex-col gap-3">
      <!-- Übersicht -->
      <template v-if="!konv">
        <h3 class="text-lg font-semibold">Konvertierungen verwalten</h3>
        <p class="text-sm opacity-80">
          Eingebaute Konvertierungen lassen sich nicht ändern, aber als Vorlage für eine eigene verwenden oder
          ausblenden. Eigene Konvertierungen speichert nur dieser Browser – mit «Exportieren» sichern oder
          weitergeben.
        </p>
        <ul class="divide-y divide-base-300 overflow-y-auto rounded-box border border-base-300">
          <li v-for="k in liste" :key="k.id" class="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2" :class="{ 'opacity-60': istAusgeblendet(k.id) }">
            <div class="min-w-0 flex-1">
              <div class="truncate font-medium">{{ k.name }}</div>
              <div class="text-xs opacity-70">{{ beschreibung(k) }}<template v-if="istAusgeblendet(k.id)"> · ausgeblendet</template></div>
            </div>
            <template v-if="k.eingebaut">
              <button class="btn btn-xs" @click="alsVorlage(k.id)">Als Vorlage verwenden</button>
              <button class="btn btn-xs btn-ghost" @click="setzeAusgeblendet(k.id, !istAusgeblendet(k.id))">
                {{ istAusgeblendet(k.id) ? 'Einblenden' : 'Ausblenden' }}
              </button>
            </template>
            <template v-else-if="loeschId === k.id">
              <span class="text-xs">Endgültig löschen?</span>
              <button class="btn btn-xs btn-error" @click="loeschen(k.id)">Löschen</button>
              <button class="btn btn-xs btn-ghost" @click="loeschId = null">Abbrechen</button>
            </template>
            <template v-else>
              <button class="btn btn-xs" @click="bearbeite(k.id)">Bearbeiten</button>
              <button class="btn btn-xs btn-ghost" @click="alsVorlage(k.id)">Duplizieren</button>
              <button class="btn btn-xs btn-ghost text-error" @click="loeschId = k.id">Löschen</button>
            </template>
          </li>
        </ul>

        <div v-if="importVorschau" class="rounded-box border border-primary/40 bg-primary/5 p-3 text-sm">
          <p class="font-medium">In der Datei gefunden:</p>
          <ul class="my-1 list-disc pl-5">
            <li v-for="(k, i) in importVorschau" :key="i">{{ k.name }} <span class="opacity-70">({{ beschreibung(k) }})</span></li>
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
          <button class="btn btn-sm" @click="neu"><PlusIcon class="size-4" /> Neue leere Konvertierung</button>
          <button class="btn btn-sm btn-ghost" :disabled="!konvertierungen.eigene.length" @click="exportieren">
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
          <input
            :value="konv.name"
            class="input input-sm min-w-0 flex-1 font-semibold"
            aria-label="Name der Konvertierung"
            maxlength="120"
            @change="e => e.target.value.trim() && aendereKonvertierung(konv.id, { name: e.target.value.trim() })"
          />
          <span class="text-xs opacity-70">Grundlage: {{ GRUNDLAGEN[konv.grundlage] }}</span>
        </div>

        <div role="tablist" class="tabs tabs-border">
          <button
            v-for="l in LISTEN"
            :key="l.id"
            role="tab"
            class="tab"
            :class="{ 'tab-active': reiter === l.id }"
            @click="reiter = l.id"
          >
            {{ l.label }}
            <span v-if="aenderungenJeListe[l.id]" class="badge badge-xs badge-primary ml-1">{{ aenderungenJeListe[l.id] }}</span>
          </button>
        </div>

        <p class="text-xs opacity-70">
          <template v-if="reiter === 'pronomen'">Die Einträge werden der Reihe nach angewendet; geänderte bleiben an ihrem Platz, neue kommen ans Ende.</template>
          <template v-else-if="reiter === 'praeteritum'">«Ich ging nach Hause» → «Er sei nach Hause gegangen»: Das Verb wird durch den Konjunktiv ersetzt, die dritte Spalte kommt ans Ende des Satzteils.</template>
          <template v-else-if="reiter === 'praesens'">Verben im Präsens werden durch den Konjunktiv ersetzt («ist» → «sei»).</template>
          <template v-else>Getrennt geschriebene Wörter, die nach der Umwandlung zusammengehören («an gerufen» → «angerufen»).</template>
        </p>

        <form class="flex flex-wrap items-end gap-2" @submit.prevent="uebernehmen">
          <label v-for="(spalte, i) in reiterInfo.spalten" :key="spalte" class="flex min-w-28 flex-1 flex-col gap-0.5 text-xs">
            {{ spalte }}
            <input v-model="formular[i]" class="input input-sm" />
          </label>
          <button class="btn btn-sm btn-primary" :disabled="!formular[0]?.trim()">
            {{ vorhanden ? 'Ändern' : 'Hinzufügen' }}
          </button>
        </form>
        <p v-if="formFehler" class="text-xs text-error">{{ formFehler }}</p>

        <div class="flex flex-wrap items-center gap-3 text-sm">
          <input v-model="suche" type="search" class="input input-sm w-48" placeholder="Suchen …" aria-label="Einträge suchen" />
          <label class="flex items-center gap-2 text-xs">
            <input v-model="nurEigene" type="checkbox" class="checkbox checkbox-xs" /> nur eigene Änderungen
          </label>
          <span class="ml-auto text-xs opacity-60">{{ gefiltert.length }} von {{ alleZeilen.length }} Einträgen</span>
        </div>

        <div class="min-h-32 flex-1 overflow-y-auto rounded-box border border-base-300">
          <table class="table table-xs">
            <thead class="sticky top-0 bg-base-100">
              <tr><th v-for="s in reiterInfo.spalten" :key="s">{{ s }}</th><th /><th /></tr>
            </thead>
            <tbody>
              <tr v-for="z in gefiltert.slice(0, MAX_ZEILEN)" :key="z.eintrag[0]" :class="{ 'line-through opacity-50': z.stand === 'entfernt' }">
                <td v-for="(v, i) in z.eintrag" :key="i" class="font-mono">{{ v }}</td>
                <td>
                  <span v-if="STAND[z.stand]" class="badge badge-xs" :class="z.stand === 'entfernt' ? 'badge-ghost' : 'badge-primary'" :title="z.original ? `eingebaut: ${pfeil(z.original)}` : ''">
                    {{ STAND[z.stand] }}
                  </span>
                </td>
                <td class="whitespace-nowrap text-right">
                  <button v-if="z.stand !== 'entfernt'" class="btn btn-ghost btn-xs" @click="inFormular(z)">Bearbeiten</button>
                  <button v-if="z.stand === 'geaendert' || z.stand === 'entfernt'" class="btn btn-ghost btn-xs" @click="aendern(stelleWiederHer(konv, reiter, z.eintrag[0]))">Wiederherstellen</button>
                  <button v-if="z.stand !== 'entfernt'" class="btn btn-ghost btn-xs text-error" @click="aendern(entferneEintrag(konv, reiter, z.eintrag[0]))">Entfernen</button>
                </td>
              </tr>
              <tr v-if="!gefiltert.length"><td :colspan="reiterInfo.spalten.length + 2" class="py-4 text-center opacity-60">Keine Einträge</td></tr>
            </tbody>
          </table>
          <p v-if="gefiltert.length > MAX_ZEILEN" class="p-2 text-center text-xs opacity-60">
            Die ersten {{ MAX_ZEILEN }} Einträge – die Suche grenzt weiter ein.
          </p>
        </div>

        <div v-if="warnungen.length" class="alert alert-warning py-2 text-sm">
          <ExclamationTriangleIcon class="size-5 shrink-0" />
          <div>
            <p class="font-medium">Ersatzwörter, die danach nochmals ersetzt werden:</p>
            <ul class="list-disc pl-5 text-xs">
              <li v-for="(w, i) in warnungen" :key="i">«{{ pfeil(w.zuerst.eintrag) }}», danach «{{ pfeil(w.danach.eintrag) }}»</li>
            </ul>
          </div>
        </div>

        <div class="grid gap-2 sm:grid-cols-2">
          <label class="flex flex-col gap-0.5 text-xs">
            Probesatz
            <textarea v-model="probesatz" rows="2" class="textarea textarea-sm w-full" spellcheck="false" />
          </label>
          <div class="flex flex-col gap-0.5 text-xs">
            Ergebnis
            <div class="min-h-14 whitespace-pre-wrap rounded-field border border-base-300 bg-base-200 px-3 py-1.5 text-sm" aria-live="polite">{{ probeErgebnis }}</div>
          </div>
        </div>

        <div class="flex justify-end">
          <form method="dialog"><button class="btn btn-sm">Fertig</button></form>
        </div>
      </template>
    </div>
    <form method="dialog" class="modal-backdrop"><button>schliessen</button></form>
  </dialog>
</template>
