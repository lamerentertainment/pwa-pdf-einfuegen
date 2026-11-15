import { describe, expect, it } from 'vitest';
import catalog from '../models/catalog.json';
import presetData from '../src/llm/presets.json';
import { resolvePinned } from '../src/llm/pinned.js';
import { fillPrompt } from '../src/llm/llmService.js';

const PIN = { repo: 'onnx-community/gemma-4-E2B-it-ONNX', revision: '6f21c99d7e18237f8d2ce92aadfdbfeba877f63a' };

describe('resolvePinned', () => {
    it('schreibt «main» des geladenen Modells auf die feste Revision um', () => {
        expect(resolvePinned(`https://huggingface.co/${PIN.repo}/resolve/main/tokenizer_config.json`, PIN))
            .toBe(`https://huggingface.co/${PIN.repo}/resolve/${PIN.revision}/tokenizer_config.json`);
    });

    it('lässt andere Modelle und feste Revisionen unverändert', () => {
        const other = 'https://huggingface.co/someone/else/resolve/main/config.json';
        expect(resolvePinned(other, PIN)).toBe(other);
        const pinnedUrl = `https://huggingface.co/${PIN.repo}/resolve/${PIN.revision}/config.json`;
        expect(resolvePinned(pinnedUrl, PIN)).toBe(pinnedUrl);
        expect(resolvePinned(pinnedUrl, null)).toBe(pinnedUrl);
    });
});

describe('Presets', () => {
    it('hat jede Vorlage genau einen Platzhalter {{INPUT}} und keine Reste des alten Werkzeugs', () => {
        expect(presetData.presets.length).toBe(12);
        for (const preset of presetData.presets) {
            expect(preset.prompt.split('{{INPUT}}').length - 1, preset.id).toBe(1);
            expect(preset.prompt, preset.id).not.toMatch(/\{\{(MODEL|CLIPBOARD|anontext)/);
            expect(preset.title && preset.group && preset.description, preset.id).toBeTruthy();
        }
        expect(new Set(presetData.presets.map(p => p.id)).size).toBe(presetData.presets.length);
    });

    it('setzt den Eingabetext ein', () => {
        expect(fillPrompt('A\n{{INPUT}}\nB', '  Ich bin da.  ')).toBe('A\nIch bin da.\nB');
        expect(fillPrompt('Nur Anweisung', 'Text')).toBe('Nur Anweisung\n\nText');
    });
});

describe('Sprachmodelle im Katalog', () => {
    const llms = catalog.models.filter(m => m.stage === 3);

    it('legt Bibliothek, Repo, Revision, Klasse und Datentyp fest', () => {
        expect(llms.map(m => m.id)).toEqual(['gemma-3-1b', 'gemma-4-e2b', 'gemma-4-e4b']);
        for (const model of llms) {
            const r = model.runtime;
            expect(r.library).toBe('transformers.js');
            expect(r.revision).toMatch(/^[0-9a-f]{40}$/);
            expect(['AutoModelForCausalLM', 'Gemma4ForCausalLM']).toContain(r.modelClass);
            expect(r.device).toBe('webgpu');
        }
    });

    it('hat alle Dateien unter genau der Adresse, die transformers.js abfragt', () => {
        for (const model of llms) {
            const { repo, revision, dtype } = model.runtime;
            for (const file of model.files) {
                expect(file.url).toBe(`https://huggingface.co/${repo}/resolve/${revision}/${file.name}`);
            }
            const names = model.files.map(f => f.name);
            expect(names).toEqual(expect.arrayContaining(['config.json', 'tokenizer.json', 'tokenizer_config.json']));
            // nur der Textteil im gewählten Datentyp, keine Bild- oder Audio-Encoder
            expect(names.filter(n => n.startsWith('onnx/')).every(n => n.includes(`_${dtype}.onnx`))).toBe(true);
            expect(names.some(n => /audio|vision/.test(n))).toBe(false);
        }
    });
});
