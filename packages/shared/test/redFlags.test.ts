import { describe, expect, it } from 'vitest';
import { adSentences, detectAdLanguage, redFlags } from '../src';

const ids = (flags: ReturnType<typeof redFlags>) => flags.map((f) => f.id);

describe('redFlags: languages', () => {
  it('flags a required language with the sentence that says so', () => {
    const flags = redFlags('We build billing software.\nFluent Dutch and English are required for this role.');
    expect(flags).toEqual([{ id: 'language-dutch', label: 'Dutch required', severity: 'block', evidence: 'Fluent Dutch and English are required for this role.' }]);
  });

  it.each([
    'You speak Swedish fluently.',
    'Requirements: Swedish (C1) and English.',
    'Professional proficiency in Swedish is a must.',
    'Flytande svenska i tal och skrift.',
  ])('treats %j as required', (sentence) => {
    expect(ids(redFlags(sentence))).toEqual(['language-swedish']);
  });

  it.each([
    'Dutch is a plus.',
    'English is required, Dutch is a nice-to-have.',
    'Knowledge of Dutch is an advantage but not required.',
    'Dutch, or willingness to learn it.',
  ])('treats %j as optional', (sentence) => {
    const flags = redFlags(sentence);
    expect(flags.map((f) => [f.id, f.severity])).toEqual([['language-dutch-optional', 'info']]);
  });

  it('ignores a mere mention and languages you speak', () => {
    expect(redFlags('Our Dutch office is in Utrecht. We serve the German market.')).toEqual([]);
    expect(redFlags('Fluent Dutch required.', { languages: ['English', 'Dutch'] })).toEqual([]);
    expect(redFlags('Excellent English is required.')).toEqual([]);
  });

  it('notices an ad written in another language', () => {
    const dutch =
      'Wij zijn op zoek naar een ontwikkelaar die met ons team aan de software van de toekomst wil bouwen. Je werkt met een team van tien mensen aan het platform en je bent verantwoordelijk voor de kwaliteit van de code. Wat wij bieden: een goed salaris, ruimte voor groei en een fijne werkplek in het centrum van de stad.';
    expect(detectAdLanguage(dutch)).toBe('Dutch');
    expect(ids(redFlags(dutch))).toContain('ad-language-dutch');
    expect(detectAdLanguage('Short text.')).toBeNull();
    expect(detectAdLanguage('We are looking for a developer to join our team and build the future of logistics software with us. You will work with a team of ten people on the platform and you are responsible for the quality of the code that we ship to our customers every week.')).toBe('English');
  });
});

describe('redFlags: experience and seniority', () => {
  it('blocks at the configured number of years and warns just below it', () => {
    expect(redFlags('You have 5+ years of experience with Python.').map((f) => [f.id, f.severity, f.label])).toEqual([['years', 'block', '5+ years of experience asked']]);
    expect(redFlags('At least 3 years of professional experience.').map((f) => f.severity)).toEqual(['warn']);
    expect(redFlags('1-2 years of experience is enough.')).toEqual([]);
    expect(redFlags('3-5 years experience in a similar role.', { maxYears: 3 })[0]).toMatchObject({ severity: 'block' });
  });

  it('reports the highest requirement and ignores the age of the company', () => {
    expect(redFlags('2 years of experience with React.\n8+ years of experience in backend development.')[0]!.label).toBe('8+ years of experience asked');
    expect(redFlags('For over 20 years we have built ships.')).toEqual([]);
  });

  it('flags senior titles and senior wording', () => {
    expect(redFlags({ title: 'Senior Backend Engineer', text: 'Join us.' })[0]).toMatchObject({ id: 'seniority', severity: 'warn', evidence: 'Senior Backend Engineer' });
    expect(ids(redFlags({ title: 'Backend Engineer', text: 'We are looking for a senior engineer to lead the team.' }))).toEqual(['seniority']);
    expect(redFlags({ title: 'Backend Engineer', text: 'You will work with senior engineers.' })).toEqual([]);
    expect(redFlags({ title: 'Lead Developer', text: '' }, { flagSeniority: false })).toEqual([]);
  });

  it('flags internships', () => {
    expect(ids(redFlags({ title: 'Software Engineering Intern', text: 'Great team.' }))).toEqual(['internship']);
    expect(ids(redFlags({ title: 'AI project', text: 'This is a 6-month internship. You must be enrolled at a university.' }))).toEqual(['internship']);
    expect(redFlags({ title: 'Software Engineer', text: 'We also offer internships in summer.' })).toEqual([]);
  });
});

describe('redFlags: stack and location', () => {
  it('flags a stack only when the role is built around it', () => {
    const heavy = redFlags('Our backend is Java and Spring. You write Java services every day. Some Python scripts.');
    expect(heavy.map((f) => [f.id, f.label])).toEqual([['stack-java', 'Java-heavy stack (2 mentions)']]);
    expect(redFlags('Python backend. Nice to have: Java.')).toEqual([]);
    expect(redFlags('We use JavaScript and JavaScript only.')).toEqual([]); // JavaScript is not Java
  });

  it('matches stacks with symbols and titles', () => {
    expect(ids(redFlags({ title: '.NET Developer', text: 'Join us.' }))).toEqual(['stack-.net']);
    expect(ids(redFlags('C# and more C# with ASP.NET.'))).toEqual(['stack-c#']);
    expect(ids(redFlags('TypeScript, TypeScript, TypeScript.', { avoidStacks: ['TypeScript'] }))).toEqual(['stack-typescript']);
  });

  it('flags location knock-outs', () => {
    expect(redFlags('You must be based in Sweden to apply.')[0]).toMatchObject({ id: 'location', label: 'Must already be based in Sweden', severity: 'block' });
    expect(ids(redFlags('We only consider candidates currently living in the Netherlands.'))).toEqual(['location']);
    expect(ids(redFlags('Unfortunately we cannot offer relocation for this position.'))).toEqual(['relocation']);
    expect(redFlags('You must be based in Sweden.', { basedIn: ['Sweden'] })).toEqual([]);
    expect(redFlags('Our team is based in Stockholm.')).toEqual([]);
  });

  it('notes missing visa sponsorship as information only', () => {
    expect(redFlags('We are unable to provide visa sponsorship.')).toEqual([expect.objectContaining({ id: 'sponsorship', severity: 'info' })]);
  });
});

describe('redFlags: whole ads', () => {
  it('orders flags by severity and reports each kind once', () => {
    const flags = redFlags({
      title: 'Senior Java Developer',
      text: 'We need 6+ years of experience with Java. Fluent Swedish is required. Java, Java, Java. German is a plus. You must be based in Sweden.',
    });
    expect(flags.map((f) => f.severity)).toEqual(['block', 'block', 'block', 'warn', 'warn', 'info']);
    expect(new Set(ids(flags)).size).toBe(flags.length);
  });

  it('returns nothing for a clean ad or empty text', () => {
    expect(redFlags({ title: 'Python Developer', text: 'We welcome junior and mid-level engineers. English is our working language. Hybrid in Utrecht.' })).toEqual([]);
    expect(redFlags('')).toEqual([]);
  });

  it('splits ads into sentences and list items', () => {
    expect(adSentences('Intro line.\n• First point\n- Second point. Third sentence!')).toEqual(['Intro line.', 'First point', 'Second point.', 'Third sentence!']);
  });
});
