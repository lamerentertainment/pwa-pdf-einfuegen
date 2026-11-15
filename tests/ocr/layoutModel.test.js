import { describe, it, expect } from 'vitest';
import { preprocess, postprocess, regionOfLine, dropLinesInRegions, LAYOUT_LABELS } from '../../src/ocr/layoutModel.js';

const cls = label => LAYOUT_LABELS.indexOf(label);

describe('preprocess', () => {
    it('stretches to size×size, planar RGB scaled to 0..1', () => {
        // 2×1 image: red | blue
        const data = new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 255, 255]);
        const out = preprocess({ data, width: 2, height: 1 }, 4);
        expect(out.length).toBe(3 * 16);
        // left column is pure red, right column pure blue (edges clamp)
        expect(out[0]).toBeCloseTo(1); // R plane, (0,0)
        expect(out[2 * 16 + 0]).toBeCloseTo(0); // B plane, (0,0)
        expect(out[3]).toBeCloseTo(0); // R plane, (3,0)
        expect(out[2 * 16 + 3]).toBeCloseTo(1); // B plane, (3,0)
        // in between it blends
        expect(out[1]).toBeGreaterThan(0.5);
        expect(out[1]).toBeLessThan(1);
    });
});

describe('postprocess', () => {
    it('keeps rows above the threshold, maps labels and converts to x/y/w/h', () => {
        const rows = [
            cls('text'), 0.9, 10, 20, 110, 70,
            cls('header'), 0.3, 0, 0, 50, 10, // below threshold
        ];
        expect(postprocess(rows, 6)).toEqual([
            { label: 'text', score: expect.closeTo(0.9), x: 10, y: 20, w: 100, h: 50 },
        ]);
    });

    it('drops near-duplicate boxes, keeping the higher score', () => {
        const rows = [
            cls('text'), 0.6, 10, 10, 100, 30,
            cls('paragraph_title'), 0.8, 10, 10, 101, 30,
        ];
        const out = postprocess(rows, 6);
        expect(out).toHaveLength(1);
        expect(out[0].label).toBe('paragraph_title');
    });

    it('clips to the image and skips empty boxes', () => {
        const rows = [
            cls('footer'), 0.9, -5, 90, 50, 120,
            cls('text'), 0.9, 200, 0, 300, 10, // entirely right of the image
        ];
        expect(postprocess(rows, 6, { width: 100, height: 100 })).toEqual([
            { label: 'footer', score: expect.closeTo(0.9), x: 0, y: 90, w: 50, h: 10 },
        ]);
    });
});

describe('regions and lines', () => {
    const block = { label: 'text', score: 0.9, x: 0, y: 0, w: 500, h: 500 };
    const title = { label: 'paragraph_title', score: 0.9, x: 10, y: 10, w: 100, h: 20 };
    const header = { label: 'header', score: 0.9, x: 0, y: 600, w: 500, h: 30 };

    it('assigns a line to the smallest region containing its centre', () => {
        expect(regionOfLine({ x: 20, y: 12, w: 60, h: 10 }, [block, title])).toBe(title);
        expect(regionOfLine({ x: 20, y: 200, w: 60, h: 10 }, [block, title])).toBe(block);
        expect(regionOfLine({ x: 20, y: 900, w: 60, h: 10 }, [block, title])).toBeNull();
    });

    it('drops lines in header/footer/page number regions only', () => {
        const lines = [
            { text: 'Body', x: 20, y: 200, w: 60, h: 10 },
            { text: 'Kantonspolizei', x: 20, y: 605, w: 100, h: 15 },
            { text: 'outside', x: 20, y: 900, w: 60, h: 10 },
        ];
        expect(dropLinesInRegions(lines, [block, header]).map(l => l.text)).toEqual(['Body', 'outside']);
        expect(dropLinesInRegions(lines, [block])).toBe(lines);
    });
});
