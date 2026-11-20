import { describe, it, expect } from 'vitest';
import { parseActPagination, parseExcerpt, planPagination, actPageNames, announcedPageCount } from '../src/capture/actPagination.js';

const names = (fileName, pageCount) => actPageNames(parseActPagination(fileName), pageCount);

describe('pag_ convention', () => {
    it('reads levels and page range', () => {
        expect(names('pag_10_1_1-3.pdf', 3)).toEqual(['pag. 10.1.1', 'pag. 10.1.2', 'pag. 10.1.3']);
        expect(announcedPageCount(parseActPagination('pag_10_1_1-3.pdf'))).toBe(3);
    });

    it('starts at the first page of the range', () => {
        expect(names('pag_10_1_2-3.pdf', 2)).toEqual(['pag. 10.1.2', 'pag. 10.1.3']);
        expect(announcedPageCount(parseActPagination('pag_10_1_2-3.pdf'))).toBe(2);
    });

    it('accepts a single page and counts on from it', () => {
        expect(names('pag_10_1_7.pdf', 2)).toEqual(['pag. 10.1.7', 'pag. 10.1.8']);
        expect(announcedPageCount(parseActPagination('pag_10_1_7.pdf'))).toBeNull();
    });

    it('handles any number of levels', () => {
        expect(names('pag_4-5.pdf', 2)).toEqual(['pag. 4', 'pag. 5']);
        expect(names('pag_2_10_3_12-12.pdf', 1)).toEqual(['pag. 2.10.3.12']);
    });

    it('ignores text after the pagination, case and a path', () => {
        for (const fileName of ['PAG_10_1_1-3 Einvernahme Muster.pdf', 'pag_10_1_1-3_Einvernahme.pdf',
            'pag_10_1_1-3 (1).pdf', 'C:\\Akten\\pag_10_1_1-3.pdf']) {
            expect(names(fileName, 1)).toEqual(['pag. 10.1.1']);
        }
    });

    it('rejects malformed names and reversed ranges', () => {
        expect(parseActPagination('pagination.pdf')).toBeNull();
        expect(parseActPagination('pag_10_1_5-3.pdf')).toBeNull();
        expect(parseActPagination('pag_10_1_1-3x.pdf')).toBeNull();
    });
});

describe('R…B… convention', () => {
    it('counts on from the Beleg with "ff", without a range to check', () => {
        expect(names('R2B200ff.pdf', 3)).toEqual(['Reg. 2 Bel. 200', 'Reg. 2 Bel. 201', 'Reg. 2 Bel. 202']);
        expect(announcedPageCount(parseActPagination('R2B200ff.pdf'))).toBeNull();
        expect(parseActPagination('R2B200ff.pdf').openEnd).toBe(true);
        expect(parseActPagination('R2B200-299.pdf').openEnd).toBe(false);
    });

    it('reads a range', () => {
        expect(names('R2B200-299.pdf', 2)).toEqual(['Reg. 2 Bel. 200', 'Reg. 2 Bel. 201']);
        expect(announcedPageCount(parseActPagination('R2B200-299.pdf'))).toBe(100);
    });

    it('accepts a single Beleg, lower case, multi-digit registers and trailing text', () => {
        expect(names('R12B5.pdf', 1)).toEqual(['Reg. 12 Bel. 5']);
        expect(names('r2b200ff Kontoauszüge.pdf', 1)).toEqual(['Reg. 2 Bel. 200']);
        expect(names('R2B200-299_Bank.pdf', 1)).toEqual(['Reg. 2 Bel. 200']);
    });

    it('reads a whole register, counted from Bel. 1, as open-ended', () => {
        const p = parseActPagination('r4.pdf');
        expect(p).toMatchObject({ first: 1, last: null, openEnd: true, scope: 'Reg. 4' });
        expect(actPageNames(p, 2)).toEqual(['Reg. 4 Bel. 1', 'Reg. 4 Bel. 2']);
        expect(parseActPagination('R12 Bank.pdf')).toMatchObject({ scope: 'Reg. 12' });
        expect(parseActPagination('R2B200ff.pdf').scope).toBeNull();
    });

    it('tolerates spaces, "_" and "-" between the parts', () => {
        for (const fileName of ['R4 B200ff.pdf', 'R4_B200ff.pdf', 'R4B200 ff.pdf', 'R4-B200FF.pdf',
            'R4B200ff-Bank.pdf', 'R4B200ff_Bank.pdf']) {
            expect(parseActPagination(fileName), fileName).toMatchObject({ first: 200, openEnd: true, scope: null });
            expect(names(fileName, 1), fileName).toEqual(['Reg. 4 Bel. 200']);
        }
        expect(parseActPagination('R4 B200 - 299.pdf')).toMatchObject({ first: 200, last: 299, openEnd: false });
        expect(parseActPagination('R4 Bank.pdf')).toMatchObject({ scope: 'Reg. 4', openEnd: true });
    });

    it('rejects malformed names and reversed ranges', () => {
        expect(parseActPagination('R2B200-199.pdf')).toBeNull();
        expect(parseActPagination('R2B200-299x.pdf')).toBeNull();
        expect(parseActPagination('R2B200ffx.pdf')).toBeNull();
        expect(parseActPagination('Rechnung.pdf')).toBeNull();
        expect(parseActPagination('R2B.pdf')).toBeNull();
        expect(parseActPagination('R2x.pdf')).toBeNull();
    });
});

it('leaves other names to the default markers', () => {
    expect(parseActPagination('Einvernahme1.pdf')).toBeNull();
});

describe('excerpts dragged out of PDF-XChange', () => {
    const plan = (fileName, pageCount) => {
        const p = planPagination(fileName, pageCount);
        return p && { ask: p.ask, names: actPageNames(p.pagination, pageCount, p.start) };
    };

    it('reads the page range and the original name', () => {
        expect(parseExcerpt('Seite 5 von R2.pdf')).toEqual({ from: 5, to: 5, source: 'R2' });
        expect(parseExcerpt('Seiten 4 bis 5 von R2B200ff.pdf')).toEqual({ from: 4, to: 5, source: 'R2B200ff' });
        expect(parseExcerpt('Pages 4 to 5 of pag_10_1_1-9.pdf')).toEqual({ from: 4, to: 5, source: 'pag_10_1_1-9' });
        expect(parseExcerpt('R2B200ff.pdf')).toBeNull();
        expect(parseExcerpt('Seiten 5 bis 4 von R2.pdf')).toBeNull();
    });

    it('derives the start from the original without asking', () => {
        expect(plan('Seiten 4 bis 5 von R2B200ff.pdf', 2)).toEqual({ ask: null, names: ['Reg. 2 Bel. 203', 'Reg. 2 Bel. 204'] });
        expect(plan('Seite 3 von R2B200-299.pdf', 1)).toEqual({ ask: null, names: ['Reg. 2 Bel. 202'] });
        expect(plan('Seiten 2 bis 3 von pag_10_1_1-3.pdf', 2)).toEqual({ ask: null, names: ['pag. 10.1.2', 'pag. 10.1.3'] });
        expect(plan('Seite 2 von pag_10_1_7.pdf', 1)).toEqual({ ask: null, names: ['pag. 10.1.8'] });
    });

    it('asks for a whole register, suggesting Beleg = page', () => {
        expect(plan('Seite 5 von R2.pdf', 1)).toEqual({ ask: 'excerptRegister', names: ['Reg. 2 Bel. 5'] });
        expect(plan('Seiten 4 bis 5 von R2.pdf', 2)).toEqual({ ask: 'excerptRegister', names: ['Reg. 2 Bel. 4', 'Reg. 2 Bel. 5'] });
    });

    it('asks when the pages do not fit the PDF or the range', () => {
        expect(plan('Seiten 4 bis 5 von R2B200ff.pdf', 3).ask).toBe('excerpt');
        expect(plan('Seiten 2 bis 4 von pag_10_1_1-3.pdf', 3).ask).toBe('excerpt');
    });

    it('ignores excerpts of files without a convention', () => {
        expect(planPagination('Seite 5 von Einvernahme.pdf', 1)).toBeNull();
    });
});

describe('planPagination for whole files', () => {
    it('asks only when the name does not determine the start', () => {
        expect(planPagination('pag_10_1_1-3.pdf', 3).ask).toBeNull();
        expect(planPagination('pag_10_1_1-3.pdf', 2).ask).toBe('mismatch');
        expect(planPagination('R4B200ff.pdf', 2).ask).toBe('open');
        expect(planPagination('R4.pdf', 2).ask).toBe('register');
        expect(planPagination('R12B5.pdf', 3).ask).toBeNull();
        expect(planPagination('Einvernahme1.pdf', 3)).toBeNull();
    });
});
