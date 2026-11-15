#!/usr/bin/env node
/**
 * Erzeugt public/beispiele/entscheid-digital.pdf aus scripts/beispiele/entscheid.html,
 * mit Kopf- und Fusszeile auf jeder Seite (wie bei einem echten Entscheid).
 *
 * Braucht Chrome und playwright-core, das bewusst keine Abhängigkeit des Projekts ist:
 *   npm install --no-save playwright-core
 *   node scripts/beispiele/generate.mjs [Pfad zu Chrome]
 */
import { chromium } from 'playwright-core';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const here = import.meta.dirname;
const chrome = process.argv[2] || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const out = join(here, '../../public/beispiele/entscheid-digital.pdf');

const small = 'font: 8.5pt Helvetica, Arial, sans-serif; color: #444; width: 100%; margin: 0 24mm 0 26mm;';
const browser = await chromium.launch({ executablePath: chrome });
try {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(join(here, 'entscheid.html')).href);
    await page.pdf({
        path: out,
        format: 'A4',
        printBackground: true,
        preferCSSPageSize: true,
        displayHeaderFooter: true,
        headerTemplate: `<div style="${small} display:flex; justify-content:space-between">`
            + '<span>Kriminalgericht des Kantons X</span><span>2K 26 017</span></div>',
        footerTemplate: `<div style="${small} text-align:center">`
            + 'Seite <span class="pageNumber"></span> von <span class="totalPages"></span></div>',
    });
    console.log(`geschrieben: ${out}`);
} finally {
    await browser.close();
}
