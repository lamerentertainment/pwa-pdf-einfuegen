import { describe, expect, it } from 'vitest';
import { findBulletBlobs } from '../../src/ocr/bulletBlobs.js';

// Weisses Bild, in das Formen schwarz gemalt werden
function canvas(width, height) {
    const data = new Uint8ClampedArray(width * height * 4).fill(255);
    const set = (x, y) => { const o = (y * width + x) * 4; data[o] = data[o + 1] = data[o + 2] = 0; };
    const paint = test => {
        for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (test(x, y)) set(x, y);
    };
    return { image: { data, width, height }, paint };
}
const disc = (cx, cy, r) => (x, y) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
const ring = (cx, cy, r) => (x, y) => { const d = Math.hypot(x - cx, y - cy); return d <= r && d >= r - 1.6; };
const rect = (x0, y0, w, h) => (x, y) => x >= x0 && x < x0 + w && y >= y0 && y < y0 + h;
// «Text»: ein Block aus Strichen wie Buchstaben
const word = (x0, y0, w, h) => (x, y) => rect(x0, y0, w, h)(x, y) && (x - x0) % 6 < 3;

// Zeile 20 px hoch, Text ab x = 60; der Punkt liegt bei x ≈ 40, in der Zeilenmitte
const line = (x = 36, y = 20) => ({ x, y, w: 200, h: 20 });

describe('findBulletBlobs', () => {
    it('findet einen gefüllten Punkt am Zeilenanfang, auch wenn die Zeile bei ihm beginnt', () => {
        const { image, paint } = canvas(300, 60);
        paint(disc(40, 31, 4));
        paint(word(60, 22, 120, 16));
        expect(findBulletBlobs(image, [line()])).toEqual([{ x: 36, y: 27, w: 9, h: 9 }]);
        expect(findBulletBlobs(image, [line(60)])).toHaveLength(1);
    });

    it('findet Kreise, Quadrate und Striche (diese als dash)', () => {
        for (const [shape, dash] of [[ring(40, 31, 5), false], [rect(36, 27, 8, 8), false], [rect(34, 30, 10, 2), true]]) {
            const { image, paint } = canvas(300, 60);
            paint(shape);
            paint(word(60, 22, 120, 16));
            const [bullet] = findBulletBlobs(image, [line()]);
            expect(bullet).toBeDefined();
            expect(Boolean(bullet.dash)).toBe(dash);
        }
    });

    it('übergeht Satzpunkte, Buchstaben am Wortanfang und offene Formen', () => {
        const cases = [
            disc(40, 33, 1.5), // Satzpunkt: zu klein
            disc(57, 31, 4), // klebt am Wort
            (x, y) => ring(40, 31, 5)(x, y) && x < 43, // offen wie ein «c» oder eine «4»
        ];
        for (const shape of cases) {
            const { image, paint } = canvas(300, 60);
            paint(shape);
            paint(word(60, 22, 120, 16));
            expect(findBulletBlobs(image, [line()])).toEqual([]);
        }
    });

    it('nimmt nur die erste Fläche der Zeile', () => {
        const { image, paint } = canvas(300, 60);
        paint(word(10, 22, 20, 16));
        paint(disc(46, 31, 4));
        paint(word(60, 22, 120, 16));
        expect(findBulletBlobs(image, [line(10)])).toEqual([]);
    });
});
