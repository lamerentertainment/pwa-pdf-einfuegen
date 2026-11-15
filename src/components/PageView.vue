<script setup>
// Eine PDF-Seite als Bild, darüber die erkannten Zeilen (und optional die Layoutbereiche).
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { UNCERTAIN_SCORE } from '../capture/options.js';

const props = defineProps({
    pdf: { type: Object, required: true },
    page: { type: Object, required: true },
    showBoxes: { type: Boolean, default: true },
    showRegions: { type: Boolean, default: false },
    activeIndex: { type: Number, default: -1 },
});
const emit = defineEmits(['select']);

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
      <g v-if="showRegions && page.regions">
        <g v-for="(region, i) in page.regions" :key="`r${i}`">
          <rect :x="region.x" :y="region.y" :width="region.w" :height="region.h" class="region" />
          <text :x="region.x + 2" :y="region.y + 8" class="region-label">{{ region.label }}</text>
        </g>
      </g>
      <g v-if="showBoxes">
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
.region-label { fill: rgb(147 51 234); font-size: 7px; font-family: system-ui, sans-serif; }
</style>
