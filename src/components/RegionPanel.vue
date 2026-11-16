<script setup>
// Bereichsliste der Prüfansicht: Bereiche der aktuellen Seite in Lesereihenfolge, an/aus,
// verschieben, zum Verbinden auswählen; dazu Schalter pro Bereichstyp für das ganze Dokument.
import { computed } from 'vue';
import { ArrowDownIcon, ArrowUpIcon, LinkIcon } from '@heroicons/vue/24/outline';
import { documentState } from '../capture/documentStore.js';
import { groupOf, labelOf, REST_ID } from '../capture/layoutRegions.js';
import { layoutOptionsOf, regionText } from '../capture/pageModel.js';

const props = defineProps({
    page: { type: Object, required: true },
    selection: { type: Array, required: true }, // [{ page, id }]
    orderMode: { type: Boolean, default: false },
    conflict: { type: Array, default: null }, // Seiten, deren Bearbeitungen verloren gingen
});
const emit = defineEmits(['toggle', 'move', 'select', 'merge', 'merge-side', 'unmerge', 'clear-selection', 'reset-order', 'set-type', 'order-mode', 'force', 'cancel-conflict']);

const layoutOptions = computed(() => layoutOptionsOf(documentState.options));
const groups = computed(() => documentState.layoutGroups);

const rows = computed(() => {
    const layout = props.page.layout;
    let n = 0;
    return layout.order.map(id => {
        const region = layout.regions.find(r => r.id === id);
        const text = regionText(props.page, id, layoutOptions.value).replace(/\s+/g, ' ').trim();
        const group = groupOf(groups.value, props.page.number, id);
        return {
            region,
            number: region.enabled ? ++n : null,
            snippet: text ? (text.length > 90 ? `${text.slice(0, 90)} …` : text) : '(kein Text)',
            group,
            groupIndex: group ? groups.value.indexOf(group) + 1 : null,
            selected: props.selection.some(s => s.page === props.page.number && s.id === id),
        };
    });
});

// Bereichstypen im ganzen Dokument: Anzahl und wie viele eingeschaltet sind
const types = computed(() => {
    const map = new Map();
    for (const page of documentState.pages) {
        for (const region of page.layout?.regions ?? []) {
            if (region.id === REST_ID) continue;
            const entry = map.get(region.label) ?? { label: region.label, total: 0, on: 0 };
            entry.total++;
            if (region.enabled) entry.on++;
            map.set(region.label, entry);
        }
    }
    return [...map.values()].sort((a, b) => labelOf(a.label).localeCompare(labelOf(b.label), 'de'));
});

const sameAsPage = computed(() => props.selection.length >= 2 && props.selection.every(s => s.page === props.page.number));

const selectedGroup = computed(() => {
    const own = rows.value.filter(r => r.selected && r.group);
    return own.length ? own[0].group : null;
});
</script>

<template>
  <div class="flex h-full flex-col gap-3 text-sm">
    <div v-if="conflict" role="alert" class="alert alert-warning alert-soft py-2 text-xs">
      <span>Diese Änderung überschreibt deine Bearbeitungen auf Seite {{ conflict.join(', ') }}.</span>
      <button class="btn btn-xs" @click="emit('force')">Trotzdem ändern</button>
      <button class="btn btn-xs btn-ghost" @click="emit('cancel-conflict')">Abbrechen</button>
    </div>

    <div>
      <p class="mb-1 text-xs font-semibold uppercase tracking-wide opacity-60">Bereichstypen im ganzen Dokument</p>
      <div class="flex flex-wrap gap-1.5">
        <button
          v-for="type in types"
          :key="type.label"
          class="btn btn-xs"
          :class="type.on === type.total ? 'btn-primary' : type.on === 0 ? 'btn-ghost border-base-300 line-through opacity-70' : 'btn-outline'"
          :title="`${type.on} von ${type.total} eingeschaltet – Klick schaltet alle ${type.on === type.total ? 'aus' : 'ein'}`"
          :data-type="type.label"
          @click="emit('set-type', type.label, type.on !== type.total)"
        >
          {{ labelOf(type.label) }} <span class="opacity-70">{{ type.on }}/{{ type.total }}</span>
        </button>
      </div>
    </div>

    <div class="flex min-h-0 flex-1 flex-col">
      <div class="mb-1 flex flex-wrap items-center gap-2">
        <p class="text-xs font-semibold uppercase tracking-wide opacity-60">Bereiche auf Seite {{ page.number }}</p>
        <button class="btn btn-xs ml-auto" :class="{ 'btn-primary': orderMode }" @click="emit('order-mode')">
          {{ orderMode ? 'Reihenfolge fertig' : 'Reihenfolge per Klick' }}
        </button>
        <button class="btn btn-xs btn-ghost" @click="emit('reset-order')">Reihenfolge zurücksetzen</button>
      </div>
      <p v-if="orderMode" class="mb-1 text-xs text-primary">Klicke die Bereiche im PDF in der gewünschten Lesereihenfolge an.</p>
      <ul class="min-h-0 flex-1 space-y-1 overflow-auto pr-1" aria-label="Bereiche der Seite">
        <li
          v-for="(row, i) in rows"
          :key="row.region.id"
          class="flex items-start gap-2 rounded-field border px-2 py-1.5"
          :class="[row.region.enabled ? 'border-base-300' : 'border-dashed border-base-300 opacity-60', row.selected ? 'ring-2 ring-info' : '']"
          :data-row="row.region.id"
        >
          <span class="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold" :class="row.number ? 'bg-secondary text-secondary-content' : 'bg-base-300'">
            {{ row.number ?? '–' }}
          </span>
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-1.5">
              <span class="font-medium">{{ labelOf(row.region.label) }}</span>
              <span v-if="row.group" class="badge badge-info badge-xs gap-1" :title="`Verbunden mit ${row.group.members.length - 1} weiteren Bereich(en)`">
                <LinkIcon class="size-3" /> {{ row.group.mode === 'nebeneinander' ? 'Zusammengelegt' : 'Verbindung' }} {{ row.groupIndex }}
              </span>
            </div>
            <p class="truncate text-xs opacity-70" :title="row.snippet">{{ row.snippet }}</p>
          </div>
          <div class="flex shrink-0 items-center gap-1">
            <button class="btn btn-ghost btn-xs px-1" :disabled="i === 0" aria-label="nach oben" @click="emit('move', row.region.id, -1)"><ArrowUpIcon class="size-3.5" /></button>
            <button class="btn btn-ghost btn-xs px-1" :disabled="i === rows.length - 1" aria-label="nach unten" @click="emit('move', row.region.id, 1)"><ArrowDownIcon class="size-3.5" /></button>
            <input
              type="checkbox"
              class="checkbox checkbox-xs"
              :checked="row.selected"
              :aria-label="`${labelOf(row.region.label)} zum Verbinden auswählen`"
              title="Zum Verbinden auswählen (geht auch seitenübergreifend)"
              @change="emit('select', row.region.id)"
            />
            <input
              type="checkbox"
              class="toggle toggle-xs toggle-primary"
              :checked="row.region.enabled"
              :aria-label="`${labelOf(row.region.label)} ein- oder ausschalten`"
              title="Ein / aus"
              @change="emit('toggle', row.region.id)"
            />
          </div>
        </li>
      </ul>
    </div>

    <div class="flex flex-wrap items-center gap-2 border-t border-base-300 pt-2">
      <span class="text-xs opacity-70">{{ selection.length }} ausgewählt{{ selection.some(s => s.page !== page.number) ? ' (auch auf anderen Seiten)' : '' }}</span>
      <button
        class="btn btn-xs btn-primary"
        :disabled="selection.length < 2"
        title="Texte nacheinander als ein Absatz, auch über Seiten (z. B. ein Absatz über den Seitenumbruch)"
        @click="emit('merge')"
      >
        <LinkIcon class="size-3.5" /> Verbinden
      </button>
      <button
        class="btn btn-xs"
        :disabled="!sameAsPage"
        title="Bereiche derselben Seite gemeinsam aufbauen: nebeneinanderliegende Zeilen (Bezeichnung und Wert) stehen auf einer Zeile"
        @click="emit('merge-side')"
      >
        Nebeneinander zusammenlegen
      </button>
      <button v-if="selectedGroup" class="btn btn-xs" @click="emit('unmerge', selectedGroup.id)">Verbindung lösen</button>
      <button v-if="selection.length" class="btn btn-xs btn-ghost" @click="emit('clear-selection')">Auswahl aufheben</button>
      <span class="ml-auto text-xs opacity-60">Im PDF: Klick schaltet an/aus, Shift-Klick wählt aus.</span>
    </div>
  </div>
</template>
