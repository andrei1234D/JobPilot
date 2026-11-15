import { describe, expect, it } from 'vitest';
import { ApplicationsLogSchema, classifyChannel, classifyRegion, extractContacts, extractCvVariant, extractEvents, parseApplicationsLog, sectionKind } from '../src';
import { app, loadSample } from './helpers';

describe('sectionKind', () => {
  it.each([
    ['1. Needs Sam', 'needs'],
    ['2. Interviews and tests (active)', 'interview'],
    ['3. Waiting for a reply (applied in October)', 'waiting'],
    ['4. No reply for 4+ weeks (applied before October, probably closed)', 'no_reply'],
    ['5. Rejected (54)', 'rejected'],
    ['6. Not applied (his decision, blocked, or removed)', 'not_applied'],
    ['7. Old (2024)', 'archived'],
    ['Offers', 'offer'],
    ['Random thoughts', 'unknown'],
  ])('%s -> %s', (heading, kind) => {
    expect(sectionKind(heading)).toBe(kind);
  });
});

describe('sample applications log', () => {
  const { applications: log } = loadSample();
  const find = (company: string, role?: string) => log.applications.filter((a) => a.company === company && (!role || a.role.startsWith(role)));

  it('matches the schema and produces no parser crash', () => {
    expect(() => ApplicationsLogSchema.parse(log)).not.toThrow();
    expect(log.warnings.filter((w) => w.message.startsWith('Row could not be read'))).toEqual([]);
  });

  it('reads every section', () => {
    const count = (status: string) => log.applications.filter((a) => a.status === status).length;
    expect({ interview: count('interview'), waiting: count('waiting'), noReply: count('no_reply'), rejected: count('rejected'), notApplied: count('not_applied'), archived: count('archived') }).toEqual({
      interview: 1,
      waiting: 14,
      noReply: 7,
      rejected: 12,
      notApplied: 5,
      archived: 2,
    });
    expect(log.applications).toHaveLength(41);
  });

  it('gives every row a unique id', () => {
    const ids = log.applications.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('splits company and role notes', () => {
    const [northlight] = find('Northlight Robotics');
    expect(northlight).toMatchObject({
      companyNote: 'warehouse robots, 120 people',
      companyKey: 'northlight robotics',
      role: 'Software Engineer - Perception Tooling',
      roleNote: 'Teamtailor 8801123, LinkedIn 4490011223',
      region: 'SE',
      channel: 'teamtailor',
      cvVariant: 'Full-Stack SE',
    });
    expect(northlight!.jobIds).toEqual(expect.arrayContaining(['8801123', '4490011223']));
  });

  it('keeps the text after an unescaped pipe and reports it', () => {
    const [polder] = find('Polder Systems', 'Backend Engineer');
    expect(polder!.history).toContain('Backend Engineer at Polder Systems | REQ-2291');
    expect(polder!.warnings.join(' ')).toMatch(/cells for 6 columns/);
  });

  it('reads the needs list with nested bullets and wrapped lines', () => {
    expect(log.needs).toHaveLength(4);
    expect(log.needs[1]!.title).toMatch(/^Two roles need an account/);
    expect(log.needs[1]!.markdown).toContain('  - **Brightwave Energy, Platform Engineer:**');
    expect(log.needs[2]!.title).toMatch(/Check it once a week, or forward it\.$/);
    expect(new Set(log.needs.map((n) => n.id)).size).toBe(4);
  });

  it('handles approximate, bounded and unknown dates', () => {
    expect(find('Glacier Games', 'Gameplay')[0]!.applied).toMatchObject({ iso: '2026-09-01', precision: 'month', approximate: true });
    expect(find('Kanaal Software', 'Full Stack')[0]!.applied).toMatchObject({ iso: '2026-09-25', precision: 'day', approximate: true });
    expect(find('Brightwave Energy', 'JavaScript')[0]!.applied).toMatchObject({ iso: null, precision: 'unknown' });
  });

  it('reads the four-column "not applied" table', () => {
    const [kvd] = log.applications.filter((a) => a.status === 'not_applied');
    expect(kvd).toMatchObject({ company: 'KVD', companyNote: 'Kanaal Venture Digital', role: 'Automation Engineer', location: '', region: 'NL', history: 'Sam: no (13 Nov)' });
    expect(kvd!.applied.iso).toBe('2026-11-13');
  });

  it('keeps repeated companies as separate applications', () => {
    expect(find('Fjordbyte').map((a) => a.status).sort()).toEqual(['rejected', 'waiting']);
    expect(find('Stadsbyte')).toHaveLength(2);
  });

  it('extracts dated events and the last one', () => {
    const [marlin] = find('Marlin Insurance Tech');
    expect(marlin!.lastEvent).toMatchObject({ kind: 'rejected', date: '2026-11-03', time: '20:19' });
    const [skerry] = find('Skerry Labs', 'Full-Stack');
    expect(skerry!.events.filter((e) => e.kind === 'interview').map((e) => e.date)).toEqual(['2026-10-29', '2026-11-10']);
    const [vattenkraft] = find('Vattenkraft Data');
    expect(vattenkraft!.events.map((e) => e.kind)).toEqual(['submitted', 'interview', 'rejected']);
  });

  it('does not turn a note about an earlier application into an outcome', () => {
    const [quillstack] = find('Quillstack');
    expect(quillstack!.events.some((e) => e.kind === 'rejected')).toBe(false);
  });

  it('finds the people named in a row', () => {
    expect(find('Fjordbyte', 'Machine')[0]!.contacts).toEqual([{ name: 'Maja Lindqvist', role: 'Talent Acquisition Partner', email: null, named: true, source: 'application' }].map((c) => expect.objectContaining({ name: c.name, named: true })));
    expect(find('Lumen Freight')[0]!.contacts[0]).toMatchObject({ name: 'Tobias Ek', role: 'Senior Recruiter' });
    expect(find('Hexa Staffing', 'Software')[0]!.contacts[0]).toMatchObject({ name: 'Karin Holm', named: true });
    expect(find('Kestrel Logistics')[0]!.contacts[0]).toMatchObject({ email: 'mila.jansen@kestrel-logistics.example', named: true });
    expect(find('Stadsbyte', 'Software')[0]!.contacts[0]).toMatchObject({ email: 'careers@stadsbyte.example', named: false });
    expect(find('Polder Systems', 'Backend')[0]!.contacts).toEqual([]);
  });
});

describe('robustness', () => {
  it('returns empty results for an empty or unrelated file', () => {
    expect(parseApplicationsLog('').applications).toEqual([]);
    expect(parseApplicationsLog('just some text\n\nwith no structure').applications).toEqual([]);
  });

  it('skips a table without a company column and says so', () => {
    const log = parseApplicationsLog('## Waiting\n\n| Foo | Bar |\n|---|---|\n| 1 | 2 |\n');
    expect(log.applications).toEqual([]);
    expect(log.warnings[0]!.message).toMatch(/no Company column/);
  });

  it('shows rows of an unknown section instead of losing them', () => {
    const log = parseApplicationsLog('## Maybe later\n\n| Applied | Company | Role |\n|---|---|---|\n| 1 Nov 2026 | Acme | Dev |\n');
    expect(log.applications[0]).toMatchObject({ status: 'unknown', company: 'Acme', section: 'Maybe later' });
    expect(log.warnings.some((w) => /Unknown section/.test(w.message))).toBe(true);
  });

  it('survives rows with missing cells, odd dates and stray pipes', () => {
    const markdown = ['## Waiting', '', '| Applied | Company | Role | Location | CV / channel | What happened |', '|---|---|---|---|---|---|', '| sometime | Acme |', '| | | | | | |', '| 3 Nov 2026 | Beta | Dev | Oslo | Email | a | b | c |', '|||||||'].join('\n');
    const log = parseApplicationsLog(markdown, { referenceYear: 2026 });
    expect(log.applications).toHaveLength(4);
    expect(log.applications[0]).toMatchObject({ company: 'Acme', role: '' });
    expect(log.applications[0]!.warnings.join(' ')).toMatch(/Date "sometime" not understood/);
    expect(log.applications[2]!.history).toBe('a | b | c');
    expect(log.warnings.length).toBeGreaterThan(0);
  });

  it('accepts columns in a different order and with other names', () => {
    const log = parseApplicationsLog('## Pending\n\n| Company | Position | Date | Notes |\n|---|---|---|---|\n| Acme | Dev | 2026-11-01 | Rejected 5 Nov |\n');
    expect(log.applications[0]).toMatchObject({ company: 'Acme', role: 'Dev', status: 'waiting' });
    expect(log.applications[0]!.applied.iso).toBe('2026-11-01');
    expect(log.applications[0]!.lastEvent).toMatchObject({ kind: 'rejected', date: '2026-11-05' });
  });
});

describe('classifiers', () => {
  it.each([
    ['LinkedIn Easy Apply (CV Full-Stack NL)', 'easy_apply'],
    ['careers.acme.com Teamtailor guest form', 'teamtailor'],
    ['Workday, own account', 'workday'],
    ['Greenhouse job-boards.greenhouse.io/x/jobs/1', 'greenhouse'],
    ['Lever form', 'lever'],
    ['Ashby jobs.ashbyhq.com/x', 'ashby'],
    ['SuccessFactors (career74.sapsf.eu)', 'successfactors'],
    ['Email to hr@acme.example', 'email'],
    ['CV sent by LinkedIn InMail to the QA lead', 'inmail'],
    ['Homerun form', 'company_site'],
    ['LinkedIn', 'linkedin'],
    ['-', 'other'],
  ])('channel of %j is %s', (text, channel) => {
    expect(classifyChannel(text)).toBe(channel);
  });

  it.each([
    ['Stockholm, hybrid (3 office days)', 'SE'],
    ["'s-Hertogenbosch, hybrid", 'NL'],
    ['Brașov, on site', 'RO'],
    ['Remote EMEA', 'REMOTE'],
    ['Romania, remote', 'REMOTE'],
    ['Remote (Romania/Bulgaria/Poland)', 'REMOTE'],
    ['Stockholm (or London), hybrid', 'SE'],
    ['Utrecht (remote, ~1 office day/wk)', 'NL'],
    ['Atlantis', 'OTHER'],
    ['-', 'OTHER'],
  ])('region of %j is %s', (text, region) => {
    expect(classifyRegion(text)).toBe(region);
  });

  it.each([
    ['Teamtailor form: CV Full-Stack SE; cover letter', 'Full-Stack SE'],
    ['Workday (CV Automation NL, cover letter PDF)', 'Automation NL'],
    ['agent CV Automation Engineer RO, webmail', 'Automation RO'],
    ['Jobboard -> Greenhouse (NL CV)', 'NL'],
    ['Email', null],
  ])('CV variant of %j is %j', (text, variant) => {
    expect(extractCvVariant(text)).toBe(variant);
  });

  it('does not read "no reply yet" or "follow-up allowed from" as events', () => {
    expect(extractEvents('Viewed 29 Sep; no reply yet', '2026-09-28', 2026).map((e) => e.kind)).toEqual(['viewed']);
    expect(extractEvents('Follow-up allowed from ~23 Nov (rule c)', '2026-11-14', 2026).map((e) => e.kind)).toEqual(['note']);
    expect(extractEvents('follow-up sent 13 Nov to Sanne Vermeer', '2026-11-04', 2026).map((e) => e.kind)).toEqual(['follow_up']);
  });

  it('keeps an undated but decisive event', () => {
    expect(extractEvents('**Rejected**', null, 2026)).toEqual([{ date: null, time: null, kind: 'rejected', text: 'Rejected' }]);
  });

  it('does not mistake products or weekdays for people', () => {
    const contacts = extractContacts('LinkedIn Easy Apply (CV Full-Stack NL). Submitted from Yahoo Mail on Monday; Talent Acquisition (team inbox)');
    expect(contacts).toEqual([]);
  });

  it('builds a test row through the real parser', () => {
    expect(app({ company: 'Acme (robots)', history: 'Rejected 9 Nov' })).toMatchObject({ company: 'Acme', companyNote: 'robots', status: 'waiting' });
  });
});
