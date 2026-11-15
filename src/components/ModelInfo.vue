<script setup>
// Was ein Modell kann, was ohne es passiert und wann es wirkt – Texte aus models/catalog.json,
// damit «Erfassen» und «Modelle» dasselbe sagen.
defineProps({
    model: { type: Object, required: true },
    compact: { type: Boolean, default: false },
});
</script>

<template>
  <div class="space-y-2 text-sm">
    <div>
      <p class="text-xs font-semibold uppercase tracking-wide opacity-60">Was es kann</p>
      <ul class="mt-1 list-disc space-y-0.5 pl-5">
        <li v-for="(capability, i) in model.capabilities" :key="i">{{ capability }}</li>
      </ul>
    </div>
    <div v-if="!compact" class="grid gap-2 md:grid-cols-2">
      <div>
        <p class="text-xs font-semibold uppercase tracking-wide opacity-60">Wann es wirkt</p>
        <p class="mt-1">{{ model.usage }}</p>
      </div>
      <div>
        <p class="text-xs font-semibold uppercase tracking-wide opacity-60">Ohne dieses Modell</p>
        <p class="mt-1">{{ model.without }}</p>
      </div>
    </div>
    <p v-else class="text-xs opacity-70">Ohne Modell: {{ model.without }}</p>
  </div>
</template>
