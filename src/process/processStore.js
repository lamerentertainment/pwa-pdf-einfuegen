// Ein- und Ausgabe von Stufe 2, damit Stufe 3 das Ergebnis übernehmen kann. Nur im Arbeitsspeicher.
import { reactive } from 'vue';

export const processState = reactive({ input: '', output: '' });
