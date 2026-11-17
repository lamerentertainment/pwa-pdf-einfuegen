<script setup>
import { computed, nextTick, reactive, ref, toRef, watch } from 'vue';
import { ArrowDownTrayIcon, ArrowTopRightOnSquareIcon, ClipboardDocumentIcon, Cog6ToothIcon, DocumentArrowDownIcon } from '@heroicons/vue/24/outline';
import { documentState } from '../capture/documentStore.js';
import { joinPages } from '../capture/joinPages.js';
import { ALLE_SCHRITTE, processText, SCHRITT_GRUPPEN, SCHRITTE, WORDLIST_SOURCE } from '../process/rules.js';
import {
    aendereKonvertierung, dupliziereKonvertierung, entferneEintrag, erstelleKonvertierung, findeKonvertierung, istAusgeblendet,
    konvertierungen, LISTEN, listenFuer, setzeEintrag, sichtbareKonvertierungen, zeilen,
} from '../process/konvertierungen.js';
import WortAktionen from '../components/WortAktionen.vue';
import { beschreibeHerkunft, herkunftProWort } from '../process/herkunft.js';
import KonvertierungenDialog from '../components/KonvertierungenDialog.vue';
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
// Gewählte Konvertierung ('' = keine) und Schritte der Bereinigung (gleich für alle Konvertierungen),
// beides merkt sich der Browser
const konvId = usePreference('verarbeiten.konvertierung', '');
const gespeicherteSchritte = usePreference('verarbeiten.schritte', { ...ALLE_SCHRITTE });
const schritte = computed(() => ({ ...ALLE_SCHRITTE, ...gespeicherteSchritte.value }));
const aktiveSchritte = computed(() => SCHRITTE.filter(s => schritte.value[s.id]).length);
const standardSchritte = computed(() => SCHRITTE.every(s => schritte.value[s.id]));
function setzeSchritt(id, an) {
    gespeicherteSchritte.value = { ...schritte.value, [id]: an };
}
const auswahl = computed(() => sichtbareKonvertierungen());
const konv = computed(() => (konvId.value && !istAusgeblendet(konvId.value) ? findeKonvertierung(konvId.value) : null));
// Gelöscht oder ausgeblendet: zurück zu «Zeilen zusammenfügen + Hilfsfunktionen» (keine Konvertierung)
watch(konv, k => { if (!k && konvId.value) konvId.value = ''; }, { immediate: true });
const dialog = ref(null);
const keepParagraphs = ref(true);
const highlight = ref(true);
const copied = ref(false);
const error = ref(null);

const hasDocument = computed(() => documentState.pages.length > 0);

// Neu berechnen, wenn sich Eingabe oder Einstellungen ändern (verzögert, damit lange Texte
// beim Tippen nicht bremsen). Eigene Änderungen am Ergebnis gehen dabei verloren.
let timer;
watch([input, konv, schritte, keepParagraphs, () => konvertierungen.eigene], () => {
    clearTimeout(timer);
    timer = setTimeout(run, 250);
}, { deep: true }); // deep: auch Änderungen an eigenen Konvertierungen (Fenster «verwalten»)

function run() {
    error.value = null;
    try {
        output.value = input.value.trim() ? processText(input.value, { schritte: schritte.value, listen: konv.value ? listenFuer(konv.value) : null }, { keepParagraphs: keepParagraphs.value }) : '';
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
    let index = 0;
    return list.map(token => {
        const start = output.value.indexOf(token.text, cursor);
        const at = start >= 0 ? start : cursor;
        cursor = at + token.text.length;
        const word = !/^\s+$/.test(token.text);
        return { ...token, start: at, end: cursor, word, index: word ? index++ : -1 };
    });
});

// --- Darüberfahren: welche Regel hat ein Wort verändert? ---
const listen = computed(() => (konv.value ? listenFuer(konv.value) : null));
const herkunft = computed(() => {
    if (!tokens.value) return null;
    try {
        return herkunftProWort(input.value, output.value, { schritte: schritte.value, listen: listen.value, keepParagraphs: keepParagraphs.value });
    } catch (err) {
        console.error(err);
        return null;
    }
});
// Eigene Einträge der gewählten Konvertierung, um sie im Hinweis zu kennzeichnen
const eigeneEintraege = computed(() => {
    const set = new Set();
    if (konv.value && !konv.value.eingebaut) {
        for (const l of LISTEN) {
            for (const z of zeilen(konv.value, l.id)) if (z.stand === 'neu' || z.stand === 'geaendert') set.add(`${l.id}\u0000${z.eintrag.join('\u0000')}`);
        }
    }
    return set;
});
const istEigen = (stufe, eintrag) => eigeneEintraege.value.has(`${stufe}\u0000${eintrag.join('\u0000')}`);

const hinweis = reactive({ zeilen: null, x: 0, y: 0 });
function zeigeHerkunft(event) {
    const span = event.target.closest?.('[data-index]');
    const token = span && tokens.value?.find(t => t.index === Number(span.dataset.index));
    if (wortAktion.value || !token?.changed || !herkunft.value) {
        hinweis.zeilen = null;
        return;
    }
    const kette = herkunft.value[token.index] ?? [];
    hinweis.zeilen = kette.length
        ? beschreibeHerkunft(kette, istEigen)
        : [{ label: 'Verändert', regel: 'Die Regel lässt sich nicht eindeutig bestimmen.', eigen: false }];
    const rect = span.getBoundingClientRect();
    hinweis.x = Math.max(8, Math.min(rect.left, window.innerWidth - 368));
    hinweis.y = rect.bottom + 6;
}
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
    oeffneWortAktion(span);
}

// --- Klick auf ein Wort: Regel entfernen oder neue Regel anlegen (WortAktionen) ---
const wortAktion = ref(null);

function oeffneWortAktion(span) {
    const list = tokens.value;
    const pos = list?.findIndex(t => t.index === Number(span.dataset.index)) ?? -1;
    if (pos < 0) return;
    const token = list[pos];
    // Satzanfang: erstes Wort des Absatzes oder nach Satzzeichen
    let vor = pos - 1;
    while (vor >= 0 && !list[vor].word) {
        if (/\n\s*\n/.test(list[vor].text)) break;
        vor--;
    }
    const satzanfang = vor < 0 || !list[vor].word || /[.!?:]["»“]?$/.test(list[vor].text);
    hinweis.zeilen = null;
    const rect = span.getBoundingClientRect();
    const oben = rect.bottom + 320 > window.innerHeight && rect.top > 320;
    wortAktion.value = {
        wort: token.text,
        kette: herkunft.value?.[token.index] ?? [],
        satzanfang,
        x: Math.max(8, Math.min(rect.left, window.innerWidth - 424)),
        y: oben ? rect.top - 6 : rect.bottom + 6,
        oben,
    };
}

// Meldung nach einer Änderung, mit «Rückgängig» (stellt Konvertierungen, Auswahl und Schritte wieder her)
const aenderung = ref(null);
let aenderungTimer;
function vorher() {
    return { konvId: konvId.value, eigene: JSON.parse(JSON.stringify(konvertierungen.eigene)), schritte: { ...gespeicherteSchritte.value } };
}
function melde(text, zustand) {
    wortAktion.value = null;
    aenderung.value = { text, zustand };
    clearTimeout(aenderungTimer);
    aenderungTimer = setTimeout(() => { aenderung.value = null; }, 20000);
}
function rueckgaengig() {
    const { zustand } = aenderung.value;
    konvertierungen.eigene = zustand.eigene;
    konvId.value = zustand.konvId;
    gespeicherteSchritte.value = zustand.schritte;
    aenderung.value = null;
}

/** Die gewählte eigene Konvertierung; bei einer eingebauten (oder keiner) wird eine angelegt. */
function eigeneKonvertierung() {
    if (konv.value && !konv.value.eingebaut) return { k: konv.value, angelegt: false };
    const id = konv.value
        ? dupliziereKonvertierung(konv.value.id)
        : erstelleKonvertierung({ name: 'Eigene Konvertierung', grundlage: 'leer' });
    konvId.value = id;
    return { k: findeKonvertierung(id), angelegt: true };
}
const regelText = eintrag => `${eintrag[0]} → ${eintrag.slice(1).filter(Boolean).join(' … ')}`;
const ort = ({ k, angelegt }) => (angelegt ? `in der neuen Konvertierung «${k.name}»` : `in «${k.name}»`);

function regelEntfernen(stufe, eintrag) {
    const zustand = vorher();
    const ziel = eigeneKonvertierung();
    aendereKonvertierung(ziel.k.id, { aenderungen: entferneEintrag(ziel.k, stufe, eintrag[0]) });
    melde(`Regel «${regelText(eintrag)}» ${ort(ziel)} entfernt.`, zustand);
}

function regelHinzufuegen(liste, eintrag) {
    const zustand = vorher();
    const ziel = eigeneKonvertierung();
    aendereKonvertierung(ziel.k.id, { aenderungen: setzeEintrag(ziel.k, liste, eintrag) });
    melde(`Regel «${regelText(eintrag)}» ${ort(ziel)} gespeichert.`, zustand);
}

function schrittAus(id) {
    const zustand = vorher();
    setzeSchritt(id, false);
    melde(`Schritt «${SCHRITTE.find(s => s.id === id).label}» ausgeschaltet (für alle Texte).`, zustand);
}

async function copy() {
    await navigator.clipboard.writeText(output.value);
    copied.value = true;
    setTimeout(() => { copied.value = false; }, 2000);
}

function download() {
    const url = URL.createObjectURL(new Blob([output.value], { type: 'text/plain;charset=utf-8' }));
    const suffix = konv.value ? konv.value.name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') : 'bereinigt';
    const name = `${(documentState.fileName || 'text').replace(/\.pdf$/i, '')}-${suffix}.txt`;
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
          <div class="ml-auto flex items-center gap-1">
            <label for="konvertierung" class="mr-1 text-sm opacity-80">gewählte Konvertierungsregeln:</label>
            <select id="konvertierung" v-model="konvId" class="select select-sm w-auto max-w-full" aria-label="Konvertierung">
              <option value="">Zeilen zusammenfügen + Hilfsfunktionen</option>
              <option v-for="k in auswahl" :key="k.id" :value="k.id">{{ k.name }}</option>
            </select>
            <button class="btn btn-sm btn-ghost btn-square" title="Konvertierungen verwalten: eigene erstellen, bearbeiten, importieren" aria-label="Konvertierungen verwalten" @click="dialog.open(konv?.id)">
              <Cog6ToothIcon class="size-5" />
            </button>
          </div>
        </div>
        <p class="text-sm opacity-80">
          Feste Regeln und Wortlisten, übernommen aus den KRG-Makros. Kein Modell, kein Internet: Derselbe Text
          ergibt immer dasselbe Ergebnis, und jede Änderung lässt sich hervorheben und nachprüfen.
          <template v-if="konv">
            Die Konvertierung wandelt in die indirekte Rede um, also erste in dritte Person und Verben in den Konjunktiv
            («Ich ging nach Hause» → «{{ konv.grundlage === 'frau' ? 'Sie' : 'Er' }} sei nach Hause gegangen»). Sie beruht
            auf festen Wortlisten: Das Ergebnis immer prüfen und meist überarbeiten.
          </template>
        </p>
        <details class="group text-sm">
          <summary class="cursor-pointer select-none opacity-80">
            <strong>Zeilen zusammenfügen + Formatierungsvereinheitlichung + typische Fehler</strong>
            ({{ standardSchritte ? `${SCHRITTE.length} Schritte` : `${aktiveSchritte} von ${SCHRITTE.length} Schritten` }})
          </summary>
          <div class="mt-2 grid gap-x-6 gap-y-3 pl-4 sm:grid-cols-2 lg:grid-cols-3">
            <fieldset v-for="g in SCHRITT_GRUPPEN" :key="g.id" class="space-y-1.5">
              <legend class="mb-1 text-xs font-semibold uppercase tracking-wide opacity-60">{{ g.label }}</legend>
              <label v-for="s in SCHRITTE.filter(x => x.gruppe === g.id)" :key="s.id" class="flex items-start gap-2" :title="s.hinweis">
                <input
                  type="checkbox"
                  class="checkbox checkbox-sm mt-0.5"
                  :checked="schritte[s.id]"
                  @change="setzeSchritt(s.id, $event.target.checked)"
                />
                <span>
                  {{ s.label }}
                  <!-- Festbreitenschrift: unterscheidet «l» und «I» («lch» → «Ich») -->
                  <span class="block font-mono text-xs opacity-60">{{ s.beispiel }}</span>
                  <span v-if="s.hinweis" class="block text-xs opacity-60">{{ s.hinweis }}</span>
                </span>
              </label>
            </fieldset>
          </div>
          <button v-if="!standardSchritte" class="btn btn-link btn-xs mt-1 pl-4" @click="gespeicherteSchritte = { ...ALLE_SCHRITTE }">
            Alle Schritte einschalten
          </button>
        </details>
        <!-- rechtsbündig, über dem Ergebnisfeld: die Optionen betreffen das Ergebnis -->
        <div class="flex flex-wrap items-center justify-end gap-x-6 gap-y-2 text-sm">
          <label
            class="flex items-center gap-2"
            title="Eingeschaltet: Absätze, die durch eine Leerzeile getrennt sind, bleiben getrennt; die Zeilen werden nur innerhalb eines Absatzes zusammengefügt. Ausgeschaltet: Der ganze Text wird zu einem einzigen Absatz zusammengefügt (wie im ursprünglichen KRG-Makro)."
          >
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
              placeholder="Text hier einfügen, z.B. eine aus einer PDF kopierte oder (nach Schritt 1) extrahierte Passage ..."
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
          <div v-if="aenderung" class="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-field bg-success/10 px-3 py-1.5 text-xs" role="status">
            <span>{{ aenderung.text }}</span>
            <button class="link" @click="rueckgaengig">Rückgängig</button>
            <button class="link" @click="dialog.open(konv?.id)">Verwalten</button>
            <button class="btn btn-ghost btn-xs ml-auto" aria-label="Meldung schliessen" @click="aenderung = null">✕</button>
          </div>
          <div ref="outputBox" class="relative">
            <div
              v-if="highlight && tokens"
              ref="outputEl"
              class="relative h-[65vh] min-h-48 resize-y overflow-auto whitespace-pre-wrap rounded-field border border-base-300 p-3 font-mono text-sm leading-6"
              aria-label="Ergebnis mit hervorgehobenen Änderungen"
              data-testid="ergebnis"
              @click="onOutputTokenClick"
              @mouseover="zeigeHerkunft"
              @mouseleave="hinweis.zeilen = null"
              @scroll="hinweis.zeilen = null; wortAktion = null"
            ><template v-for="(token, i) in tokens" :key="i"><span
              v-if="token.word"
              :data-start="token.start"
              :data-index="token.index"
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
            {{ highlight ? 'Darüberfahren zeigt, welche Regel ein markiertes Wort verändert hat; ein Klick auf ein Wort erlaubt, die Regel zu entfernen oder eine neue anzulegen. Zum Bearbeiten «Änderungen hervorheben» ausschalten.' : 'Eigene Änderungen gehen verloren, wenn sich die Eingabe ändert.' }}
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
      Regeln und Wortlisten aus «PDF einfügen» ({{ WORDLIST_SOURCE }}). Fundstellen (Bundesgerichtsentscheide und
      Gesetzesartikel) werden immer erkannt, wie mit den Makros «BGerAufruf» und «GesetzAufruf», aber ohne die Stelle zuerst zu markieren.
    </p>

    <Teleport to="body">
      <div
        v-if="hinweis.zeilen"
        class="pointer-events-none fixed z-50 w-max max-w-90 rounded-box border border-base-300 bg-base-100 px-3 py-2 text-xs shadow-lg"
        :style="{ left: `${hinweis.x}px`, top: `${hinweis.y}px` }"
        role="tooltip"
      >
        <div v-for="(z, i) in hinweis.zeilen" :key="i" class="flex flex-wrap gap-x-1.5" :class="{ 'mt-1 border-t border-base-300 pt-1': i > 0 }">
          <span class="font-semibold">{{ z.label }}</span>
          <span class="font-mono">{{ z.regel }}</span>
          <span v-if="z.eigen" class="badge badge-xs badge-primary">eigener Eintrag</span>
        </div>
      </div>
    </Teleport>

    <Teleport to="body">
      <WortAktionen
        v-if="wortAktion"
        v-bind="wortAktion"
        :listen="listen"
        :konv-name="konv?.name ?? ''"
        :eigen="!!konv && !konv.eingebaut"
        :ist-eigen="istEigen"
        @schliessen="wortAktion = null"
        @entfernen="regelEntfernen"
        @schritt-aus="schrittAus"
        @hinzufuegen="regelHinzufuegen"
      />
    </Teleport>

    <KonvertierungenDialog ref="dialog" :schritte="schritte" @waehle="id => (konvId = id)" />
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
