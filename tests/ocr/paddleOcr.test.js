import { describe, it, expect } from 'vitest';
import { parseCharacterDict, ctcDecode, dbPostprocess, pageSkew, DEFAULT_OPTIONS } from '../../src/ocr/paddleOcr.js';

describe('parseCharacterDict', () => {
    it('reads the character list from the recognizer config, unquoting YAML scalars', () => {
        const yml = [
            'PostProcess:',
            '  name: CTCLabelDecode',
            '  character_dict:',
            "  - '0'",
            '  - A',
            '  - ä',
            "  - ''''",
            '  - \'#\'',
            'Other: 1',
        ].join('\n');
        expect(parseCharacterDict(yml)).toEqual(['0', 'A', 'ä', "'", '#']);
    });

    it('fails loudly without a character_dict', () => {
        expect(() => parseCharacterDict('PostProcess:\n  name: x\n')).toThrow();
    });
});

describe('ctcDecode', () => {
    // classes: 0 blank, 1 'a', 2 'b', 3 ' '
    const alphabet = ['', 'a', 'b', ' '];
    const seq = steps => new Float32Array(steps.flatMap(c => [0, 1, 2, 3].map(k => (k === c ? 0.9 : 0.1 / 3))));

    it('collapses repeats and drops blanks', () => {
        const data = seq([1, 1, 0, 1, 2, 2, 3, 2]);
        expect(ctcDecode(data, 0, 8, 4, alphabet).text).toBe('aab b');
    });

    it('scores by the mean probability of emitted characters', () => {
        const { score } = ctcDecode(seq([0, 1, 0]), 0, 3, 4, alphabet);
        expect(score).toBeCloseTo(0.9);
    });

    it('returns an empty result for all-blank input', () => {
        expect(ctcDecode(seq([0, 0]), 0, 2, 4, alphabet)).toEqual({ text: '', score: 0 });
    });
});

describe('dbPostprocess', () => {
    const map = (w, h, paint) => {
        const prob = new Float32Array(w * h);
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) prob[y * w + x] = paint(x, y) ? 0.9 : 0;
        return prob;
    };

    it('finds separate lines and grows them by the unclip margin', () => {
        const prob = map(200, 60, (x, y) => x >= 10 && x < 190 && ((y >= 10 && y < 18) || (y >= 30 && y < 38)));
        const regions = dbPostprocess(prob, 200, 60, DEFAULT_OPTIONS);
        expect(regions).toHaveLength(2);
        const [a] = regions;
        expect(a.len).toBeCloseTo(180, 0);
        expect(a.thick).toBeCloseTo(8, 0);
        expect(a.grow).toBeGreaterThan(5);
    });

    it('follows the page skew of slanted lines', () => {
        const slope = Math.tan((2 * Math.PI) / 180);
        const prob = map(400, 80, (x, y) => x >= 20 && x < 380 && Math.abs(y - (30 + (x - 20) * slope)) < 4);
        const [region] = dbPostprocess(prob, 400, 80, DEFAULT_OPTIONS);
        expect(Math.atan2(region.uy, region.ux) * 180 / Math.PI).toBeCloseTo(2, 0);
        // Thickness measured across the slanted line, not its axis-aligned bounding box (~20px)
        expect(region.thick).toBeLessThan(10);
    });

    it('drops faint and tiny regions', () => {
        const prob = new Float32Array(100 * 20).fill(0);
        for (let x = 10; x < 90; x++) for (let y = 5; y < 12; y++) prob[y * 100 + x] = 0.4; // below boxThresh
        prob[15 * 100 + 50] = 0.9; // single pixel
        expect(dbPostprocess(prob, 100, 20, DEFAULT_OPTIONS)).toEqual([]);
    });
});

describe('pageSkew', () => {
    it('takes the weighted median angle of long lines and ignores short or steep regions', () => {
        const comps = [
            { bw: 300, bh: 10, angle: 0.02 },
            { bw: 280, bh: 10, angle: 0.021 },
            { bw: 20, bh: 10, angle: 0.5 }, // short word: unreliable
            { bw: 300, bh: 10, angle: 0.6 }, // beyond the skew limit
        ];
        expect(pageSkew(comps)).toBeCloseTo(0.02, 3);
    });

    it('is 0 without line-shaped regions', () => {
        expect(pageSkew([{ bw: 10, bh: 10, angle: 0.3 }])).toBe(0);
    });
});
