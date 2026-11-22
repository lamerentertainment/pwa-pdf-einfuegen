import { describe, expect, it } from 'vitest';
import { deltaText, parseSse } from '../src/llm/intranet.js';

describe('Stream der internen KI', () => {
    it('zerlegt Ereignisse und behält den unvollständigen Rest', () => {
        const { events, rest } = parseSse('data: {"a":1}\n\ndata: {"b":2}\n\ndata: {"c"');
        expect(events).toEqual(['{"a":1}', '{"b":2}']);
        expect(rest).toBe('data: {"c"');
    });

    it('versteht Windows-Zeilenenden und ignoriert Kommentare', () => {
        expect(parseSse(': ping\r\n\r\ndata: x\r\n\r\n').events).toEqual(['x']);
    });

    it('liest den Text aus einem Ereignis', () => {
        expect(deltaText('{"choices":[{"delta":{"content":"Er sei"}}]}')).toBe('Er sei');
        expect(deltaText('{"choices":[{"delta":{}}]}')).toBe('');
        expect(deltaText('[DONE]')).toBe('');
        expect(deltaText('kein json')).toBe('');
    });
});
