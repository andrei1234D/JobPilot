/**
 * Loads the Markdown logs, keeps the parsed result in memory and re-parses when
 * a file changes.
 *
 * The logs are strictly read-only: the only files this module ever writes are
 * JobPilot's own (settings.json, state.json, shortlist.json).
 */
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { watch, type FSWatcher } from 'chokidar';
import {
  SettingsSchema,
  ShortlistInputSchema,
  ShortlistItemSchema,
  companyKey,
  hashId,
  localIso,
  parseApplicationsLog,
  parseBatch,
  parseOutreachLog,
  type Application,
  type Batch,
  type Dataset,
  type NeedsItem,
  type OutreachLog,
  type ParseWarning,
  type SectionNote,
  type Settings,
  type ShortlistInput,
  type ShortlistItem,
} from '@jobpilot/shared';
import { z } from 'zod';

export interface StoreOptions {
  /** Folder for JobPilot's own files (settings, state, shortlist). */
  home: string;
  /** Folder with the bundled sample data, used until real paths are configured. */
  sampleDir: string;
  /** Clock, replaceable in tests. */
  now?: () => Date;
  /** Fixed "today" (yyyy-mm-dd). Overrides the clock and the sample's pinned date. */
  today?: string;
}

export interface ResolvedPaths {
  applicationsLog: string;
  outreachLog: string;
  batchesDir: string;
  shortlistFile: string;
  demo: boolean;
}

export interface Loaded extends Dataset {
  applications: Application[];
  needs: NeedsItem[];
  outreach: OutreachLog;
  batches: Batch[];
  shortlist: ShortlistItem[];
  notes: SectionNote[];
  warnings: ParseWarning[];
  loadedAt: string;
}

const StateSchema = z.object({ checked: z.array(z.string()).default([]) });

/** Editors on Windows like to put a byte-order mark at the start of a file. */
function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(stripBom(readFileSync(file, 'utf8')));
  } catch {
    return undefined;
  }
}

/** Write through a temp file so a crash mid-write cannot leave half a JSON file behind. */
function writeJson(file: string, value: unknown): void {
  mkdirSync(dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  renameSync(temp, file);
}

function readText(file: string, warnings: ParseWarning[]): string {
  if (!file) return '';
  try {
    return stripBom(readFileSync(file, 'utf8'));
  } catch (error) {
    warnings.push({ file, line: 0, message: `Could not read file: ${(error as NodeJS.ErrnoException).code ?? String(error)}` });
    return '';
  }
}

export class DataStore extends EventEmitter {
  readonly home: string;
  readonly sampleDir: string;
  private readonly now: () => Date;
  private readonly fixedToday: string | undefined;
  private settingsValue: Settings;
  private checked: Set<string>;
  private watcher: FSWatcher | null = null;
  private reloadTimer: NodeJS.Timeout | null = null;
  private loaded: Loaded;

  constructor(options: StoreOptions) {
    super();
    this.home = options.home;
    this.sampleDir = options.sampleDir;
    this.now = options.now ?? (() => new Date());
    this.fixedToday = options.today;
    mkdirSync(this.home, { recursive: true });
    this.settingsValue = this.readSettings();
    this.checked = new Set(StateSchema.catch({ checked: [] }).parse(readJson(this.stateFile) ?? {}).checked);
    this.loaded = this.read();
  }

  // ------------------------------------------------------------------ files

  get settingsFile(): string {
    return join(this.home, 'settings.json');
  }

  private get stateFile(): string {
    return join(this.home, 'state.json');
  }

  private readSettings(): Settings {
    const parsed = SettingsSchema.safeParse(readJson(this.settingsFile) ?? {});
    const settings = parsed.success ? parsed.data : SettingsSchema.parse({});
    // Environment variables win, so a dev run can point at other files without touching the saved settings.
    const env = process.env;
    return {
      ...settings,
      applicationsLog: env.JOBPILOT_APPLICATIONS_LOG ?? settings.applicationsLog,
      outreachLog: env.JOBPILOT_OUTREACH_LOG ?? settings.outreachLog,
      batchesDir: env.JOBPILOT_BATCHES_DIR ?? settings.batchesDir,
    };
  }

  get settings(): Settings {
    return this.settingsValue;
  }

  /** Real paths in use. With no applications log configured, everything comes from the sample folder. */
  get paths(): ResolvedPaths {
    const s = this.settingsValue;
    const demo = s.applicationsLog.trim() === '';
    const shortlistFile = s.shortlistFile.trim() || join(this.home, demo ? 'shortlist.sample.json' : 'shortlist.json');
    if (demo) {
      return {
        applicationsLog: join(this.sampleDir, 'applications_log.md'),
        outreachLog: join(this.sampleDir, 'outreach_log.md'),
        batchesDir: join(this.sampleDir, 'daily_batches'),
        shortlistFile,
        demo,
      };
    }
    return { applicationsLog: s.applicationsLog.trim(), outreachLog: s.outreachLog.trim(), batchesDir: s.batchesDir.trim(), shortlistFile, demo };
  }

  /** "Today" as yyyy-mm-dd. The sample data pins its own date so the demo never goes stale. */
  today(): string {
    if (this.fixedToday) return this.fixedToday;
    if (process.env.JOBPILOT_TODAY && /^\d{4}-\d{2}-\d{2}$/.test(process.env.JOBPILOT_TODAY)) return process.env.JOBPILOT_TODAY;
    if (this.paths.demo) {
      const pinned = z.object({ today: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).safeParse(readJson(join(this.sampleDir, 'sample.json')));
      if (pinned.success) return pinned.data.today;
    }
    return localIso(this.now());
  }

  // ---------------------------------------------------------------- loading

  private read(): Loaded {
    const paths = this.paths;
    const warnings: ParseWarning[] = [];
    const referenceYear = Number(this.today().slice(0, 4));

    const applications = parseApplicationsLog(readText(paths.applicationsLog, warnings), { file: paths.applicationsLog, referenceYear });
    const outreach = parseOutreachLog(readText(paths.outreachLog, warnings), { file: paths.outreachLog, referenceYear });
    warnings.push(...applications.warnings, ...outreach.warnings);

    const batches: Batch[] = [];
    if (paths.batchesDir) {
      try {
        for (const name of readdirSync(paths.batchesDir).sort()) {
          if (!/\.md$/i.test(name) || !/\d{4}-\d{2}-\d{2}/.test(name)) continue;
          const file = join(paths.batchesDir, name);
          if (!statSync(file).isFile()) continue;
          batches.push(parseBatch(readText(file, warnings), name));
        }
      } catch (error) {
        warnings.push({ file: paths.batchesDir, line: 0, message: `Could not read folder: ${(error as NodeJS.ErrnoException).code ?? String(error)}` });
      }
    }

    return {
      applications: applications.applications,
      needs: applications.needs,
      notes: applications.notes,
      outreach,
      batches,
      shortlist: this.readShortlist(paths.shortlistFile),
      warnings,
      loadedAt: this.now().toISOString(),
    };
  }

  get data(): Loaded {
    return this.loaded;
  }

  reload(): void {
    this.loaded = this.read();
    this.emit('change');
  }

  /** Watches the log files and re-parses shortly after the last change (agents save in bursts). */
  watch(): void {
    void this.watcher?.close();
    const paths = this.paths;
    const targets = [paths.applicationsLog, paths.outreachLog, paths.batchesDir].filter((p) => p && existsSync(p));
    if (targets.length === 0) return;
    this.watcher = watch(targets, { ignoreInitial: true, depth: 1, awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 } });
    this.watcher.on('all', () => {
      if (this.reloadTimer) clearTimeout(this.reloadTimer);
      this.reloadTimer = setTimeout(() => this.reload(), 120);
    });
    this.watcher.on('error', (error) => console.warn('[jobpilot] watcher error:', error));
  }

  async close(): Promise<void> {
    if (this.reloadTimer) clearTimeout(this.reloadTimer);
    await this.watcher?.close();
    this.watcher = null;
    this.removeAllListeners();
  }

  // --------------------------------------------------------------- settings

  /** Validates, saves and applies new settings. Throws a ZodError on invalid input. */
  updateSettings(patch: unknown): Settings {
    const merged = SettingsSchema.parse({ ...this.settingsValue, ...(patch as object) });
    for (const key of ['applicationsLog', 'outreachLog', 'batchesDir', 'shortlistFile'] as const) {
      const value = merged[key].trim();
      if (value && !isAbsolute(value)) throw new Error(`${key} must be an absolute path`);
      merged[key] = value;
    }
    if (merged.followUpMaxDays < merged.followUpMinDays) merged.followUpMaxDays = merged.followUpMinDays;
    writeJson(this.settingsFile, merged);
    this.settingsValue = merged;
    this.reload();
    this.watch();
    return merged;
  }

  // ------------------------------------------------------------------ state

  get checkedIds(): string[] {
    return [...this.checked];
  }

  setChecked(id: string, value: boolean): string[] {
    if (value) this.checked.add(id);
    else this.checked.delete(id);
    writeJson(this.stateFile, { checked: [...this.checked] });
    this.emit('change');
    return this.checkedIds;
  }

  // -------------------------------------------------------------- shortlist

  private readShortlist(file: string): ShortlistItem[] {
    const parsed = z.array(ShortlistItemSchema).safeParse(readJson(file) ?? []);
    return parsed.success ? parsed.data : [];
  }

  /** Adds a posting, or returns the existing entry when the same URL was saved before. */
  addToShortlist(input: ShortlistInput): { item: ShortlistItem; created: boolean } {
    const data = ShortlistInputSchema.parse(input);
    const url = data.url.split('#')[0]!;
    const existing = this.loaded.shortlist.find((item) => item.url === url);
    if (existing) return { item: existing, created: false };
    const addedAt = this.now().toISOString();
    const item: ShortlistItem = { ...data, url, id: `sl-${hashId(`${url}|${addedAt}`)}`, addedAt, companyKey: companyKey(data.company) };
    this.loaded = { ...this.loaded, shortlist: [item, ...this.loaded.shortlist] };
    writeJson(this.paths.shortlistFile, this.loaded.shortlist);
    this.emit('change');
    return { item, created: true };
  }

  removeFromShortlist(id: string): boolean {
    const next = this.loaded.shortlist.filter((item) => item.id !== id);
    if (next.length === this.loaded.shortlist.length) return false;
    this.loaded = { ...this.loaded, shortlist: next };
    writeJson(this.paths.shortlistFile, next);
    this.emit('change');
    return true;
  }
}
