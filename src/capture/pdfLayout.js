// Rebuilds readable text from pdf.js text items (PDF origin is bottom-left, y grows upwards).
//
// Reading order comes from a recursive XY-cut: a region is split along a clean vertical
// whitespace gutter (columns, left to right) or, failing that, along its largest horizontal
// gap (top to bottom), until no cut is left. Each remaining block is rendered line by line.
//
// Options (reconstructPageText / reconstructDocumentText):
// - keepLineNumbers: margin line numbers are put in front of their line instead of dropped
// - uncertainBelow: OCR lines (items with `ocrScore`) scoring below this get UNCERTAIN_MARK
// - structure: keep the page's layout: indentation as leading spaces, text left and right on the
//   same line (place and date, signatures, form labels) on one line at its column
// - tables: write tables as Markdown tables (see findRegions)
// - pageMarkers / pageLabel (document only): put "--- Seite 1 ---" in front of every page

/** Prefix of OCR lines recognized with low confidence: plain ASCII, so easy to search for. */
export const UNCERTAIN_MARK = '[?]';

// Whitespace-only items are dropped: pdf.js emits them between table cells, sometimes hundreds of
// points wide, where they would hide the gaps between columns and inflate the average char width.
function toBoxes(items, { uncertainBelow } = {}) {
    return items
        .filter(item => item.str && item.str.trim().length > 0)
        .map(item => {
            const [, , , , x, y] = item.transform;
            const box = { str: item.str, x, y, w: item.width, h: Math.abs(item.height) || 12 };
            if (uncertainBelow !== undefined && item.ocrScore < uncertainBelow) box.uncertain = true;
            return box;
        });
}

function buildContext(boxes) {
    // Median height → line-grouping tolerance and cut thresholds
    const sortedH = boxes.map(b => b.h).sort((a, b) => a - b);
    const medianH = sortedH[Math.floor(sortedH.length / 2)] || 12;

    // Average char width for gap classification
    const avgCharW = boxes.reduce((sum, b) => {
        return sum + (b.str.length > 0 ? b.w / b.str.length : 0);
    }, 0) / boxes.length || 7;

    return {
        medianH,
        avgCharW,
        yTolerance: Math.max(medianH * 0.5, 5),
        // Gutter must be wider than any in-row cell gap we want to keep together
        minColumnGap: Math.max(medianH * 1.5, avgCharW * 4),
        // Only paragraph-sized breaks count as block boundaries
        minRowGap: medianH * 0.9,
    };
}

// Without `structure`, `left` stays undefined and lines are rendered flush left as before.
function layoutBoxes(boxes, options = {}) {
    if (boxes.length === 0) return '';
    const ctx = buildContext(boxes);
    const left = options.structure ? baseLeft(boxes, ctx) : undefined;
    const { lines, regions } = findRegions(boxes, ctx, options);
    if (regions.length === 0) return renderFlow(boxes, ctx, left);

    // Tables and aligned lines are cut out of the page as bands; the rest is read by XY-cut
    const parts = [];
    let flow = [];
    let current = null;
    const flush = () => {
        if (flow.length) parts.push(renderFlow(flow, ctx, left));
        flow = [];
    };
    for (const line of lines) {
        if (!line.region) {
            flow.push(...line.items);
            current = null;
        } else if (line.region !== current) {
            flush();
            current = line.region;
            parts.push(renderRegion(current, ctx, left));
        }
    }
    flush();
    return parts.filter(Boolean).join('\n\n');
}

function renderFlow(boxes, ctx, left) {
    return xyCut(boxes, ctx, left).map(block => renderBlock(block.boxes, ctx, block.left)).join('\n\n');
}

export function reconstructPageText(items, options = {}) {
    return layoutBoxes(stripLineNumbers(toBoxes(items, options), options), options);
}

// --- Document level: header/footer removal and de-hyphenation -------------------------------

const MARGIN_RATIO = 0.1;
const PAGE_NUMBER_RE = /^[-–—\s]*(?:seite|page|s\.|p\.)?\s*\d+\s*(?:(?:von|of|\/)\s*\d+)?[-–—\s]*$/i;

function groupLines(boxes, yTolerance) {
    const sorted = [...boxes].sort((a, b) => b.y - a.y);
    const lines = [];
    for (const box of sorted) {
        const last = lines[lines.length - 1];
        if (last && Math.abs(box.y - last.y) <= yTolerance) last.items.push(box);
        else lines.push({ y: box.y, items: [box] });
    }
    return lines;
}

const signatureOf = items => items
    .sort((a, b) => a.x - b.x)
    .map(b => b.str)
    .join(' ')
    .toLowerCase()
    .replace(/\d+/g, '#')
    .replace(/\s+/g, ' ')
    .trim();

// Lines in the top/bottom margin of a page, as { items, text, signature }
function marginLines(boxes, view) {
    const [, y0, , y1] = view;
    const margin = (y1 - y0) * MARGIN_RATIO;
    const inMargin = boxes.filter(b => b.y >= y1 - margin || b.y <= y0 + margin);
    if (inMargin.length === 0) return [];
    const { yTolerance } = buildContext(boxes);
    return groupLines(inMargin, yTolerance).map(line => ({
        items: line.items,
        isHeader: line.y >= y1 - margin,
        text: [...line.items].sort((a, b) => a.x - b.x).map(b => b.str).join(' ').trim(),
        signature: signatureOf(line.items),
    }));
}

// Joins words split by a line-end hyphen ("Verwal-\ntung" → "Verwaltung"). A following
// capital letter or conjunction ("Ein- und Ausgang", "E-\nMail") keeps the hyphen.
// The next line may be indented (structure option): its leading spaces go with the hyphen.
// Line-end hyphens come as "-" (U+002D), as soft hyphen (U+00AD, some PDF tools) or as the
// typographic hyphen U+2010/U+2011 (Chrome and others print a soft hyphen that way when they
// break a word), sometimes as soft hyphen followed by U+2010.
function dehyphenate(text) {
    return text
        .replace(/\u00AD[\u2010\u2011]?\n+ */g, '')
        .replace(
            /([A-Za-zÄÖÜäöüß])[-\u2010\u2011]\n{1,2} *(?!(?:und|oder|bzw|sowie|resp|bis|and|or|et|ou)\b)(?=[a-zäöüß])/g,
            '$1'
        );
}

// --- Line numbers ---------------------------------------------------------------------------
//
// Transcripts (Einvernahmeprotokolle), pleadings and some judgments number every line in the
// margin. Left in, the numbers form a column of their own that the XY-cut reads before the text,
// or they end up between the words of every sentence. A margin column counts as line numbers when
// it holds at least MIN_LINE_NUMBERS bare integers that, read top to bottom, mostly step by 1–3
// (steps of more than 1 allow for blank, unnumbered lines and misread numbers).

const MIN_LINE_NUMBERS = 5;
const LINE_NUMBER_RE = /^(\d{1,4})(?:\s+(\S.*))?$/;

// With keepLineNumbers the numbers still leave the margin (or the XY-cut reads them as a column)
// but are attached to the leftmost box of their line as `lineNo`; renderBlock prints them in
// front of the line. Numbers of blank lines have nothing to attach to and are dropped.
function stripLineNumbers(boxes, { keepLineNumbers = false } = {}) {
    if (boxes.length < MIN_LINE_NUMBERS) return boxes;
    const { avgCharW } = buildContext(boxes);

    // OCR may merge a number with a short line next to it ("14 Ja."): keep the rest as `tail`
    const candidates = [];
    for (const box of boxes) {
        const m = box.str.trim().match(LINE_NUMBER_RE);
        if (m) candidates.push({ box, n: Number(m[1]), digits: m[1].length, tail: m[2] });
    }
    if (candidates.length < MIN_LINE_NUMBERS) return boxes;

    // Group by left edge; numbers grow by one digit (79 → 100), so allow a few chars of drift
    candidates.sort((a, b) => a.box.x - b.box.x);
    const groups = [];
    for (const c of candidates) {
        const last = groups[groups.length - 1];
        if (last && c.box.x - last[0].box.x <= avgCharW * 3) last.push(c);
        else groups.push([c]);
    }

    const gutter = groups
        .filter(g => g.length >= MIN_LINE_NUMBERS && isNumberSequence(g))
        .find(g => isMarginColumn(g, boxes));
    if (!gutter) return boxes;

    const strip = new Map(gutter.map(c => [c.box, c]));
    const result = [];
    const tails = new Map();
    for (const box of boxes) {
        const c = strip.get(box);
        if (!c) result.push(box);
        else if (c.tail) {
            const charW = box.w / box.str.length;
            const cut = box.str.length - c.tail.length;
            const tail = { ...box, str: c.tail, x: box.x + cut * charW, w: box.w - cut * charW };
            tails.set(c, tail);
            result.push(tail);
        }
    }
    if (keepLineNumbers) attachLineNumbers(gutter, tails, result, buildContext(result).yTolerance);
    return result;
}

function attachLineNumbers(gutter, tails, boxes, yTolerance) {
    const digits = Math.max(...gutter.map(c => c.digits));
    for (const c of gutter) {
        let target = tails.get(c);
        if (!target) {
            const sameLine = boxes.filter(b => Math.abs(b.y - c.box.y) <= yTolerance);
            if (sameLine.length === 0) continue;
            target = sameLine.reduce((a, b) => (b.x < a.x ? b : a));
        }
        if (target.lineNo === undefined) target.lineNo = String(c.n).padStart(digits);
    }
}

function isNumberSequence(group) {
    const numbers = [...group].sort((a, b) => b.box.y - a.box.y).map(c => c.n);
    let steps = 0;
    for (let i = 1; i < numbers.length; i++) {
        const d = numbers[i] - numbers[i - 1];
        if (d >= 1 && d <= 3) steps++;
    }
    return steps >= 0.7 * (numbers.length - 1);
}

// The numbers must sit beside the text: left of (or right of) the bulk of the other boxes
function isMarginColumn(group, boxes) {
    const members = new Set(group.map(c => c.box));
    const others = boxes.filter(b => !members.has(b));
    if (others.length === 0) return false;
    const pureRight = Math.max(...group.filter(c => !c.tail).map(c => c.box.x + c.box.w), -Infinity);
    const left = Math.min(...group.map(c => c.box.x));
    const xs = others.map(b => b.x).sort((a, b) => a - b);
    const rights = others.map(b => b.x + b.w).sort((a, b) => a - b);
    const medianX = xs[Math.floor(xs.length / 2)];
    const medianRight = rights[Math.floor(rights.length / 2)];
    return pureRight <= medianX || left >= medianRight;
}

/**
 * @param {Array<{items: Array, view: number[]}>} pages pdf.js text items and page.view per page
 * @param {{keepLineNumbers?: boolean, uncertainBelow?: number, structure?: boolean,
 *   tables?: boolean, pageMarkers?: boolean, pageLabel?: string}} [options] see top of file
 */
export function reconstructDocumentText(pages, options = {}) {
    const parsed = pages.map(({ items, view }) => {
        const boxes = stripLineNumbers(toBoxes(items, options), options);
        return { boxes, lines: view ? marginLines(boxes, view) : [] };
    });

    // A margin line repeated (modulo digits) on at least half of the pages is a header/footer
    const pageCount = new Map();
    for (const { lines } of parsed) {
        for (const sig of new Set(lines.map(l => l.signature))) {
            pageCount.set(sig, (pageCount.get(sig) || 0) + 1);
        }
    }
    const minPages = Math.max(2, Math.ceil(pages.length / 2));

    const texts = parsed.map(({ boxes, lines }, pageIndex) => {
        const noise = new Set();
        for (const line of lines) {
            // The header of the first page is kept: it usually carries the document's title/parties
            const keep = pageIndex === 0 && line.isHeader;
            const repeated = (pageCount.get(line.signature) || 0) >= minPages;
            if (PAGE_NUMBER_RE.test(line.text) || (repeated && !keep)) {
                line.items.forEach(b => noise.add(b));
            }
        }
        return layoutBoxes(boxes.filter(b => !noise.has(b)), options);
    });

    if (options.pageMarkers) {
        const label = options.pageLabel || 'Seite';
        // Markers stop de-hyphenation across pages: the hyphen is then no longer at a line end
        return dehyphenate(texts.map((text, i) => `--- ${label} ${i + 1} ---\n\n${text}`.trimEnd()).join('\n\n')).trim();
    }
    return dehyphenate(texts.filter(Boolean).join('\n\n')).trim();
}

// Returns the intervals' gaps as [{ start, end }] where nothing overlaps, ordered ascending.
function findGaps(intervals, minGap) {
    const sorted = [...intervals].sort((a, b) => a[0] - b[0]);
    const gaps = [];
    let reach = sorted[0][1];
    for (let i = 1; i < sorted.length; i++) {
        const [lo, hi] = sorted[i];
        if (lo - reach >= minGap) gaps.push({ start: reach, end: lo });
        if (hi > reach) reach = hi;
    }
    return gaps;
}

// Returns blocks as { boxes, left }: `left` is the margin indentation is measured from. A column
// gets its own margin, a row keeps that of its parent (undefined: no indentation).
function xyCut(boxes, ctx, left) {
    if (boxes.length < 2) return [{ boxes, left }];

    // 1) Columns: every clean vertical gutter between side-by-side text becomes a cut
    const colGaps = findGaps(boxes.map(b => [b.x, b.x + b.w]), ctx.minColumnGap);
    if (colGaps.length > 0) {
        let columns = Array.from({ length: colGaps.length + 1 }, () => []);
        for (const box of boxes) {
            const idx = colGaps.filter(g => box.x >= g.end - 0.01).length;
            columns[idx].push(box);
        }
        columns = mergeAlternatingColumns(columns.filter(c => c.length), ctx);
        if (columns.length > 1) {
            return columns.flatMap(c => xyCut(c, ctx, left === undefined ? undefined : baseLeft(c, ctx)));
        }
    }

    // 2) Rows: cut at the largest horizontal gap; the halves may still split into columns
    const rowGaps = findGaps(boxes.map(b => [b.y, b.y + b.h]), ctx.minRowGap);
    if (rowGaps.length > 0) {
        const best = rowGaps.reduce((a, b) => (b.end - b.start > a.end - a.start ? b : a));
        const upper = boxes.filter(b => b.y >= best.end - 0.01);
        const lower = boxes.filter(b => b.y < best.end - 0.01);
        if (upper.length && lower.length) return [...xyCut(upper, ctx, left), ...xyCut(lower, ctx, left)];
    }

    return [{ boxes, left }];
}

// A gutter only separates columns if text runs beside it on both sides at the same height.
// Indented blocks that merely alternate with full-width ones, like the questions and answers of
// an interview transcript, leave a gutter too, but must be read top to bottom as one flow.
// A column of labels ("Name:", "Geburtsdatum:") next to their values is kept together as well,
// so that each value is read on one line with its label.
const MIN_SIDE_BY_SIDE = 0.3;
const MIN_LABEL_LINES = 0.6;

function mergeAlternatingColumns(columns, ctx) {
    const merged = [columns[0]];
    for (let i = 1; i < columns.length; i++) {
        const prev = merged[merged.length - 1];
        const separate = sideBySideRatio(prev, columns[i], ctx) >= MIN_SIDE_BY_SIDE
            && !isLabelColumn(prev, ctx);
        if (separate) merged.push(columns[i]);
        else merged[merged.length - 1] = prev.concat(columns[i]);
    }
    return merged;
}

function isLabelColumn(boxes, ctx) {
    const lines = groupLines(boxes, ctx.yTolerance);
    const labels = lines.filter(line => {
        const last = line.items.reduce((a, b) => (b.x > a.x ? b : a));
        return last.str.trim().endsWith(':');
    }).length;
    return labels / lines.length >= MIN_LABEL_LINES;
}

// Share of the smaller column's lines that have a line of the other column at the same height
function sideBySideRatio(a, b, ctx) {
    const linesA = groupLines(a, ctx.yTolerance);
    const linesB = groupLines(b, ctx.yTolerance);
    const [small, large] = linesA.length <= linesB.length ? [linesA, linesB] : [linesB, linesA];
    const paired = small.filter(l => large.some(o => Math.abs(o.y - l.y) <= ctx.yTolerance)).length;
    return paired / small.length;
}

function renderBlock(boxes, ctx, left) {
    const { medianH, yTolerance } = ctx;

    // Sort: Y descending (PDF origin bottom-left), then X ascending
    boxes = [...boxes].sort((a, b) => {
        const dy = b.y - a.y;
        if (Math.abs(dy) > yTolerance) return dy;
        return a.x - b.x;
    });

    // Group into lines by Y proximity
    const lines = [];
    for (const box of boxes) {
        const last = lines[lines.length - 1];
        if (last && Math.abs(box.y - last.y) <= yTolerance) {
            last.items.push(box);
        } else {
            lines.push({ y: box.y, items: [box] });
        }
    }

    const rendered = lines.map(line => {
        const sorted = line.items.sort((a, b) => a.x - b.x);
        const text = renderLine(sorted, ctx, left);
        const lineNo = sorted.find(b => b.lineNo !== undefined)?.lineNo;
        return lineNo === undefined ? text : `${lineNo}  ${text}`.trimEnd();
    });

    // Insert blank lines for large vertical gaps between lines. The gap is measured against the
    // block's own line pitch, not the font height: with 1.5 line spacing (common in court
    // documents) the pitch is 1.5 font heights, and every wrapped line would otherwise get a
    // blank line. Paragraph gaps are mostly cut apart by xyCut before; this catches the rest.
    const pitches = [];
    for (let i = 0; i < lines.length - 1; i++) pitches.push(lines[i].y - lines[i + 1].y);
    const sortedPitches = [...pitches].sort((a, b) => a - b);
    const typicalPitch = Math.max(sortedPitches[Math.floor((sortedPitches.length - 1) / 2)] ?? 0, medianH * 1.15);
    const result = [];
    for (let i = 0; i < rendered.length; i++) {
        result.push(rendered[i]);
        if (i < lines.length - 1) {
            const blanks = Math.min(Math.round(pitches[i] / typicalPitch) - 1, 3);
            for (let j = 0; j < blanks; j++) result.push('');
        }
    }

    return result.join('\n');
}

// Renders one line's boxes (sorted by x) with gap-based spacing. With a margin `left`, the line is
// indented by its distance from the margin and wide gaps pad up to the next box's column, so that
// text placed left and right on a line (place and date, signatures) keeps its position.
const MIN_INDENT = 3;
const MAX_INDENT = 40;
const MAX_COLUMN = 100;

function renderLine(sorted, ctx, left) {
    const { avgCharW } = ctx;
    const column = x => Math.round((x - left) / avgCharW);
    let text = '';
    let prevRight = null;

    for (const box of sorted) {
        const str = box.uncertain ? `${UNCERTAIN_MARK} ${box.str}` : box.str;
        if (prevRight === null) {
            if (left !== undefined) {
                const indent = column(box.x);
                if (indent >= MIN_INDENT) text += ' '.repeat(Math.min(indent, MAX_INDENT));
            }
            text += str;
        } else {
            const gap = box.x - prevRight;
            if (gap >= avgCharW * 4) {
                // Large gap → column separator (LiteParse: COLUMN_SPACES = 4)
                const pad = left === undefined ? 4 : Math.max(4, Math.min(column(box.x), MAX_COLUMN) - text.length);
                text += ' '.repeat(pad) + str;
            } else if (gap >= avgCharW * 0.3) {
                // Word gap → single space
                if (!text.endsWith(' ') && !str.startsWith(' ')) text += ' ';
                text += str;
            } else {
                // Tiny gap or overlap → concatenate directly
                text += str;
            }
        }
        prevRight = box.x + box.w;
    }
    return text.trimEnd();
}

// Margin of a block: the leftmost line start shared by at least two lines, so that a single stray
// box (stamp, note in the margin) does not indent everything else.
function baseLeft(boxes, ctx) {
    const starts = groupLines(boxes, ctx.yTolerance)
        .map(line => Math.min(...line.items.map(b => b.x)))
        .sort((a, b) => a - b);
    for (let i = 0; i < starts.length - 1; i++) {
        if (starts[i + 1] - starts[i] <= ctx.avgCharW) return starts[i];
    }
    return starts[0];
}

// --- Tables and aligned lines ---------------------------------------------------------------
//
// Works on the page's lines (all boxes at one height), so it serves digital and OCR pages alike.
// A line with a wide gap between two of its boxes (CELL_GAP_CHARS) starts a run; following lines
// join it as long as a vertical gutter (GUTTER_CHARS: cells of a table can sit tight) stays free
// through all of them. A line with a single cell joins only as a wrapped cell: right of the first
// gutter (one in the first column is text after the run) and at line pitch (WRAP_GAP) below the
// line before. A run then is
// - text in columns (every column holding long lines): left to the XY-cut, which reads columns;
// - a table: three or more columns, each filled on at least two lines. Two columns are nearly
//   always a form (label and value, often without a colon after OCR) and stay aligned text;
// - otherwise aligned lines: forms, numbered questions, place and date, signature blocks.

const CELL_GAP_CHARS = 2;
const GUTTER_CHARS = 1;
// Vertical whitespace in median line heights
const MAX_RUN_GAP = 2.5;
const WRAP_GAP = 1;
const PROSE_CHARS = 30;
const MIN_PROSE_LINES = 2;

function splitCells(sorted, minGap) {
    const cells = [];
    for (const box of sorted) {
        const last = cells[cells.length - 1];
        if (last && box.x - last.right < minGap) {
            last.items.push(box);
            last.right = Math.max(last.right, box.x + box.w);
        } else {
            cells.push({ items: [box], right: box.x + box.w });
        }
    }
    return cells;
}

const guttersOf = (lines, minGap) => findGaps(lines.flatMap(l => l.items.map(b => [b.x, b.x + b.w])), minGap);

// Items of a line per column, as text
function columnTexts(line, gutters, ctx) {
    const columns = Array.from({ length: gutters.length + 1 }, () => []);
    for (const box of line.items) columns[gutters.filter(g => box.x >= g.end - 0.01).length].push(box);
    return columns.map(items => renderLine(items, ctx).trim());
}

function findRegions(boxes, ctx, options) {
    const lines = groupLines(boxes, ctx.yTolerance).map(line => {
        const items = [...line.items].sort((a, b) => a.x - b.x);
        return { y: line.y, top: Math.max(...items.map(b => b.y + b.h)), items };
    });
    const regions = [];
    if (!options.structure && !options.tables) return { lines, regions };

    const cellGap = ctx.avgCharW * CELL_GAP_CHARS;
    const gutterGap = ctx.avgCharW * GUTTER_CHARS;
    for (const line of lines) line.cells = splitCells(line.items, cellGap).length;

    let i = 0;
    while (i < lines.length) {
        if (lines[i].cells < 2) {
            i++;
            continue;
        }
        const run = [lines[i]];
        for (let j = i + 1; j < lines.length; j++) {
            const line = lines[j];
            const gap = run[run.length - 1].y - line.top;
            if (gap > ctx.medianH * MAX_RUN_GAP) break;
            if (line.cells < 2 && (gap > ctx.medianH * WRAP_GAP
                || line.items[0].x < guttersOf(run, gutterGap)[0].end - 0.01)) break;
            if (guttersOf([...run, line], gutterGap).length === 0) break;
            run.push(line);
        }
        i += run.length;

        const region = classifyRun(run, guttersOf(run, gutterGap), ctx, options);
        if (region) {
            regions.push(region);
            for (const line of run) line.region = region;
        }
    }
    return { lines, regions };
}

function classifyRun(run, gutters, ctx, options) {
    const grid = run.map(line => columnTexts(line, gutters, ctx));
    const columns = gutters.length + 1;
    const filled = grid.filter(row => row.filter(Boolean).length >= 2).length;

    const median = values => values.sort((a, b) => a - b)[Math.floor(values.length / 2)] || 0;
    const columnLengths = Array.from({ length: columns }, (_, c) => median(grid.map(r => r[c].length).filter(Boolean)));
    // In einem Tabellenbereich des Layoutmodells ist die Tabelle gesichert: schon ab 2 Spalten
    // und auch mit langen Zellen; sonst erst ab 3 Spalten, damit Fliesstext keine Tabelle wird
    const { tableRegion } = options;
    if (!tableRegion && run.length >= MIN_PROSE_LINES && columnLengths.every(n => n >= PROSE_CHARS)) return null;

    const isTable = columns >= (tableRegion ? 2 : 3) && filled >= 2
        && Array.from({ length: columns }, (_, c) => grid.filter(r => r[c]).length).every(n => n >= 2);

    if (isTable && options.tables) return { kind: 'table', lines: run, grid };
    if (options.structure) return { kind: 'aligned', lines: run };
    return null;
}

function renderRegion(region, ctx, left) {
    if (region.kind === 'aligned') return renderBlock(region.lines.flatMap(l => l.items), ctx, left);

    // A line with an empty first cell belongs to a cell wrapped over several lines: it joins the
    // nearest row start above or below (cells may be centred vertically), the one above on a tie.
    const { lines, grid } = region;
    const starts = lines.map((line, i) => i === 0 || grid[i][0] !== '');
    const owner = lines.map((line, i) => {
        if (starts[i]) return i;
        let above = i - 1;
        while (!starts[above]) above--;
        let below = i + 1;
        while (below < lines.length && !starts[below]) below++;
        if (below === lines.length) return above;
        return lines[i].y - lines[below].y < lines[above].y - lines[i].y ? below : above;
    });
    const rows = [];
    const rowOf = new Map();
    lines.forEach((line, i) => {
        if (!rowOf.has(owner[i])) {
            rowOf.set(owner[i], rows.length);
            rows.push(grid[i].map(() => ''));
        }
        const row = rows[rowOf.get(owner[i])];
        grid[i].forEach((text, c) => { row[c] = joinWrapped(row[c], text); });
    });
    const format = row => `| ${row.map(text => text.replace(/\|/g, '\\|')).join(' | ')} |`;
    return [format(rows[0]), format(rows[0].map(() => '---')), ...rows.slice(1).map(format)].join('\n');
}

function joinWrapped(a, b) {
    if (!a || !b) return a || b;
    if (/[A-Za-zÄÖÜäöüß]-$/.test(a) && /^[a-zäöüß]/.test(b)) return a.slice(0, -1) + b;
    return `${a} ${b}`;
}
