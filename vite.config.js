import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { CSP } from './csp.js';

const root = import.meta.dirname;
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

function git(args) {
    try {
        return execSync(`git ${args}`, { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    } catch {
        return '';
    }
}

// What the app shows in its footer and what an update check compares against. A build from the
// deploy workflow carries the exact commit, so anyone can check the live app against the source.
function buildInfo() {
    const commit = process.env.GITHUB_SHA || git('rev-parse HEAD') || 'unbekannt';
    const dirty = !process.env.GITHUB_SHA && git('status --porcelain') !== '';
    return {
        version: pkg.version,
        commit,
        // A local build with uncommitted changes gets a unique id, so it never poses as a commit
        id: commit.slice(0, 12) + (dirty ? `-lokal-${Date.now()}` : ''),
        dirty,
        message: git('log -1 --format=%s'),
        date: new Date().toISOString(),
        repository: pkg.repository.url,
    };
}

const BUILD = buildInfo();

// Served by the network on purpose, never from the app cache: the service worker scripts are
// checked by the browser itself, version.json is what an update check compares against.
const NOT_PRECACHED = new Set(['sw.js', 'sw-policy.js', 'version.json']);

// Gemeinsame Modell-Bestandteile von der eigenen Website (die Laufzeit der Sprachmodelle): Sie
// werden erst mit dem ersten Sprachmodell geladen, gehören also nicht in den App-Speicher.
const catalog = JSON.parse(readFileSync(join(root, 'models/catalog.json'), 'utf8'));
const ON_DEMAND = (catalog.components ?? []).flatMap(c => c.files).filter(f => f.url.startsWith('/'));

/** Bricht den Build ab, wenn Katalog und ausgelieferte Datei nicht übereinstimmen. */
function checkOnDemand(outDir) {
    for (const file of ON_DEMAND) {
        let buf;
        try {
            buf = readFileSync(join(outDir, file.url.slice(1)));
        } catch {
            throw new Error(`${file.url} fehlt im Build (scripts/copy-vendor.js)`);
        }
        const sha = createHash('sha256').update(buf).digest('hex');
        if (sha !== file.sha256 || buf.length !== file.size) {
            throw new Error(`${file.url} passt nicht zum Modellkatalog – node scripts/models/pin-runtime.mjs ausführen`);
        }
    }
}

function listFiles(dir) {
    return readdirSync(dir, { recursive: true, withFileTypes: true })
        .filter(entry => entry.isFile())
        .map(entry => relative(dir, join(entry.parentPath, entry.name)).split(sep).join('/'));
}

function replaceOnce(source, token, value, file) {
    if (!source.includes(token)) throw new Error(`${file}: Platzhalter ${token} fehlt`);
    return source.replace(token, () => value);
}

/**
 * Build step for the offline app:
 * - CSP as <meta> in index.html (the header from firebase.json is the second line of defence)
 * - version.json with the build info, for the user-triggered update check
 * - the build id and the full list of app files injected into sw.js, which stores them on
 *   install so the app starts without any network request afterwards
 */
function offlineApp() {
    let outDir;
    return {
        name: 'offline-app',
        apply: 'build',
        configResolved(config) {
            outDir = resolve(config.root, config.build.outDir);
        },
        transformIndexHtml() {
            return [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP }, injectTo: 'head-prepend' }];
        },
        closeBundle() {
            // onnxruntime-web references its .wasm via new URL(…, import.meta.url), so Vite emits a
            // second copy. The OCR and language model workers always load the versioned copy from
            // /vendor (wasmPaths in their workers); the unused one would only bloat the download.
            for (const file of listFiles(outDir)) {
                if (/^assets\/ort-wasm[\w.-]*\.wasm$/.test(file)) rmSync(join(outDir, file));
            }
            checkOnDemand(outDir);
            const onDemand = new Set(ON_DEMAND.map(f => f.url.slice(1)));
            const precache = listFiles(outDir)
                .filter(file => !NOT_PRECACHED.has(file) && !onDemand.has(file) && !file.endsWith('.map'))
                .sort()
                .map(file => `/${file}`);
            // Die App wird meist als "/" aufgerufen; die statische Route in sw.js liefert das aus dem Speicher
            precache.unshift('/');
            writeFileSync(join(outDir, 'version.json'), JSON.stringify(BUILD, null, 2) + '\n');

            const swPath = join(outDir, 'sw.js');
            let sw = readFileSync(swPath, 'utf8');
            sw = replaceOnce(sw, '/* inject:build */ null', JSON.stringify({ version: BUILD.version, id: BUILD.id }), 'sw.js');
            sw = replaceOnce(sw, '/* inject:precache */ []', JSON.stringify(precache, null, 2), 'sw.js');
            writeFileSync(swPath, sw);
        },
    };
}

// Cross-origin isolation, needed later for WASM threads of the OCR (same as firebase.json)
const ISOLATION = {
    'Cross-Origin-Embedder-Policy': 'require-corp',
    'Cross-Origin-Opener-Policy': 'same-origin',
};

export default defineConfig({
    plugins: [vue(), offlineApp()],
    define: {
        __BUILD__: JSON.stringify(BUILD),
    },
    server: { headers: ISOLATION },
    preview: { headers: ISOLATION },
    build: {
        target: 'esnext',
    },
    // The OCR worker is an ES module (it imports the ONNX Runtime)
    worker: {
        format: 'es',
    },
    optimizeDeps: {
        exclude: ['onnxruntime-web'],
    },
    test: {
        environment: 'node',
    },
});
