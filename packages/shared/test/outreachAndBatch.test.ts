import { describe, expect, it } from 'vitest';
import { BatchSchema, OutreachLogSchema, batchDateFromFile, connectionStatus, hasReply, parseBatch, parseOutreachLog, summariseBatch } from '../src';
import { loadSample } from './helpers';

describe('sample outreach log', () => {
  const { outreach } = loadSample();

  it('matches the schema', () => {
    expect(() => OutreachLogSchema.parse(outreach)).not.toThrow();
  });

  it('separates messages from connection requests', () => {
    expect(outreach.messages).toHaveLength(6);
    expect(outreach.connections).toHaveLength(8);
  });

  it('reads a message with the person, role and reply state', () => {
    const lars = outreach.messages.find((m) => m.person === 'Lars Nyberg');
    expect(lars).toMatchObject({ personRole: 'Hiring Manager', company: 'Aurora Pay', companyKey: 'aurora pay', replied: true });
    expect(lars!.date.iso).toBe('2026-11-12');
    expect(outreach.messages.find((m) => m.person === 'Karin Holm')).toMatchObject({ company: 'Hexa Staffing', replied: false });
  });

  it('reads connection status and profile links', () => {
    const byPerson = Object.fromEntries(outreach.connections.map((c) => [c.person, c]));
    expect(byPerson['Elin Sandberg']).toMatchObject({ status: 'pending', company: 'Northlight Robotics', profileUrl: 'https://linkedin.com/in/elin-sandberg-example/' });
    expect(byPerson['Radu Ionescu']!.status).toBe('accepted');
    expect(byPerson['Mihai Popa']!.status).toBe('withdrawn');
    expect(byPerson['Freja Åkesson']!.sent.iso).toBe('2026-10-20');
  });

  it('keeps bullet-only sections as notes', () => {
    expect(outreach.notes.map((n) => n.heading)).toEqual(['Waiting on a reply / do not chase', 'Do not contact']);
  });
});

describe('outreach helpers', () => {
  it.each([
    ['Pending (blank connect, no note)', 'pending'],
    ['Accepted (30 Oct). No message', 'accepted'],
    ['Accepted - message sent 30 Oct', 'accepted'],
    ['Withdrawn 2 Nov', 'withdrawn'],
    ['Declined', 'declined'],
    ['Pending. If he accepts: draft a note', 'pending'],
    ['???', 'unknown'],
  ])('status %j -> %s', (text, status) => {
    expect(connectionStatus(text)).toBe(status);
  });

  it.each([
    ['Sent 17:43. Waiting', false],
    ['Sent ~16:30. **Replied 2 Nov 18:28**: next round', true],
    ['Sent 16:24. Waiting for reply', false],
    ['No personal reply; rejected 3 Nov', false],
    ['He called; meeting held 28 Oct', true],
  ])('reply in %j -> %s', (text, replied) => {
    expect(hasReply(text)).toBe(replied);
  });

  it('never throws on a malformed file', () => {
    const log = parseOutreachLog('## Messages\n\n| Foo |\n|---|\n| x |\n\n## Connection requests\n\n| Sent | Person |\n|---|---|\n| soon | Ana |\n');
    expect(log.messages).toEqual([]);
    expect(log.connections[0]).toMatchObject({ person: 'Ana', status: 'unknown' });
    expect(log.warnings[0]!.message).toMatch(/no Person or Date column/);
  });
});

describe('daily batches', () => {
  const { batches } = loadSample();
  const today = batches.find((b) => b.date === '2026-11-15')!;

  it('matches the schema', () => {
    for (const batch of batches) expect(() => BatchSchema.parse(batch)).not.toThrow();
  });

  it('reads the date from the file name and the title from the first heading', () => {
    expect(batchDateFromFile('batch_2026-11-15.md')).toBe('2026-11-15');
    expect(batchDateFromFile('notes.md')).toBeNull();
    expect(today.title).toBe('Daily batch, Sun 15 Nov 2026');
  });

  it('reads the roles table', () => {
    expect(today.roles).toHaveLength(3);
    expect(today.roles[0]).toMatchObject({ index: '1', company: 'Tidewater Labs (ocean-data scale-up)', role: 'Python Engineer - Data Pipelines' });
    expect(today.roles[1]!.gap).toContain('Third Polder Systems application');
  });

  it('reads the "Needs" list as checkable items with stable ids', () => {
    expect(today.needs).toHaveLength(4);
    expect(today.needs[0]!.title).toMatch(/^Aurora Pay/);
    const again = parseBatch(today.markdown, today.file);
    expect(again.needs.map((n) => n.id)).toEqual(today.needs.map((n) => n.id));
  });

  it('summarises a batch', () => {
    expect(summariseBatch(today)).toEqual({ date: '2026-11-15', file: 'batch_2026-11-15.md', title: 'Daily batch, Sun 15 Nov 2026', roleCount: 3, needsCount: 4 });
  });

  it('handles an older free-form batch without a roles table', () => {
    const batch = parseBatch('# Daily run - 21 Oct 2026\n\n## 1. Acme - Engineer - Oslo\ntext\n\n## Screened out 21 Oct\n- x\n', 'batch_2026-10-21.md');
    expect(batch).toMatchObject({ date: '2026-10-21', title: 'Daily run - 21 Oct 2026', roles: [], needs: [] });
    expect(batch.sections).toHaveLength(2);
  });
});
