import { describe, expect, it } from 'vitest';
import { findBulletShapes } from '../src/capture/bullets.js';

const OPS = {
    save: 10, restore: 11, transform: 12, stroke: 20, closeStroke: 21, fill: 22, eoFill: 23,
    fillStroke: 24, eoFillStroke: 25, closeFillStroke: 26, closeEOFillStroke: 27, endPath: 28,
    paintFormXObjectBegin: 74, paintFormXObjectEnd: 75, constructPath: 91,
};
const ops = list => ({ fnArray: list.map(([fn]) => OPS[fn]), argsArray: list.map(([, args]) => args ?? null) });

// Kreis aus vier Bézierkurven um (cx, cy) mit Radius r, wie ihn Chrome für Aufzählungspunkte zeichnet
function circle(cx, cy, r) {
    const k = r * 0.5523;
    const data = [0, cx + r, cy,
        2, cx + r, cy + k, cx + k, cy + r, cx, cy + r,
        2, cx - k, cy + r, cx - r, cy + k, cx - r, cy,
        2, cx - r, cy - k, cx - k, cy - r, cx, cy - r,
        2, cx + k, cy - r, cx + r, cy - k, cx + r, cy, 4];
    return [new Float32Array(data)];
}
const rect = (x, y, w, h) => [new Float32Array([0, x, y, 1, x + w, y, 1, x + w, y + h, 1, x, y + h, 4])];
const path = (op, data, [x0, y0, x1, y1]) => ['constructPath', [OPS[op], data, new Float32Array([x0, y0, x1, y1])]];

describe('findBulletShapes', () => {
    it('findet gefüllte und umrandete Punkte, in Seitenkoordinaten umgerechnet', () => {
        const bullets = findBulletShapes(ops([
            ['transform', [0.5, 0, 0, -0.5, 0, 800]],
            path('fill', circle(100, 100, 4), [96, 96, 104, 104]),
            ['save'], ['transform', [1, 0, 0, 1, 40, 0]],
            path('stroke', circle(100, 140, 4), [96, 136, 104, 144]),
            ['restore'],
        ]), OPS);
        expect(bullets).toEqual([{ x: 48, y: 748, w: 4, h: 4 }, { x: 68, y: 728, w: 4, h: 4 }]);
    });

    it('lässt Tabellenlinien, grosse Formen und umrandete Quadrate (Ankreuzfelder) weg', () => {
        expect(findBulletShapes(ops([
            path('fill', rect(10, 10, 200, 0.75), [10, 10, 210, 10.75]),
            path('fill', circle(100, 100, 20), [80, 80, 120, 120]),
            path('stroke', rect(50, 50, 5, 5), [50, 50, 55, 55]),
            path('endPath', circle(100, 100, 2), [98, 98, 102, 102]),
        ]), OPS)).toEqual([]);
    });

    it('nimmt gefüllte Quadrate als Aufzählungszeichen', () => {
        expect(findBulletShapes(ops([path('fill', rect(50, 50, 4, 4), [50, 50, 54, 54])]), OPS)).toEqual([{ x: 50, y: 50, w: 4, h: 4 }]);
    });

    it('wendet die Matrix eines Formular-Objekts an', () => {
        const bullets = findBulletShapes(ops([
            ['paintFormXObjectBegin', [[1, 0, 0, 1, 10, 20], [0, 0, 100, 100]]],
            path('fill', circle(5, 5, 2), [3, 3, 7, 7]),
            ['paintFormXObjectEnd'],
            path('fill', circle(5, 5, 2), [3, 3, 7, 7]),
        ]), OPS);
        expect(bullets).toEqual([{ x: 13, y: 23, w: 4, h: 4 }, { x: 3, y: 3, w: 4, h: 4 }]);
    });
});
