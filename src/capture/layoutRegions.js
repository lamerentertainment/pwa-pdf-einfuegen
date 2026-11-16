// Bereiche des Layoutmodells nach der Erfassung bearbeiten: an- und abschalten, Reihenfolge,
// über Seiten verbinden. Reine Funktionen ohne Browser-Abhängigkeiten.
//
// Ein Seiten-Layout: { regions: [{ id, label, score, x, y, w, h, enabled }], order: [id, …] }
// Koordinaten in Punkten, Ursprung oben links (wie die Boxen der Prüfansicht).
// Zeilen ohne Bereich gehören zum Pseudo-Bereich REST_ID («ohne Bereich»).

import { trimPage } from './joinPages.js';

export const REST_ID = 'rest';

/** Deutsche Namen der Bereichstypen des Layoutmodells (PP-DocLayout_plus-L). */
export const REGION_LABELS = Object.freeze({
    doc_title: 'Dokumenttitel',
    paragraph_title: 'Abschnittstitel',
    text: 'Text',
    abstract: 'Zusammenfassung',
    content: 'Inhaltsverzeichnis',
    table: 'Tabelle',
    image: 'Bild',
    chart: 'Diagramm',
    figure_title: 'Bildunterschrift',
    formula: 'Formel',
    formula_number: 'Formelnummer',
    algorithm: 'Algorithmus',
    footnote: 'Fussnote',
    reference: 'Literatur',
    reference_content: 'Literaturangabe',
    aside_text: 'Randnotiz',
    seal: 'Stempel',
    header: 'Kopfzeile',
    footer: 'Fusszeile',
    number: 'Seitenzahl',
    [REST_ID]: 'Ohne Bereich',
});

export const labelOf = label => REGION_LABELS[label] ?? label;

/** Kopf- und Fusszeilen sowie Seitenzahlen sind anfangs ausgeschaltet (wie bisher). */
export const OFF_BY_DEFAULT = new Set(['header', 'footer', 'number']);

/** Der kleinste Bereich, der die Mitte der Box enthält (ein Titel im Textblock gewinnt). */
export function regionOfBox(box, regions) {
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    let best = null;
    for (const r of regions) {
        if (cx >= r.x && cx <= r.x + r.w && cy >= r.y && cy <= r.y + r.h && (!best || r.w * r.h < best.w * best.h)) best = r;
    }
    return best;
}

function bounds(rects) {
    const x = Math.min(...rects.map(r => r.x));
    const y = Math.min(...rects.map(r => r.y));
    return { x, y, w: Math.max(...rects.map(r => r.x + r.w)) - x, h: Math.max(...rects.map(r => r.y + r.h)) - y };
}

// Lücken, in die kein Intervall hineinragt
function gaps(intervals, minGap) {
    const sorted = [...intervals].sort((a, b) => a[0] - b[0]);
    const result = [];
    let end = sorted[0][1];
    for (const [s, e] of sorted.slice(1)) {
        if (s - end >= minGap) result.push((end + s) / 2);
        end = Math.max(end, e);
    }
    return result;
}

/**
 * Lesereihenfolge der Bereiche: rekursiver XY-Cut auf Bereichsebene. Zuerst Spalten (senkrechte
 * Lücke von oben bis unten, links vor rechts), sonst Zeilen (waagrechte Lücke, oben vor unten).
 * @returns {string[]} IDs in Lesereihenfolge
 */
export function orderRegions(regions, minGap = 4) {
    if (regions.length <= 1) return regions.map(r => r.id);
    const cols = gaps(regions.map(r => [r.x, r.x + r.w]), minGap);
    if (cols.length) {
        const parts = Array.from({ length: cols.length + 1 }, () => []);
        for (const r of regions) parts[cols.filter(c => r.x + r.w / 2 > c).length].push(r);
        if (parts.filter(p => p.length).length > 1) return parts.flatMap(p => orderRegions(p, minGap));
    }
    const rows = gaps(regions.map(r => [r.y, r.y + r.h]), 0.5);
    if (rows.length) {
        const parts = Array.from({ length: rows.length + 1 }, () => []);
        for (const r of regions) parts[rows.filter(c => r.y + r.h / 2 > c).length].push(r);
        if (parts.filter(p => p.length).length > 1) return parts.flatMap(p => orderRegions(p, minGap));
    }
    // Überlappende Bereiche ohne saubere Lücke: oben vor unten, links vor rechts
    return [...regions].sort((a, b) => a.y - b.y || a.x - b.x).map(r => r.id);
}

/**
 * Legt das Layout einer Seite an und ordnet jede Zeile ihrem Bereich zu.
 * @param {Array<{label, score, x, y, w, h}>} regionBoxes Bereiche in Punkten
 * @param {Array<{x, y, w, h}>} lineBoxes Zeilen in Punkten
 * @returns {{ layout: {regions, order}, lineRegions: string[] }}
 */
export function createLayout(regionBoxes, lineBoxes) {
    const regions = regionBoxes.map((r, i) => ({
        id: `r${i}`, label: r.label, score: r.score, x: r.x, y: r.y, w: r.w, h: r.h,
        enabled: !OFF_BY_DEFAULT.has(r.label),
    }));
    const lineRegions = lineBoxes.map(box => regionOfBox(box, regions)?.id ?? REST_ID);
    const rest = lineBoxes.filter((_, i) => lineRegions[i] === REST_ID);
    if (rest.length) regions.push({ id: REST_ID, label: REST_ID, score: null, ...bounds(rest), enabled: true });
    return { layout: { regions, order: orderRegions(regions) }, lineRegions };
}

/** Standard-Reihenfolge wiederherstellen. */
export function defaultOrder(layout) {
    return orderRegions(layout.regions);
}

/** Bereich in der Reihenfolge um `delta` Plätze verschieben. */
export function moveInOrder(order, id, delta) {
    const from = order.indexOf(id);
    const to = Math.min(order.length - 1, Math.max(0, from + delta));
    if (from < 0 || from === to) return order;
    const next = [...order];
    next.splice(to, 0, next.splice(from, 1)[0]);
    return next;
}

/** Reihenfolge aus Klicks: angeklickte zuerst (in Klickfolge), die übrigen dahinter wie bisher. */
export function orderFromClicks(order, clicked) {
    return [...clicked, ...order.filter(id => !clicked.includes(id))];
}

/**
 * Zwei Textstücke über eine Bereichs- oder Seitengrenze verbinden: ein am Ende getrenntes Wort
 * wird zusammengefügt ("Buch-" + "halterin"), sonst beginnt der zweite Teil auf neuer Zeile.
 */
export function joinAcross(a, b) {
    if (!a) return b;
    if (!b) return a;
    const head = a.trimEnd();
    const tail = b.trimStart();
    if (/[A-Za-zÄÖÜäöüß][-‐‑­]$/.test(head) && /^[a-zäöüß]/.test(tail)) return head.slice(0, -1) + tail;
    return `${head}\n${tail}`;
}

/** Schlüssel eines Bereichs im Dokument (Seite + ID). */
export const regionKey = (page, id) => `${page}:${id}`;

/** Die Verbindung (Gruppe), zu der ein Bereich gehört, oder null. */
export function groupOf(groups, page, id) {
    return groups.find(g => g.members.some(m => m.page === page && m.id === id)) ?? null;
}

/**
 * Bereiche verbinden: Die Auswahl wird zu einer Gruppe; bestehende Gruppen, die einen der
 * gewählten Bereiche enthalten, gehen darin auf. Reihenfolge: Seite, dann Lesereihenfolge.
 * mode 'folge': Texte nacheinander (auch über Seiten); 'nebeneinander': Bereiche derselben Seite
 * werden gemeinsam aufgebaut, so dass nebeneinanderliegende Zeilen (Bezeichnung und Wert eines
 * Formulars) auf einer Zeile stehen.
 * @param {Array<{page, id}>} selection
 * @param {(page: number) => string[]} orderOfPage
 */
export function mergeGroups(groups, selection, orderOfPage, newId, mode = 'folge') {
    const touched = groups.filter(g => g.members.some(m => selection.some(s => s.page === m.page && s.id === m.id)));
    const all = [...selection, ...touched.flatMap(g => g.members)];
    const unique = [...new Map(all.map(m => [regionKey(m.page, m.id), m])).values()];
    unique.sort((a, b) => a.page - b.page || orderOfPage(a.page).indexOf(a.id) - orderOfPage(b.page).indexOf(b.id));
    return [...groups.filter(g => !touched.includes(g)), { id: newId, mode, members: unique }];
}

/**
 * Text einer Seite aus ihren Bereichen: eingeschaltete in Reihenfolge, je Bereich der Text
 * (regionText), verbundene Bereiche als ein Block an der Stelle ihres ersten eingeschalteten
 * Mitglieds – auch wenn die übrigen Mitglieder auf späteren Seiten liegen.
 * @param {number} pageNumber
 * @param {(page: number) => {layout}|undefined} pageOf
 * @param {(page: number, id: string) => string} regionText
 * @param {(page: number, ids: string[]) => string} [combinedText] Text mehrerer Bereiche gemeinsam
 */
export function layoutPageText(pageNumber, pageOf, groups, regionText, combinedText) {
    const { layout } = pageOf(pageNumber);
    const enabledMember = m => pageOf(m.page)?.layout?.regions.find(r => r.id === m.id)?.enabled;
    const blocks = [];
    for (const id of layout.order) {
        const region = layout.regions.find(r => r.id === id);
        if (!region?.enabled) continue;
        const group = groupOf(groups, pageNumber, id);
        if (group) {
            const members = group.members.filter(enabledMember);
            if (members[0]?.page !== pageNumber || members[0]?.id !== id) continue;
            if (group.mode === 'nebeneinander' && combinedText) {
                blocks.push(combinedText(pageNumber, members.map(m => m.id)));
            } else {
                blocks.push(members.map(m => regionText(m.page, m.id)).reduce(joinAcross, ''));
            }
        } else {
            blocks.push(regionText(pageNumber, id));
        }
    }
    // Nur leere Zeilen vorne weg: die Einrückung der ersten Zeile bleibt
    return blocks.map(trimPage).filter(Boolean).join('\n\n');
}
