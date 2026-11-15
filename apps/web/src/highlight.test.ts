import { describe, expect, it } from 'vitest';
import { findRanges, splitByMatches } from './highlight';

const marked = (text: string, terms: string[]): string[] => splitByMatches(text, terms).filter((p) => p.match).map((p) => p.text);

describe('highlight ranges', () => {
  it('marks every occurrence, ignoring case', () => {
    expect(marked('Teamtailor form, teamtailor guest form', ['teamtailor'])).toEqual(['Teamtailor', 'teamtailor']);
  });

  it('marks a quoted phrase as one piece', () => {
    expect(marked('Rejected: no reply yet, no news', ['no reply'])).toEqual(['no reply']);
  });

  it('ignores accents in both directions and keeps the original spelling', () => {
    expect(marked('Östra Mobility, Åkesson', ['ostra', 'akesson'])).toEqual(['Östra', 'Åkesson']);
    expect(marked('Ostra Mobility', ['östra'])).toEqual(['Ostra']);
  });

  it('merges overlapping and adjacent matches', () => {
    expect(findRanges('abcdef', ['abc', 'cde'])).toEqual([[0, 5]]);
    expect(marked('Polder Systems', ['polder', 'systems'])).toEqual(['Polder', 'Systems']);
  });

  it('returns the text unchanged when nothing matches or there are no terms', () => {
    expect(splitByMatches('Nothing here', ['zzz'])).toEqual([{ text: 'Nothing here', match: false }]);
    expect(splitByMatches('Nothing here', [])).toEqual([{ text: 'Nothing here', match: false }]);
    expect(splitByMatches('', ['a'])).toEqual([]);
  });

  it('concatenating the pieces always gives the original text back', () => {
    const text = '…Fjordbyte (Teamtailor 8683001), “quoted” — İstanbul 😀 end';
    expect(splitByMatches(text, ['teamtailor', 'istanbul', '😀']).map((p) => p.text).join('')).toBe(text);
  });
});
