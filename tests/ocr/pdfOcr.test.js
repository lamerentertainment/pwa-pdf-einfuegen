import { describe, it, expect } from 'vitest';
import { scanOperators, linesToTextItems } from '../../src/ocr/pdfOcr.js';

const OPS = {
    save: 10, restore: 11, setTextRenderingMode: 20, showText: 44, showSpacedText: 45,
    paintImageXObject: 85, paintImageMaskXObject: 83, paintInlineImageXObject: 86,
};
const ops = list => ({ fnArray: list.map(([fn]) => OPS[fn]), argsArray: list.map(([, args]) => args ?? null) });

describe('scanOperators', () => {
    it('detects an image with invisible text (scanner OCR layer)', () => {
        expect(scanOperators(ops([
            ['paintImageXObject'],
            ['setTextRenderingMode', [3]],
            ['showText'],
        ]), OPS)).toEqual({ hasImage: true, visibleText: false, invisibleText: true });
    });

    it('restores the text render mode with the graphics state', () => {
        const result = scanOperators(ops([
            ['save'], ['setTextRenderingMode', [3]], ['restore'],
            ['showText'],
        ]), OPS);
        expect(result.visibleText).toBe(true);
        expect(result.invisibleText).toBe(false);
    });

    it('reports visible text on a digital page with a logo', () => {
        expect(scanOperators(ops([['paintImageMaskXObject'], ['showSpacedText']]), OPS))
            .toEqual({ hasImage: true, visibleText: true, invisibleText: false });
    });
});

describe('linesToTextItems', () => {
    it('maps image pixels (top-left origin) to PDF units (bottom-left origin)', () => {
        const scale = 2; // 144 dpi
        const view = [0, 0, 600, 800];
        const [it0] = linesToTextItems([{ text: 'Hallo', x: 100, y: 200, w: 80, h: 20, score: 0.99 }], scale, view);
        expect(it0.str).toBe('Hallo');
        expect(it0.transform[4]).toBe(50);
        expect(it0.transform[5]).toBe(800 - 110);
        expect(it0.width).toBe(40);
        expect(it0.height).toBe(10);
    });
});
