<script setup>
// Eine PDF-Seite als Bild, darüber die erkannten Zeilen (und optional die Layoutbereiche).
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { UNCERTAIN_SCORE } from '../capture/options.js';
import { labelOf } from '../capture/layoutRegions.js';

const props = defineProps({
    pdf: { type: Object, required: true },
    page: { type: Object, required: true },
    showBoxes: { type: Boolean, default: true },
    showRegions: { type: Boolean, default: false },
    activeIndex: { type: Number, default: -1 },
    // Bereiche bearbeiten: Bereiche klickbar, mit Lesenummer; ausgeschaltete schraffiert
    regionMode: { type: Boolean, default: false },
    selectedRegions: { type: Array, default: () => [] },
    orderNumbers: { type: Object, default: () => ({}) },
});
const emit = defineEmits(['select', 'region']);

const container = ref(null);
const canvas = ref(null);
const rendering = ref(false);
let renderTask = null;
let observer = null;
let lastWidth = 0;

async function render() {
    const width = container.value?.clientWidth;
    if (!width || !canvas.value) return;
    lastWidth = width;
    renderTask?.cancel();
    rendering.value = true;
    try {
        const pageProxy = await props.pdf.getPage(props.page.number);
        const ratio = window.devicePixelRatio || 1;
        const viewport = pageProxy.getViewport({ scale: (width * ratio) / props.page.width });
        const el = canvas.value;
        el.width = Math.floor(viewport.width);
        el.height = Math.floor(viewport.height);
        renderTask = pageProxy.render({ canvas: el, canvasContext: el.getContext('2d'), viewport });
        await renderTask.promise;
    } catch (err) {
        if (err?.name !== 'RenderingCancelledException') console.error(err);
    } finally {
        rendering.value = false;
    }
}

onMounted(() => {
    observer = new ResizeObserver(() => {
        if (Math.abs((container.value?.clientWidth ?? 0) - lastWidth) > 4) render();
    });
    observer.observe(container.value);
    render();
});
onBeforeUnmount(() => {
    observer?.disconnect();
    renderTask?.cancel();
});
watch(() => props.page.number, render);

// Aktive Zeile in den sichtbaren Bereich holen
watch(() => props.activeIndex, async index => {
    if (index < 0) return;
    await nextTick();
    container.value?.querySelector(`[data-box="${index}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
});

function regionClass(region) {
    return {
        region: true,
        'region-edit': props.regionMode,
        'region-off': !region.enabled,
        'region-rest': region.id === 'rest',
        'region-selected': props.selectedRegions.includes(region.id),
    };
}

function boxClass(box, index) {
    return {
        box: true,
        'box-active': index === props.activeIndex,
        'box-uncertain': box.score !== undefined && box.score < UNCERTAIN_SCORE,
        'box-ocr': box.score !== undefined && box.score >= UNCERTAIN_SCORE,
        'box-text': box.score === undefined,
    };
}
</script>

<template>
  <div ref="container" class="relative w-full bg-white shadow">
    <canvas ref="canvas" class="block h-auto w-full" />
    <svg
      class="absolute inset-0 h-full w-full"
      :viewBox="`0 0 ${page.width} ${page.height}`"
      preserveAspectRatio="none"
    >
      <defs>
        <pattern id="region-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="6" height="6" fill="rgb(100 116 139 / 0.18)" />
          <line x1="0" y1="0" x2="0" y2="6" stroke="rgb(100 116 139 / 0.55)" stroke-width="2" />
        </pattern>
      </defs>
      <g v-if="showBoxes" :class="{ 'boxes-muted': regionMode }">
        <rect
          v-for="(box, i) in page.boxes"
          :key="i"
          :data-box="i"
          :x="box.x"
          :y="box.y"
          :width="box.w"
          :height="box.h"
          :class="boxClass(box, i)"
          @click="emit('select', i)"
        >
          <title>{{ box.text }}{{ box.score !== undefined ? ` (Sicherheit ${Math.round(box.score * 100)} %)` : '' }}</title>
        </rect>
      </g>
      <g v-if="page.layout && (regionMode || showRegions)">
        <g v-for="region in page.layout.regions" :key="region.id" :data-region="region.id">
          <template v-if="region.id !== 'rest' || regionMode">
            <rect
              :x="region.x" :y="region.y" :width="region.w" :height="region.h"
              :class="regionClass(region)"
              @click="regionMode && emit('region', region.id, $event)"
            >
              <title>{{ labelOf(region.label) }}{{ region.enabled ? '' : ' (ausgeschaltet)' }}{{ regionMode ? ' – Klick: an/aus, Shift-Klick: auswählen' : '' }}</title>
            </rect>
            <text :x="region.x + 2" :y="region.y - 2" class="region-label">{{ labelOf(region.label) }}</text>
            <g v-if="regionMode && orderNumbers[region.id]" class="order-badge">
              <circle :cx="region.x - 7" :cy="region.y + 7" r="7" />
              <text :x="region.x - 7" :y="region.y + 9.5">{{ orderNumbers[region.id] }}</text>
            </g>
          </template>
        </g>
      </g>
    </svg>
    <div v-if="rendering" class="absolute right-2 top-2"><span class="loading loading-spinner loading-sm" /></div>
  </div>
</template>

<style scoped>
.box { cursor: pointer; fill: transparent; stroke-width: 0.6; vector-effect: non-scaling-stroke; }
.box:hover { fill: rgb(59 130 246 / 0.12); }
.box-text { stroke: rgb(59 130 246 / 0.35); }
.box-ocr { stroke: rgb(22 163 74 / 0.45); }
.box-uncertain { stroke: rgb(234 88 12 / 0.9); fill: rgb(234 88 12 / 0.18); stroke-width: 1.2; }
.box-active { stroke: rgb(37 99 235); stroke-width: 2.5; fill: rgb(37 99 235 / 0.15); }
.region { fill: none; stroke: rgb(147 51 234 / 0.7); stroke-dasharray: 4 3; stroke-width: 1; vector-effect: non-scaling-stroke; }
.region:not(.region-edit) { pointer-events: none; }
.region-label { fill: rgb(147 51 234); font-size: 7px; font-family: system-ui, sans-serif; pointer-events: none; }
.region-edit { cursor: pointer; fill: rgb(147 51 234 / 0.06); stroke-dasharray: none; stroke-width: 1.5; }
.region-edit:hover { fill: rgb(147 51 234 / 0.14); }
.region-off { fill: url(#region-hatch); stroke: rgb(100 116 139 / 0.8); stroke-dasharray: 3 3; }
.region-off:hover { fill: url(#region-hatch); }
.region-rest { stroke-dasharray: 1 3; }
.region-selected { stroke: rgb(37 99 235); stroke-width: 3; }
.boxes-muted { opacity: 0.35; pointer-events: none; }
.order-badge circle { fill: rgb(147 51 234); }
.order-badge text { fill: white; font-size: 8px; font-weight: 700; text-anchor: middle; font-family: system-ui, sans-serif; pointer-events: none; }
</style>
