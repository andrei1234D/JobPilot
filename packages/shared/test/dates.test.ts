import { describe, expect, it } from 'vitest';
import { addDays, daysBetween, findDates, formatDay, formatWeekday, parseFuzzyDate, toIso, weekStart } from '../src';

describe('parseFuzzyDate', () => {
  it.each([
    ['14 Nov 2026', '2026-11-14'],
    ['14 November 2026', '2026-11-14'],
    ['Sat 14 Nov 2026', '2026-11-14'],
    ['2026-11-14', '2026-11-14'],
    ['Nov 14, 2026', '2026-11-14'],
    ['14.11.2026', '2026-11-14'],
    ['1st Dec 2026', '2026-12-01'],
  ])('reads an exact day: %s', (raw, iso) => {
    expect(parseFuzzyDate(raw)).toEqual({ raw, iso, precision: 'day', approximate: false });
  });

  it('uses the reference year when the text has none', () => {
    expect(parseFuzzyDate('9 Oct', 2026).iso).toBe('2026-10-09');
    expect(parseFuzzyDate('9 Oct').precision).toBe('unknown');
  });

  it('keeps "~Sep 2026" as an approximate month', () => {
    expect(parseFuzzyDate('~Sep 2026')).toEqual({ raw: '~Sep 2026', iso: '2026-09-01', precision: 'month', approximate: true });
  });

  it('marks "by 25 Sep 2026" as a bound, not a fact', () => {
    expect(parseFuzzyDate('by 25 Sep 2026')).toEqual({ raw: 'by 25 Sep 2026', iso: '2026-09-25', precision: 'day', approximate: true });
  });

  it.each(['unknown', '-', '', '?', 'n/a', 'TBD'])('treats %j as unknown', (raw) => {
    expect(parseFuzzyDate(raw)).toMatchObject({ iso: null, precision: 'unknown' });
  });

  it('never throws on nonsense and keeps the raw text', () => {
    for (const raw of ['next week', '31 Feb 2026', '99 Nov 2026', '| | |', 'Nov', '2026']) {
      const parsed = parseFuzzyDate(raw);
      expect(parsed.raw).toBe(raw);
      expect(parsed.iso).toBeNull();
    }
  });
});

describe('findDates', () => {
  it('finds dates with and without a year and a clock time', () => {
    const found = findDates('Submitted 7 Nov ~10:55; rejected 9 Nov 2026 15:20', '2026-11-07', 2026);
    expect(found.map((d) => [d.iso, d.time])).toEqual([
      ['2026-11-07', '10:55'],
      ['2026-11-09', '15:20'],
    ]);
  });

  it('rolls into the next year after December', () => {
    expect(findDates('Rejected 5 Jan', '2026-12-20', 2026)[0]?.iso).toBe('2027-01-05');
  });

  it('leaves a recent past reference in the same year', () => {
    // "earlier application ... rejected 17 Sep" in a row applied on 30 Oct.
    expect(findDates('rejected 17 Sep', '2026-10-30', 2026)[0]?.iso).toBe('2026-09-17');
  });

  it('ignores numbers that are not dates', () => {
    expect(findDates('48 applicants; EUR 3,000-4,000/month; 2 May be late', null, 2026).map((d) => d.iso)).toEqual(['2026-05-02']);
    expect(findDates('salary 13,700 RON; req 216000', null, 2026)).toEqual([]);
  });
});

describe('date maths', () => {
  it('counts days across a month and a leap day', () => {
    expect(daysBetween('2026-10-28', '2026-11-15')).toBe(18);
    expect(daysBetween('2028-02-28', '2028-03-01')).toBe(2);
    expect(daysBetween('2026-11-15', '2026-11-10')).toBe(-5);
  });

  it('adds days and finds Monday', () => {
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
    expect(weekStart('2026-11-15')).toBe('2026-11-09'); // Sunday belongs to the week that started on Monday
    expect(weekStart('2026-11-09')).toBe('2026-11-09');
  });

  it('rejects impossible days', () => {
    expect(toIso(2026, 2, 30)).toBeNull();
    expect(toIso(2028, 2, 29)).toBe('2028-02-29');
  });

  it('formats for display', () => {
    expect(formatDay('2026-11-05')).toBe('5 Nov 2026');
    expect(formatWeekday('2026-11-15')).toBe('Sun 15 Nov');
  });
});
