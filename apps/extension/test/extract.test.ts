import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { redFlags } from '@jobpilot/shared';
import { detectSite, extractPosting, looksLikePosting } from '../src/extract';

const doc = (html: string): Document => new JSDOM(html).window.document;

const DESCRIPTION =
  '<p>We are looking for a senior engineer to own our billing platform.</p><ul><li>6+ years of experience with Java</li><li>Fluent Swedish is required</li></ul><p>You must be based in Sweden. Java services, Java tooling.</p>';

const jsonLd = (extra: object = {}) =>
  `<script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'JobPosting',
    title: 'Backend Engineer',
    hiringOrganization: { '@type': 'Organization', name: 'Polder Systems B.V.' },
    jobLocation: { '@type': 'Place', address: { addressLocality: 'Amsterdam', addressCountry: 'NL' } },
    description: DESCRIPTION,
    ...extra,
  })}</script>`;

describe('detectSite and looksLikePosting', () => {
  it.each([
    ['https://www.linkedin.com/jobs/view/4490011223/', 'linkedin', true],
    ['https://www.linkedin.com/jobs/search/?currentJobId=4490011223&keywords=python', 'linkedin', true],
    ['https://www.linkedin.com/jobs/search/?keywords=python', 'linkedin', false],
    ['https://northlight.teamtailor.com/jobs/8801123-software-engineer', 'teamtailor', true],
    ['https://northlight.teamtailor.com/', 'teamtailor', false],
    ['https://acme.wd3.myworkdayjobs.com/en-US/External/job/Veghel/Controls-Engineer_JR33001', 'workday', true],
    ['https://job-boards.greenhouse.io/poldersystems/jobs/6237000111', 'greenhouse', true],
    ['https://jobs.lever.co/aurorapay/1b2c3d4e-0000-4a30-ad85-a04348100001', 'lever', true],
    ['https://jobs.lever.co/aurorapay', 'lever', false],
    ['https://jobs.ashbyhq.com/quillstack/a4e39bdc-0000-43ea-8077-a113445e0001', 'ashby', true],
    ['https://example.com/careers/123', 'other', false],
    ['not a url', 'other', false],
  ])('%s -> %s, posting: %s', (url, site, posting) => {
    expect(detectSite(url)).toBe(site);
    expect(looksLikePosting(url)).toBe(posting);
  });
});

describe('extractPosting', () => {
  it('prefers schema.org JSON-LD', () => {
    const posting = extractPosting(doc(`<html><head>${jsonLd()}</head><body><h1>Something else</h1></body></html>`), 'https://job-boards.greenhouse.io/poldersystems/jobs/6237000111#app');
    expect(posting).toMatchObject({
      site: 'greenhouse',
      title: 'Backend Engineer',
      company: 'Polder Systems B.V.',
      location: 'Amsterdam, NL',
      url: 'https://job-boards.greenhouse.io/poldersystems/jobs/6237000111',
    });
    expect(posting!.text).toContain('Fluent Swedish is required');
    expect(posting!.text).not.toContain('<li>');
  });

  it('reads JSON-LD inside an @graph and remote postings', () => {
    const html = `<script type="application/ld+json">${JSON.stringify({ '@graph': [{ '@type': 'WebSite' }, { '@type': 'JobPosting', title: 'Data Engineer', hiringOrganization: 'Tulip Analytics', jobLocationType: 'TELECOMMUTE', description: 'x' }] })}</script>`;
    expect(extractPosting(doc(html), 'https://jobs.ashbyhq.com/tulip/a4e39bdc-0000-43ea-8077-a113445e0001')).toMatchObject({ title: 'Data Engineer', company: 'Tulip Analytics', location: 'Remote' });
  });

  it('falls back to site selectors and the URL when there is no JSON-LD', () => {
    const html = `<html><head><title>Machine Learning Engineer - Fjordbyte</title></head><body><h1>Machine Learning Engineer</h1><main><section>${'Build ranking models with Python. '.repeat(12)}</section></main></body></html>`;
    const posting = extractPosting(doc(html), 'https://fjordbyte.teamtailor.com/jobs/8683001-machine-learning-engineer');
    expect(posting).toMatchObject({ site: 'teamtailor', title: 'Machine Learning Engineer', company: 'Fjordbyte' });
    expect(posting!.text.length).toBeGreaterThan(200);
  });

  it('reads LinkedIn public pages from the title tag', () => {
    const html = '<html><head><meta property="og:title" content="Hexa Staffing hiring Software Engineer in Stockholm | LinkedIn"></head><body><div class="show-more-less-html__markup">Great role.</div></body></html>';
    expect(extractPosting(doc(html), 'https://www.linkedin.com/jobs/view/4487000111/')).toMatchObject({ site: 'linkedin', company: 'Hexa Staffing', title: 'Software Engineer' });
  });

  it('survives broken JSON-LD and unknown pages', () => {
    expect(extractPosting(doc('<script type="application/ld+json">{ not json</script><h1>Role</h1>'), 'https://jobs.lever.co/acme/1b2c3d4e-0000-4a30-ad85-a04348100001')).toMatchObject({ title: 'Role', company: 'Acme' });
    expect(extractPosting(doc('<h1>Welcome</h1>'), 'https://example.com/')).toBeNull();
    expect(extractPosting(doc(''), 'https://jobs.lever.co/acme/1b2c3d4e-0000-4a30-ad85-a04348100001')).toBeNull();
  });

  it('feeds the red-flag rules end to end', () => {
    const posting = extractPosting(doc(jsonLd({ title: 'Senior Backend Engineer' })), 'https://job-boards.greenhouse.io/x/jobs/1234567')!;
    const flags = redFlags({ title: posting.title, text: posting.text });
    expect(flags.map((f) => f.id)).toEqual(['language-swedish', 'years', 'location', 'seniority', 'stack-java']);
  });
});
