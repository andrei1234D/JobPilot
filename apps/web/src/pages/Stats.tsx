import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipProps } from 'recharts';
import { formatDay, type GroupStat, type Stats } from '@jobpilot/shared';
import { useStats } from '../api';
import { Card, Empty, Loading, PageHeader } from '../ui';

const percent = (value: number | null): string => (value === null ? '—' : `${Math.round(value * 100)}%`);
const days = (value: number | null): string => (value === null ? '—' : `${Number.isInteger(value) ? value : value.toFixed(1)} d`);
const shortWeek = (iso: string): string => formatDay(iso).replace(/ \d{4}$/, '');

function Tile({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface px-4 py-3">
      <p className="text-xs text-ink-2">{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight">{value}</p>
      <p className="mt-0.5 text-xs text-muted">{hint}</p>
    </div>
  );
}

function WeekTooltip({ active, payload, label }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-line bg-raised px-3 py-2 text-xs shadow-sm">
      <p className="mb-1 font-semibold text-ink">Week of {formatDay(String(label))}</p>
      {payload.map((entry) => (
        <p key={entry.dataKey} className="flex items-center gap-2 text-ink-2">
          <span className="h-2 w-2 rounded-sm" style={{ background: entry.color }} />
          {entry.name}
          <span className="ml-auto pl-4 font-semibold text-ink">{entry.value}</span>
        </p>
      ))}
    </div>
  );
}

function WeeklyChart({ perWeek }: { perWeek: Stats['perWeek'] }) {
  if (perWeek.length === 0) return <Empty>No dated applications yet.</Empty>;
  return (
    <div className="px-2 pb-2 pt-3">
      <div className="mb-1 flex items-center gap-4 px-2 text-xs text-ink-2">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: 'var(--series-1)' }} /> Applications sent
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: 'var(--series-2)' }} /> Rejections received
        </span>
      </div>
      <div className="h-64" role="img" aria-label="Applications sent and rejections received per week">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={perWeek} barGap={2} barCategoryGap="22%" margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
            <CartesianGrid vertical={false} stroke="var(--line)" />
            <XAxis dataKey="week" tickFormatter={shortWeek} tick={{ fill: 'var(--muted)', fontSize: 11 }} tickLine={false} axisLine={{ stroke: 'var(--line-strong)' }} minTickGap={18} />
            <YAxis allowDecimals={false} tick={{ fill: 'var(--muted)', fontSize: 11 }} tickLine={false} axisLine={false} />
            <Tooltip content={<WeekTooltip />} cursor={{ fill: 'var(--line)', opacity: 0.45 }} />
            <Bar dataKey="applications" name="Applications sent" fill="var(--series-1)" radius={[4, 4, 0, 0]} maxBarSize={18} isAnimationActive={false} />
            <Bar dataKey="rejections" name="Rejections received" fill="var(--series-2)" radius={[4, 4, 0, 0]} maxBarSize={18} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <details className="px-2 pt-1 text-xs text-ink-2">
        <summary className="cursor-pointer select-none text-muted hover:text-ink">Show as a table</summary>
        <table className="mt-2 w-full max-w-sm text-left [font-variant-numeric:tabular-nums]">
          <thead className="text-muted">
            <tr>
              <th className="py-1 font-medium">Week of</th>
              <th className="py-1 text-right font-medium">Applications</th>
              <th className="py-1 text-right font-medium">Rejections</th>
            </tr>
          </thead>
          <tbody>
            {perWeek.map((week) => (
              <tr key={week.week} className="border-t border-line">
                <td className="py-1">{formatDay(week.week)}</td>
                <td className="py-1 text-right">{week.applications}</td>
                <td className="py-1 text-right">{week.rejections}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}

/** A table with an inline magnitude bar: exact numbers stay readable, the bar gives the shape. */
function GroupTable({ title, groups, noun }: { title: string; groups: GroupStat[]; noun: string }) {
  const max = Math.max(1, ...groups.map((g) => g.total));
  return (
    <Card title={title}>
      {groups.length === 0 ? (
        <Empty>No data.</Empty>
      ) : (
        <table className="w-full text-sm [font-variant-numeric:tabular-nums]">
          <thead className="text-left text-xs text-muted">
            <tr>
              <th className="px-4 py-2 font-medium">{noun}</th>
              <th className="py-2 font-medium">Applications</th>
              <th className="px-3 py-2 text-right font-medium" title="Share of applications that got any human answer: rejection, reply, interview or offer">
                Answered
              </th>
              <th className="px-4 py-2 text-right font-medium" title="Median days from applying to the rejection">
                To rejection
              </th>
            </tr>
          </thead>
          <tbody>
            {groups.map((group) => (
              <tr key={group.key} className="border-t border-line">
                <td className="max-w-40 truncate px-4 py-1.5" title={group.label}>
                  {group.label}
                </td>
                <td className="w-2/5 py-1.5">
                  <div className="flex items-center gap-2">
                    <div className="h-2.5 rounded-r" style={{ width: `${(group.total / max) * 78}%`, minWidth: 3, background: 'var(--series-1)' }} title={`${group.total} applications`} />
                    <span className="text-xs text-ink-2">{group.total}</span>
                  </div>
                </td>
                <td className="px-3 py-1.5 text-right" title={`${group.responded} of ${group.total} answered; ${group.interviews} reached an interview`}>
                  {percent(group.responseRate)}
                </td>
                <td className="px-4 py-1.5 text-right text-ink-2">{days(group.medianDaysToRejection)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

export function StatsPage() {
  const { data, error } = useStats();
  if (!data) return <Loading error={error} />;
  const interviews = data.byRegion.reduce((n, g) => n + g.interviews, 0);
  return (
    <>
      <PageHeader title="Stats" subtitle={'Every row except "Not applied" counts as an application.'} />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Applications" value={String(data.total)} hint="all sections of the log" />
        <Tile label="Answered" value={percent(data.responseRate)} hint={`${data.responded} got a human answer`} />
        <Tile label="Reached an interview" value={String(interviews)} hint={data.total ? `${percent(interviews / data.total)} of applications` : '—'} />
        <Tile label="Median time to rejection" value={days(data.medianDaysToRejection)} hint="from exact dates only" />
      </div>
      <Card title="Per week" className="mb-4">
        <WeeklyChart perWeek={data.perWeek} />
      </Card>
      <div className="grid gap-4 xl:grid-cols-3">
        <GroupTable title="By region" noun="Region" groups={data.byRegion} />
        <GroupTable title="By channel" noun="Channel" groups={data.byChannel} />
        <GroupTable title="By CV variant" noun="CV" groups={data.byCv} />
      </div>
    </>
  );
}
