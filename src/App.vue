<script setup>
import { computed, ref } from 'vue';
import ModeSwitch from './components/ModeSwitch.vue';
import ErfassenView from './views/ErfassenView.vue';
import VerarbeitenView from './views/VerarbeitenView.vue';
import TransformierenView from './views/TransformierenView.vue';
import ModelleView from './views/ModelleView.vue';
import VerbindungView from './views/VerbindungView.vue';
import { BUILD, connection } from './net/connection.js';

// Hauptmenü: die drei Arbeitsschritte; Modelle/Programmupdate und Internetverbindung stehen abgesetzt daneben
const steps = [
    { id: 'erfassen', number: 1, label: 'PDF-Seiten (mit Text- und/oder Layouterkennung) erfassen', component: ErfassenView },
    { id: 'verarbeiten', number: 2, label: 'Text mit hartkodierten Algorithmen transformieren (KRG-Makros)', component: VerarbeitenView },
    { id: 'transformieren', number: 3, label: 'Text mit lokalen Mini-LLMs transformieren', component: TransformierenView },
];
const extras = [
    { id: 'modelle', label: 'Modelle/Programmupdate', component: ModelleView },
    { id: 'verbindung', label: 'Internetverbindung', component: VerbindungView },
];
const tabs = [...steps, ...extras];
const active = ref('erfassen');
const current = computed(() => tabs.find(tab => tab.id === active.value).component);

const commitUrl = `${BUILD.repository}/commit/${BUILD.commit}`;
</script>

<template>
  <div class="flex min-h-screen flex-col bg-base-200">
    <header class="border-b border-base-300 bg-base-100">
      <div class="mx-auto flex max-w-[1800px] flex-col gap-3 px-4 py-3">
        <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div class="flex items-center gap-2">
            <img src="/icon.svg" alt="" class="size-7" />
            <span class="font-semibold">PDF einfügen</span>
          </div>
          <nav class="ml-auto flex flex-wrap items-center gap-1" aria-label="Einstellungen">
            <button
              v-for="tab in extras"
              :key="tab.id"
              class="btn btn-sm"
              :class="active === tab.id ? 'btn-neutral' : 'btn-ghost'"
              :aria-current="active === tab.id ? 'page' : undefined"
              @click="active = tab.id"
            >
              {{ tab.label }}
            </button>
          </nav>
          <ModeSwitch />
        </div>
        <nav class="grid gap-2 md:grid-cols-3" aria-label="Arbeitsschritte">
          <button
            v-for="step in steps"
            :key="step.id"
            class="flex items-center gap-3 rounded-box border px-3 py-2 text-left text-sm transition-colors"
            :class="active === step.id
              ? 'border-primary bg-primary text-primary-content'
              : 'border-base-300 bg-base-100 hover:bg-base-200'"
            :aria-current="active === step.id ? 'page' : undefined"
            @click="active = step.id"
          >
            <span
              class="flex size-7 shrink-0 items-center justify-center rounded-full font-semibold"
              :class="active === step.id ? 'bg-primary-content text-primary' : 'bg-base-200'"
            >{{ step.number }}</span>
            <span>{{ step.label }}</span>
          </button>
        </nav>
      </div>
    </header>

    <div v-if="connection.gatekeeper !== 'aktiv' && connection.gatekeeper !== 'start'" class="mx-auto mt-4 w-full max-w-[1800px] px-4">
      <div v-if="connection.gatekeeper === 'entwicklung'" role="alert" class="alert alert-info alert-soft text-sm">
        Entwicklungsserver: Der Torwächter ist nicht aktiv, das Netzwerk wird nicht gesperrt.
        Zum Testen <code>npm run build &amp;&amp; npm run preview</code> verwenden.
      </div>
      <div v-else role="alert" class="alert alert-error alert-soft text-sm">
        Der Torwächter ist nicht aktiv{{ connection.error ? `: ${connection.error}` : '' }}.
        Ohne ihn kann die App nicht garantieren, dass sie offline bleibt.
      </div>
    </div>

    <main class="mx-auto w-full max-w-[1800px] flex-1 px-4 py-6">
      <KeepAlive><component :is="current" @navigate="active = $event" /></KeepAlive>
    </main>

    <footer class="border-t border-base-300 bg-base-100 text-xs opacity-80">
      <div class="mx-auto flex max-w-[1800px] flex-wrap gap-x-4 gap-y-1 px-4 py-3">
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
