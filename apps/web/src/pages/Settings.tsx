import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import type { Settings } from '@jobpilot/shared';
import { useSaveSettings, useSettings, useWarnings } from '../api';
import { Card, Empty, Loading, PageHeader, buttonClass, inputClass, primaryButtonClass } from '../ui';

const list = (value: string): string[] => value.split(',').map((item) => item.trim()).filter(Boolean);

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="text-sm font-medium">{label}</span>
      {hint && <span className="mt-0.5 block text-xs text-muted">{hint}</span>}
      <div className="mt-1.5">{children}</div>
    </label>
  );
}

function PathField({ label, hint, value, onChange, folder }: { label: string; hint: string; value: string; onChange: (value: string) => void; folder?: boolean }) {
  const bridge = window.jobpilot;
  const browse = async (): Promise<void> => {
    const picked = folder ? await bridge?.pickFolder(label) : await bridge?.pickFile(label);
    if (picked) onChange(picked);
  };
  return (
    <Field label={label} hint={hint}>
      <div className="flex gap-2">
        <input type="text" value={value} onChange={(event) => onChange(event.target.value)} spellCheck={false} placeholder="Absolute path, or empty for the sample data" className={`${inputClass} font-mono text-xs`} />
        {bridge && (
          <button type="button" className={buttonClass} onClick={() => void browse()}>
            Browse…
          </button>
        )}
      </div>
    </Field>
  );
}

export function SettingsPage() {
  const { data, error } = useSettings();
  const warnings = useWarnings();
  const save = useSaveSettings();
  const [form, setForm] = useState<Settings | null>(null);
  const [languages, setLanguages] = useState('');
  const [stacks, setStacks] = useState('');
  const [basedIn, setBasedIn] = useState('');

  useEffect(() => {
    if (!data) return;
    setForm(data.settings);
    setLanguages(data.settings.profile.languages.join(', '));
    setStacks(data.settings.profile.avoidStacks.join(', '));
    setBasedIn(data.settings.profile.basedIn.join(', '));
  }, [data]);

  if (!data || !form) return <Loading error={error} />;
  const set = <K extends keyof Settings>(key: K, value: Settings[K]): void => setForm({ ...form, [key]: value });
  const setProfile = <K extends keyof Settings['profile']>(key: K, value: Settings['profile'][K]): void => setForm({ ...form, profile: { ...form.profile, [key]: value } });

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    save.mutate(
      { ...form, profile: { ...form.profile, languages: list(languages), avoidStacks: list(stacks), basedIn: list(basedIn) } },
      { onSuccess: () => void window.jobpilot?.applyDesktopSettings() },
    );
  };
  const useSample = (): void => save.mutate({ applicationsLog: '', outreachLog: '', batchesDir: '' });

  return (
    <>
      <PageHeader title="Settings" subtitle={`Saved in ${data.settingsFile}. Nothing here is sent anywhere.`} />
      <form onSubmit={submit} className="grid max-w-5xl gap-4 xl:grid-cols-2">
        <Card title="Your log files" className="xl:col-span-2">
          <div className="space-y-4 px-4 py-4">
            <p className="rounded-lg bg-page px-3 py-2 text-xs text-ink-2">
              JobPilot only reads these files. It never edits them. {data.paths.demo ? 'Right now it shows the bundled sample data.' : 'Right now it reads your own files.'}
            </p>
            <PathField label="Applications log" hint="The Markdown file with one table row per application." value={form.applicationsLog} onChange={(value) => set('applicationsLog', value)} />
            <PathField label="Outreach log" hint="Messages and connection requests. Optional." value={form.outreachLog} onChange={(value) => set('outreachLog', value)} />
            <PathField label="Daily batches folder" hint="Folder with batch_YYYY-MM-DD.md files. Optional." value={form.batchesDir} onChange={(value) => set('batchesDir', value)} folder />
            <PathField label="Shortlist file" hint="Where quick-added postings are written (JSON). Empty = JobPilot's own folder." value={form.shortlistFile} onChange={(value) => set('shortlistFile', value)} />
          </div>
        </Card>

        <Card title="Rules">
          <div className="grid grid-cols-3 gap-3 px-4 py-4">
            <Field label="Follow-up from day">
              <input type="number" min={1} max={60} value={form.followUpMinDays} onChange={(event) => set('followUpMinDays', Number(event.target.value))} className={inputClass} />
            </Field>
            <Field label="…until day">
              <input type="number" min={1} max={90} value={form.followUpMaxDays} onChange={(event) => set('followUpMaxDays', Number(event.target.value))} className={inputClass} />
            </Field>
            <Field label="Connect is stale after">
              <input type="number" min={1} max={365} value={form.staleConnectDays} onChange={(event) => set('staleConnectDays', Number(event.target.value))} className={inputClass} />
            </Field>
          </div>
          <p className="border-t border-line px-4 py-2 text-xs text-muted">Days are counted from the application date. A follow-up needs a named contact and no answer so far.</p>
        </Card>

        <Card title="Desktop app">
          <div className="space-y-3 px-4 py-4">
            <Field label="Morning notification" hint="Local time, HH:MM. Empty turns it off.">
              <input type="text" value={form.morningNotification} onChange={(event) => set('morningNotification', event.target.value)} placeholder="09:00" className={`${inputClass} w-28`} />
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.startWithWindows} onChange={(event) => set('startWithWindows', event.target.checked)} className="h-4 w-4 accent-[var(--accent)]" />
              Start JobPilot when Windows starts
            </label>
            {!window.jobpilot && <p className="text-xs text-muted">These two apply when JobPilot runs as the desktop app.</p>}
          </div>
        </Card>

        <Card title="Red flags in job ads (used by the browser extension)" className="xl:col-span-2">
          <div className="grid gap-4 px-4 py-4 md:grid-cols-2">
            <Field label="Languages you work in" hint="A posting that requires any other language is flagged.">
              <input type="text" value={languages} onChange={(event) => setLanguages(event.target.value)} className={inputClass} />
            </Field>
            <Field label="Stacks to avoid" hint="Flagged when a posting is built around one of them.">
              <input type="text" value={stacks} onChange={(event) => setStacks(event.target.value)} className={inputClass} />
            </Field>
            <Field label="Flag postings asking for this many years" hint="A warning starts two years below it.">
              <input type="number" min={0} max={30} value={form.profile.maxYears} onChange={(event) => setProfile('maxYears', Number(event.target.value))} className={`${inputClass} w-28`} />
            </Field>
            <Field label="Countries you already live in" hint="“Must be based in …” is not a knock-out for these.">
              <input type="text" value={basedIn} onChange={(event) => setBasedIn(event.target.value)} placeholder="e.g. Netherlands" className={inputClass} />
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.profile.flagSeniority} onChange={(event) => setProfile('flagSeniority', event.target.checked)} className="h-4 w-4 accent-[var(--accent)]" />
              Flag senior, lead and principal roles
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.profile.flagInternships} onChange={(event) => setProfile('flagInternships', event.target.checked)} className="h-4 w-4 accent-[var(--accent)]" />
              Flag internships and traineeships
            </label>
          </div>
        </Card>

        <div className="flex flex-wrap items-center gap-3 xl:col-span-2">
          <button type="submit" className={primaryButtonClass} disabled={save.isPending}>
            {save.isPending ? 'Saving…' : 'Save settings'}
          </button>
          {!data.paths.demo && (
            <button type="button" className={buttonClass} onClick={useSample} disabled={save.isPending}>
              Switch back to the sample data
            </button>
          )}
          {save.isSuccess && <span className="text-sm text-good">Saved.</span>}
          {save.isError && <span className="text-sm text-bad">{save.error.message}</span>}
        </div>
      </form>

      <div id="warnings" className="mt-6 max-w-5xl">
        <Card title="Parser notes" count={warnings.data?.warnings.length}>
          {!warnings.data || warnings.data.warnings.length === 0 ? (
            <Empty>Every row was read without a remark.</Empty>
          ) : (
            <ul className="max-h-72 divide-y divide-line overflow-y-auto">
              {warnings.data.warnings.map((warning, index) => (
                <li key={index} className="px-4 py-2 text-xs">
                  <span className="font-mono text-muted">
                    {warning.file.split(/[\\/]/).pop()}:{warning.line}
                  </span>{' '}
                  <span className="text-ink-2">{warning.message}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="border-t border-line px-4 py-2 text-xs text-muted">Rows the parser could not fully understand are still shown; this list says what it kept as raw text.</p>
        </Card>
      </div>
    </>
  );
}
