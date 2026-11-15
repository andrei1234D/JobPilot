import { describe, expect, it } from 'vitest';
import {
  buildCompanyPage,
  buildToday,
  computeStats,
  daysToRejection,
  followUpSent,
  followUpsDue,
  followUpsUpcoming,
  hygieneIssues,
  isRepeat,
  jobIdsFromUrl,
  listCompanies,
  matchCompany,
  median,
  parseCompany,
  parseOutreachLog,
  queryTerms,
  search,
  staleConnects,
  type Dataset,
} from '../src';
import { TODAY, app, loadSample } from './helpers';

const sample = loadSample();
const apps = sample.applications.applications;
const outreach = sample.outreach;
const dataset: Dataset = { applications: apps, needs: sample.applications.needs, outreach, batches: sample.batches, shortlist: [] };

describe('followUpsDue', () => {
  it('lists exactly the applications whose window is open today', () => {
    const due = followUpsDue(apps, TODAY, outreach);
    expect(due.map((f) => [f.application.company, f.contact.name, f.daysSinceApplied, f.windowDaysLeft])).toEqual([
      ['Hexa Staffing', 'Karin Holm', 10, 0],
      ['Lumen Freight', 'Tobias Ek', 9, 1],
      ['Fjordbyte', 'Maja Lindqvist', 8, 2],
    ]);
  });

  it('moves with the calendar', () => {
    expect(followUpsDue(apps, '2026-11-14', outreach).map((f) => f.application.company)).toEqual(['Hexa Staffing', 'Lumen Freight']);
    expect(followUpsDue(apps, '2026-11-18', outreach).map((f) => f.application.company)).toEqual(['Kanaal Software']);
    expect(followUpsDue(apps, '2026-12-25', outreach)).toEqual([]);
  });

  const row = { applied: '5 Nov 2026', history: 'Submitted 5 Nov. Recruiter Ana Pop (Talent Partner) is named in the ad' };

  it('needs a named contact', () => {
    expect(followUpsDue([app(row)], '2026-11-13')).toHaveLength(1);
    expect(followUpsDue([app({ ...row, history: 'Submitted 5 Nov' })], '2026-11-13')).toEqual([]);
    expect(followUpsDue([app({ ...row, channel: 'Email to careers@acme.example', history: 'Sent 5 Nov' })], '2026-11-13')).toEqual([]);
  });

  it('respects the window edges (8 to 10 days)', () => {
    const days = (today: string) => followUpsDue([app(row)], today).length;
    expect([days('2026-11-12'), days('2026-11-13'), days('2026-11-15'), days('2026-11-16')]).toEqual([0, 1, 1, 0]);
  });

  it('skips applications that already got an answer', () => {
    for (const history of ['Rejected 9 Nov', '8 Nov: Ana Pop (Recruiter) replied', 'phone screen with Ana Pop (Recruiter) on 10 Nov']) {
      expect(followUpsDue([app({ ...row, history: `${row.history}; ${history}` })], '2026-11-13')).toEqual([]);
    }
  });

  it('never proposes a second follow-up', () => {
    const sent = app({ ...row, history: `${row.history}; follow-up sent 13 Nov` });
    expect(followUpSent(sent)).toBe(true);
    expect(followUpsDue([sent], '2026-11-14')).toEqual([]);
  });

  it('counts a later message to the company as the follow-up, but not the introduction', () => {
    const application = app({ ...row, company: 'Acme' });
    const log = (date: string) => parseOutreachLog(`## Messages\n\n| Date | Person | Company | Channel | Status |\n|---|---|---|---|---|\n| ${date} | Ana Pop | Acme BV | InMail | Sent |\n`, { referenceYear: 2026 });
    expect(followUpsDue([application], '2026-11-13', log('5 Nov 2026'))).toHaveLength(1);
    expect(followUpsDue([application], '2026-11-13', log('12 Nov 2026'))).toEqual([]);
  });

  it('takes the contact from the outreach log when the row names nobody', () => {
    const application = app({ applied: '5 Nov 2026', company: 'Acme', history: 'Submitted 5 Nov' });
    const log = parseOutreachLog('## Connection requests\n\n| Sent | Person | Company / why | Profile | Status |\n|---|---|---|---|---|\n| 5 Nov 2026 | Ana Pop | Acme (recruiter) | x.example/ana | Pending |\n', { referenceYear: 2026 });
    expect(followUpsDue([application], '2026-11-13', log)[0]!.contact).toMatchObject({ name: 'Ana Pop', source: 'outreach' });
  });

  it('ignores approximate dates and other sections', () => {
    expect(followUpsDue([app({ ...row, applied: '~Nov 2026' }), app({ ...row, applied: 'by 5 Nov 2026' }), app(row, 'Rejected')], '2026-11-13')).toEqual([]);
  });

  it('honours a custom window', () => {
    expect(followUpsDue([app(row)], '2026-11-08', undefined, { minDays: 3, maxDays: 5 })).toHaveLength(1);
  });
});

describe('followUpsUpcoming', () => {
  it('lists windows that open in the next days, soonest first', () => {
    const upcoming = followUpsUpcoming(apps, TODAY, outreach);
    expect(upcoming.map((f) => [f.application.company, f.windowDaysLeft])).toEqual([['Kanaal Software', -3]]);
    expect(followUpsUpcoming(apps, TODAY, outreach, undefined, 7).map((f) => f.application.company)).toEqual(['Kanaal Software', 'Northlight Robotics']);
  });
});

describe('staleConnects', () => {
  it('lists pending requests older than 14 days, oldest first', () => {
    expect(staleConnects(outreach.connections, TODAY).map((s) => [s.connection.person, s.daysPending])).toEqual([
      ['Freja Åkesson', 26],
      ['Daan Visser', 18],
      ['Ioana Marinescu', 15],
    ]);
  });
  it('uses a strict "older than" threshold and ignores accepted or withdrawn requests', () => {
    expect(staleConnects(outreach.connections, '2026-11-14').map((s) => s.connection.person)).toEqual(['Freja Åkesson', 'Daan Visser']);
    expect(staleConnects(outreach.connections, TODAY, 30)).toEqual([]);
  });
});

describe('hygieneIssues', () => {
  it('finds rows whose text and section disagree', () => {
    const issues = hygieneIssues(apps, TODAY).map((i) => [i.company, i.message]);
    expect(issues).toEqual([
      ['Carpathia Soft', 'Says "rejected" but sits under "Waiting for a reply (applied in October and November)"'],
      ['Windmolen AI', 'Waiting for 34 days with no news: move to "No reply"?'],
    ]);
  });
  it('flags an exact duplicate row', () => {
    const a = app({ company: 'Acme', role: 'Dev' });
    const b = { ...app({ company: 'Acme', role: 'Dev' }), id: 'other', line: 99 };
    expect(hygieneIssues([a, b], '2026-11-06').map((i) => i.message)).toEqual([`Looks like a duplicate of line ${a.line}`]);
  });
});

describe('company matching', () => {
  it('normalises names', () => {
    expect(parseCompany('KVD (Kanaal Venture Digital)')).toMatchObject({ name: 'KVD', key: 'kvd', aliases: ['kanaal venture digital'] });
    expect(parseCompany('Acme Group B.V.').key).toBe('acme');
    expect(parseCompany('Östra Mobility AB').key).toBe('ostra mobility');
    expect(parseCompany('The Loft / Annex9').aliases).toEqual(['loft', 'annex9']);
    expect(parseCompany('Orbital Parcel (ex-Northwind warehousing)').aliases).toEqual(['northwind warehousing']);
  });

  it.each([
    ['KVD', 'KVD (Kanaal Venture Digital)', 'exact'],
    ['Kanaal Venture Digital', 'KVD (Kanaal Venture Digital)', 'alias'],
    ['Polder Systems B.V.', 'Polder Systems', 'exact'],
    ['Acme', 'Acme Robotics', 'tokens'],
    ['Fjordbyte', 'Fjord Byte', 'fuzzy'],
    ['Meridian Helth Tech', 'Meridian Health Tech', 'fuzzy'],
    ['Annex9', 'The Loft / Annex9', 'alias'],
  ])('%s matches %s (%s)', (a, b, reason) => {
    expect(matchCompany(a, b)?.reason).toBe(reason);
  });

  it.each([
    ['Acme', 'Acne Studios'],
    ['Northlight', 'Northwind'],
    ['Polder Systems', 'Kanaal Software'],
    ['', 'Acme'],
  ])('%j does not match %j', (a, b) => {
    expect(matchCompany(a, b)).toBeNull();
  });

  it('reads job ids from posting URLs', () => {
    expect(jobIdsFromUrl('https://www.linkedin.com/jobs/view/4490011223/?refId=abc')).toEqual(['4490011223']);
    expect(jobIdsFromUrl('https://www.linkedin.com/jobs/search/?currentJobId=4490011223&keywords=python')).toEqual(['4490011223']);
    expect(jobIdsFromUrl('https://job-boards.greenhouse.io/poldersystems/jobs/6237000111')).toEqual(['6237000111']);
    expect(jobIdsFromUrl('https://jobs.lever.co/aurorapay/1B2C3D4E-0000-4a30-ad85-a04348100001/apply')).toEqual(['1b2c3d4e-0000-4a30-ad85-a04348100001']);
    expect(jobIdsFromUrl('https://example.com/about')).toEqual([]);
  });
});

describe('isRepeat', () => {
  it('finds every earlier application to a company, newest first', () => {
    const matches = isRepeat('Polder Systems B.V.', apps);
    expect(matches.map((m) => [m.application.role, m.application.status])).toEqual([
      ['Backend Engineer', 'waiting'],
      ['Software Test Engineer - Motion Control', 'rejected'],
    ]);
  });
  it('includes "not applied" decisions', () => {
    expect(isRepeat('Kanaal Venture Digital', apps).map((m) => m.application.status).sort()).toEqual(['not_applied', 'rejected']);
  });
  it('recognises the exact posting by its job id, whatever the page calls the company', () => {
    const matches = isRepeat('Northlight', apps, 'https://www.linkedin.com/jobs/view/4490011223/');
    expect(matches[0]).toMatchObject({ reason: 'job_id', score: 1 });
    expect(isRepeat('', apps, 'https://jobs.lever.co/aurorapay/1b2c3d4e-0000-4a30-ad85-a04348100001')[0]!.application.company).toBe('Aurora Pay');
  });
  it('returns nothing for a new company', () => {
    expect(isRepeat('Tidewater Labs', apps)).toEqual([]);
  });
});

describe('computeStats', () => {
  const stats = computeStats(apps);

  it('counts applications, not "not applied" decisions', () => {
    expect(stats.total).toBe(36);
    expect(stats.byRegion.reduce((n, g) => n + g.total, 0)).toBe(36);
    expect(stats.byChannel.reduce((n, g) => n + g.total, 0)).toBe(36);
  });

  it('computes response rate and time to rejection', () => {
    // 12 rejected + Skerry (interview) + Aurora Pay (reply) + Carpathia (rejected, still under Waiting) + Tulip 2024 (archived, rejected)
    expect(stats.responded).toBe(16);
    expect(stats.responseRate).toBeCloseTo(16 / 36);
    expect(stats.medianDaysToRejection).toBe(14);
  });

  it('groups by region with readable labels', () => {
    const sweden = stats.byRegion.find((g) => g.key === 'SE')!;
    expect(sweden.label).toBe('Sweden');
    expect(sweden.total).toBeGreaterThan(8);
    expect(sweden.responseRate).toBeGreaterThan(0);
    expect(stats.byRegion.map((g) => g.key)).toEqual(expect.arrayContaining(['NL', 'SE', 'RO', 'REMOTE']));
  });

  it('builds a zero-filled weekly series', () => {
    expect(stats.perWeek.at(-1)).toEqual({ week: '2026-11-09', applications: 2, rejections: 4 });
    const weeks = stats.perWeek.map((w) => w.week);
    expect(weeks).toEqual([...weeks].sort());
    expect(stats.perWeek.length).toBeLessThanOrEqual(26);
    // The 2024 rows fall outside the window, and the series starts at the first week with data.
    expect(stats.perWeek[0]).toEqual({ week: '2026-07-27', applications: 0, rejections: 1 });
  });

  it('measures days to rejection only from exact dates', () => {
    expect(daysToRejection(app({ applied: '1 Nov 2026', history: 'Rejected 9 Nov' }))).toBe(8);
    expect(daysToRejection(app({ applied: '~Nov 2026', history: 'Rejected 9 Nov' }))).toBeNull();
    expect(daysToRejection(app({ applied: '1 Nov 2026', history: 'Rejected' }))).toBeNull();
    expect(median([])).toBeNull();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
  });

  it('handles an empty log', () => {
    expect(computeStats([])).toMatchObject({ total: 0, responseRate: null, perWeek: [], byRegion: [] });
  });
});

describe('search', () => {
  const corpus = { applications: apps, messages: outreach.messages, connections: outreach.connections, batches: sample.batches, needs: sample.applications.needs };

  it('parses quoted phrases', () => {
    expect(queryTerms('Teamtailor "No Reply"  Östra')).toEqual(['teamtailor', 'no reply', 'ostra']);
  });

  it('answers "has this company ever replied?" across all logs', () => {
    const hits = search(corpus, 'aurora pay');
    expect(new Set(hits.map((h) => h.type))).toEqual(new Set(['application', 'message', 'batch', 'needs']));
    expect(hits[0]!.type).toBe('application');
  });

  it('requires every term and ignores accents and case', () => {
    const both = search(corpus, 'teamtailor fjordbyte');
    expect(both[0]!.title).toContain('Fjordbyte');
    expect(both.length).toBeGreaterThan(0);
    expect(both.length).toBeLessThan(search(corpus, 'fjordbyte').length);
    expect(search(corpus, 'TEAMTAILOR FJORDBYTE')).toEqual(both);
    expect(search(corpus, 'ostra mobility').length).toBeGreaterThan(0);
    expect(search(corpus, 'fjordbyte zzzz')).toEqual([]);
    expect(search(corpus, '   ')).toEqual([]);
  });

  it('returns a snippet around the match', () => {
    const [hit] = search(corpus, '"does not support relocation"');
    expect(hit!.snippet).toContain('does not support relocation');
  });
});

describe('views', () => {
  it('builds the Today panel', () => {
    const today = buildToday(dataset, TODAY, { followUpMinDays: 8, followUpMaxDays: 10, staleConnectDays: 14 }, { demo: true, checked: ['x'] });
    expect(today).toMatchObject({ today: TODAY, demo: true, checked: ['x'] });
    expect(today.followUpsDue).toHaveLength(3);
    expect(today.staleConnects).toHaveLength(3);
    expect(today.needs).toHaveLength(4);
    expect(today.batch?.date).toBe(TODAY);
    expect(today.counts).toMatchObject({ waiting: 14, rejected: 12, interview: 1, offer: 0 });
  });

  it('falls back to the latest batch when today has none', () => {
    const today = buildToday(dataset, '2026-11-20', { followUpMinDays: 8, followUpMaxDays: 10, staleConnectDays: 14 }, { demo: false, checked: [] });
    expect(today.batch?.date).toBe('2026-11-15');
  });

  it('lists companies with their application counts', () => {
    const companies = listCompanies(apps);
    expect(companies.find((c) => c.key === 'polder systems')).toMatchObject({ applications: 2, lastApplied: '2026-11-05' });
    expect(companies[0]!.lastApplied).toBe('2026-11-13');
  });

  it('gathers everything about one company', () => {
    const page = buildCompanyPage(dataset, 'skerry labs')!;
    expect(page.name).toBe('Skerry Labs');
    expect(page.applications.map((a) => a.status)).toEqual(['not_applied', 'interview']);
    expect(page.messages.map((m) => m.person)).toEqual(['Petra Dahl']);
    expect(page.batchMentions.map((m) => m.date)).toEqual(['2026-11-14']);
    expect(buildCompanyPage(dataset, 'Fjordbyte AB')!.connections.map((c) => c.person)).toEqual(['Maja Lindqvist']);
    expect(buildCompanyPage(dataset, 'No Such Company')).toBeNull();
  });
});
