<script setup>
import { computed, ref } from 'vue';
import ModeSwitch from './components/ModeSwitch.vue';
import ErfassenView from './views/ErfassenView.vue';
import VerarbeitenView from './views/VerarbeitenView.vue';
import ModelleView from './views/ModelleView.vue';
import VerbindungView from './views/VerbindungView.vue';
import { BUILD, connection } from './net/connection.js';

const tabs = [
    { id: 'erfassen', label: '1 · Erfassen', component: ErfassenView },
    { id: 'verarbeiten', label: '2 · Verarbeiten', component: VerarbeitenView },
    { id: 'modelle', label: 'Modelle', component: ModelleView },
    { id: 'verbindung', label: 'Verbindungen', component: VerbindungView },
];
const active = ref('erfassen');
const current = computed(() => tabs.find(tab => tab.id === active.value).component);

const commitUrl = `${BUILD.repository}/commit/${BUILD.commit}`;
</script>

<template>
  <div class="flex min-h-screen flex-col bg-base-200">
    <header class="border-b border-base-300 bg-base-100">
      <div class="mx-auto flex max-w-6xl flex-wrap items-center gap-4 px-4 py-3">
        <div class="flex items-center gap-2">
          <img src="/icon.svg" alt="" class="size-7" />
          <span class="font-semibold">PDF einfügen</span>
        </div>
        <nav role="tablist" class="tabs tabs-box tabs-sm">
          <button
            v-for="tab in tabs"
            :key="tab.id"
            role="tab"
            class="tab"
            :class="{ 'tab-active': active === tab.id }"
            @click="active = tab.id"
          >
            {{ tab.label }}
          </button>
        </nav>
        <div class="ml-auto"><ModeSwitch /></div>
      </div>
    </header>

    <div v-if="connection.gatekeeper !== 'aktiv' && connection.gatekeeper !== 'start'" class="mx-auto mt-4 w-full max-w-6xl px-4">
      <div v-if="connection.gatekeeper === 'entwicklung'" role="alert" class="alert alert-info alert-soft text-sm">
        Entwicklungsserver: Der Torwächter ist nicht aktiv, das Netzwerk wird nicht gesperrt.
        Zum Testen <code>npm run build &amp;&amp; npm run preview</code> verwenden.
      </div>
      <div v-else role="alert" class="alert alert-error alert-soft text-sm">
        Der Torwächter ist nicht aktiv{{ connection.error ? `: ${connection.error}` : '' }}.
        Ohne ihn kann die App nicht garantieren, dass sie offline bleibt.
      </div>
    </div>

    <main class="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
      <KeepAlive><component :is="current" /></KeepAlive>
    </main>

    <footer class="border-t border-base-300 bg-base-100 text-xs opacity-80">
      <div class="mx-auto flex max-w-6xl flex-wrap gap-x-4 gap-y-1 px-4 py-3">
        <span>Version {{ BUILD.version }}</span>
        <span>
          Build
          <a class="link" :href="commitUrl" target="_blank" rel="noopener noreferrer">{{ BUILD.id.slice(0, 7) }}</a>
          <span v-if="BUILD.dirty"> (lokale Änderungen)</span>
        </span>
        <a class="link" :href="BUILD.repository" target="_blank" rel="noopener noreferrer">Quellcode (Open Source)</a>
        <span class="ml-auto">Deine Dokumente bleiben in diesem Browser.</span>
      </div>
    </footer>
  </div>
</template>
