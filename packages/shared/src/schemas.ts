/**
 * Single source of truth for every shape that crosses a boundary
 * (file -> parser -> API -> web / extension / desktop).
 *
 * Types are inferred from the Zod schemas, so the runtime validation and the
 * compile-time types cannot drift apart.
 */
import { z } from 'zod';

// --------------------------------------------------------------------------
// Dates
// --------------------------------------------------------------------------

/** A date as people actually write it in a log: "14 Nov 2026", "~Sep 2026", "by 25 Sep 2026", "unknown". */
export const FuzzyDateSchema = z.object({
  /** The text exactly as written. */
  raw: z.string(),
  /** Best ISO date (yyyy-mm-dd). First day of the month when only a month is known. Null when unknown. */
  iso: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  precision: z.enum(['day', 'month', 'unknown']),
  /** True for "~", "by", "around": the day is a bound or a guess, not a fact. */
  approximate: z.boolean(),
});
export type FuzzyDate = z.infer<typeof FuzzyDateSchema>;

// --------------------------------------------------------------------------
// Applications
// --------------------------------------------------------------------------

export const STATUSES = [
  'interview',
  'offer',
  'waiting',
  'no_reply',
  'rejected',
  'not_applied',
  'archived',
  'unknown',
] as const;
export const StatusSchema = z.enum(STATUSES);
export type Status = z.infer<typeof StatusSchema>;

export const STATUS_LABELS: Record<Status, string> = {
  interview: 'Interviews',
  offer: 'Offers',
  waiting: 'Waiting',
  no_reply: 'No reply 4+ weeks',
  rejected: 'Rejected',
  not_applied: 'Not applied',
  archived: 'Archived',
  unknown: 'Other',
};

export const EVENT_KINDS = [
  'submitted',
  'confirmation',
  'viewed',
  'reply',
  'interview',
  'offer',
  'rejected',
  'follow_up',
  'note',
] as const;
export const EventKindSchema = z.enum(EVENT_KINDS);
export type EventKind = z.infer<typeof EventKindSchema>;

export const AppEventSchema = z.object({
  date: z.string().nullable(),
  time: z.string().nullable(),
  kind: EventKindSchema,
  /** The sentence the event was read from. */
  text: z.string(),
});
export type AppEvent = z.infer<typeof AppEventSchema>;

export const CHANNELS = [
  'easy_apply',
  'teamtailor',
  'workday',
  'greenhouse',
  'lever',
  'ashby',
  'successfactors',
  'smartrecruiters',
  'workable',
  'email',
  'inmail',
  'linkedin',
  'job_board',
  'company_site',
  'other',
] as const;
export const ChannelSchema = z.enum(CHANNELS);
export type Channel = z.infer<typeof ChannelSchema>;

export const CHANNEL_LABELS: Record<Channel, string> = {
  easy_apply: 'Easy Apply',
  teamtailor: 'Teamtailor',
  workday: 'Workday',
  greenhouse: 'Greenhouse',
  lever: 'Lever',
  ashby: 'Ashby',
  successfactors: 'SuccessFactors',
  smartrecruiters: 'SmartRecruiters',
  workable: 'Workable',
  email: 'Email',
  inmail: 'InMail',
  linkedin: 'LinkedIn',
  job_board: 'Job board',
  company_site: 'Company site',
  other: 'Other',
};

export const ContactSchema = z.object({
  name: z.string().nullable(),
  role: z.string().nullable(),
  email: z.string().nullable(),
  /** A person, as opposed to a shared mailbox such as careers@. */
  named: z.boolean(),
  source: z.enum(['application', 'outreach']),
});
export type Contact = z.infer<typeof ContactSchema>;

export const ApplicationSchema = z.object({
  id: z.string(),
  status: StatusSchema,
  /** Heading of the section the row sits in, as written. */
  section: z.string(),
  applied: FuzzyDateSchema,
  company: z.string(),
  /** Text in parentheses after the company name, e.g. "(recruitment agency)". */
  companyNote: z.string().nullable(),
  /** Normalised key used for grouping and repeat checks. */
  companyKey: z.string(),
  role: z.string(),
  roleNote: z.string().nullable(),
  location: z.string(),
  /** ISO 3166 alpha-2 country, "REMOTE", or "OTHER". */
  region: z.string(),
  channel: ChannelSchema,
  channelRaw: z.string(),
  cvVariant: z.string().nullable(),
  history: z.string(),
  events: z.array(AppEventSchema),
  lastEvent: AppEventSchema.nullable(),
  contacts: z.array(ContactSchema),
  /** Job-board ids found in the row (e.g. LinkedIn job id), used by the extension for exact matches. */
  jobIds: z.array(z.string()),
  /** 1-based line number in the source file. */
  line: z.number().int(),
  /** Parser notes for this row (unknown format, column mismatch...). */
  warnings: z.array(z.string()),
});
export type Application = z.infer<typeof ApplicationSchema>;

export const NeedsItemSchema = z.object({
  id: z.string(),
  /** Markdown of the bullet, including nested bullets. */
  markdown: z.string(),
  /** First line as plain text. */
  title: z.string(),
  source: z.string(),
  line: z.number().int(),
});
export type NeedsItem = z.infer<typeof NeedsItemSchema>;

export const ParseWarningSchema = z.object({
  file: z.string(),
  line: z.number().int(),
  message: z.string(),
});
export type ParseWarning = z.infer<typeof ParseWarningSchema>;

export const SectionNoteSchema = z.object({
  heading: z.string(),
  markdown: z.string(),
});
export type SectionNote = z.infer<typeof SectionNoteSchema>;

export const ApplicationsLogSchema = z.object({
  applications: z.array(ApplicationSchema),
  needs: z.array(NeedsItemSchema),
  /** Free text found in sections that have no table (e.g. "None right now."). */
  notes: z.array(SectionNoteSchema),
  warnings: z.array(ParseWarningSchema),
});
export type ApplicationsLog = z.infer<typeof ApplicationsLogSchema>;

// --------------------------------------------------------------------------
// Outreach
// --------------------------------------------------------------------------

export const OutreachMessageSchema = z.object({
  id: z.string(),
  date: FuzzyDateSchema,
  person: z.string(),
  personRole: z.string().nullable(),
  company: z.string(),
  companyKey: z.string(),
  about: z.string(),
  status: z.string(),
  replied: z.boolean(),
  line: z.number().int(),
});
export type OutreachMessage = z.infer<typeof OutreachMessageSchema>;

export const ConnectionStatusSchema = z.enum(['pending', 'accepted', 'declined', 'withdrawn', 'unknown']);
export type ConnectionStatus = z.infer<typeof ConnectionStatusSchema>;

export const ConnectionSchema = z.object({
  id: z.string(),
  sent: FuzzyDateSchema,
  person: z.string(),
  company: z.string(),
  companyKey: z.string(),
  profileUrl: z.string().nullable(),
  status: ConnectionStatusSchema,
  statusRaw: z.string(),
  line: z.number().int(),
});
export type Connection = z.infer<typeof ConnectionSchema>;

export const OutreachLogSchema = z.object({
  messages: z.array(OutreachMessageSchema),
  connections: z.array(ConnectionSchema),
  notes: z.array(SectionNoteSchema),
  warnings: z.array(ParseWarningSchema),
});
export type OutreachLog = z.infer<typeof OutreachLogSchema>;

// --------------------------------------------------------------------------
// Daily batches
// --------------------------------------------------------------------------

export const BatchRoleSchema = z.object({
  index: z.string(),
  company: z.string(),
  role: z.string(),
  location: z.string(),
  link: z.string(),
  fit: z.string(),
  gap: z.string(),
  how: z.string(),
});
export type BatchRole = z.infer<typeof BatchRoleSchema>;

export const BatchSectionSchema = z.object({
  heading: z.string(),
  markdown: z.string(),
});

export const BatchSchema = z.object({
  /** ISO date taken from the file name (batch_YYYY-MM-DD.md). */
  date: z.string(),
  file: z.string(),
  title: z.string(),
  sections: z.array(BatchSectionSchema),
  roles: z.array(BatchRoleSchema),
  needs: z.array(NeedsItemSchema),
  markdown: z.string(),
});
export type Batch = z.infer<typeof BatchSchema>;

export const BatchSummarySchema = BatchSchema.pick({ date: true, file: true, title: true }).extend({
  roleCount: z.number().int(),
  needsCount: z.number().int(),
});
export type BatchSummary = z.infer<typeof BatchSummarySchema>;

// --------------------------------------------------------------------------
// Rules output
// --------------------------------------------------------------------------

export const FollowUpSchema = z.object({
  application: ApplicationSchema,
  contact: ContactSchema,
  daysSinceApplied: z.number().int(),
  /** Days left in the follow-up window (0 = last day). Negative for upcoming items: days until it opens. */
  windowDaysLeft: z.number().int(),
});
export type FollowUp = z.infer<typeof FollowUpSchema>;

export const StaleConnectSchema = z.object({
  connection: ConnectionSchema,
  daysPending: z.number().int(),
});
export type StaleConnect = z.infer<typeof StaleConnectSchema>;

export const RedFlagSchema = z.object({
  id: z.string(),
  label: z.string(),
  severity: z.enum(['block', 'warn', 'info']),
  /** The sentence in the ad that triggered the flag. */
  evidence: z.string(),
});
export type RedFlag = z.infer<typeof RedFlagSchema>;

export const HygieneIssueSchema = z.object({
  applicationId: z.string(),
  company: z.string(),
  role: z.string(),
  message: z.string(),
  line: z.number().int(),
});
export type HygieneIssue = z.infer<typeof HygieneIssueSchema>;

export const RepeatMatchSchema = z.object({
  application: ApplicationSchema,
  score: z.number(),
  reason: z.enum(['job_id', 'exact', 'alias', 'tokens', 'fuzzy']),
});
export type RepeatMatch = z.infer<typeof RepeatMatchSchema>;

// --------------------------------------------------------------------------
// Profile: what counts as a red flag is personal, so it is configuration.
// --------------------------------------------------------------------------

export const ProfileSchema = z.object({
  /** Languages you can work in. A posting that requires any other language is flagged. */
  languages: z.array(z.string()).default(['English']),
  /** Flag postings that ask for at least this many years of experience. */
  maxYears: z.number().int().min(0).default(5),
  /** Flag senior / lead / principal titles. */
  flagSeniority: z.boolean().default(true),
  /** Flag internships and traineeships. */
  flagInternships: z.boolean().default(true),
  /** Stacks you do not want a role to be built around. */
  avoidStacks: z.array(z.string()).default(['Java', '.NET', 'C#']),
  /** Countries you already live in: "must be based in <country>" is not a knock-out for these. */
  basedIn: z.array(z.string()).default([]),
});
export type Profile = z.infer<typeof ProfileSchema>;

// --------------------------------------------------------------------------
// API payloads
// --------------------------------------------------------------------------

export const TodaySchema = z.object({
  today: z.string(),
  demo: z.boolean(),
  followUpsDue: z.array(FollowUpSchema),
  followUpsUpcoming: z.array(FollowUpSchema),
  staleConnects: z.array(StaleConnectSchema),
  needs: z.array(NeedsItemSchema),
  hygiene: z.array(HygieneIssueSchema),
  batch: BatchSchema.nullable(),
  /** Ids of "Needs" items ticked in the dashboard. Stored by JobPilot, never written to the logs. */
  checked: z.array(z.string()),
  counts: z.record(StatusSchema, z.number().int()),
});
export type Today = z.infer<typeof TodaySchema>;

export const GroupStatSchema = z.object({
  key: z.string(),
  label: z.string(),
  total: z.number().int(),
  responded: z.number().int(),
  rejected: z.number().int(),
  interviews: z.number().int(),
  /** 0..1, or null when there is nothing to divide by. */
  responseRate: z.number().nullable(),
  medianDaysToRejection: z.number().nullable(),
});
export type GroupStat = z.infer<typeof GroupStatSchema>;

export const StatsSchema = z.object({
  total: z.number().int(),
  responded: z.number().int(),
  responseRate: z.number().nullable(),
  medianDaysToRejection: z.number().nullable(),
  perWeek: z.array(z.object({ week: z.string(), applications: z.number().int(), rejections: z.number().int() })),
  byRegion: z.array(GroupStatSchema),
  byChannel: z.array(GroupStatSchema),
  byCv: z.array(GroupStatSchema),
});
export type Stats = z.infer<typeof StatsSchema>;

export const SearchHitSchema = z.object({
  type: z.enum(['application', 'message', 'connection', 'batch', 'needs']),
  id: z.string(),
  title: z.string(),
  subtitle: z.string(),
  snippet: z.string(),
  date: z.string().nullable(),
  /** Where the hit lives: an application id, a company key or a batch date. */
  ref: z.string(),
  score: z.number(),
});
export type SearchHit = z.infer<typeof SearchHitSchema>;

export const CompanyPageSchema = z.object({
  key: z.string(),
  name: z.string(),
  applications: z.array(ApplicationSchema),
  messages: z.array(OutreachMessageSchema),
  connections: z.array(ConnectionSchema),
  batchMentions: z.array(z.object({ date: z.string(), snippet: z.string() })),
  shortlist: z.array(z.lazy(() => ShortlistItemSchema)),
});
export type CompanyPage = z.infer<typeof CompanyPageSchema>;

export const CompanySummarySchema = z.object({
  key: z.string(),
  name: z.string(),
  applications: z.number().int(),
  lastApplied: z.string().nullable(),
  statuses: z.array(StatusSchema),
});
export type CompanySummary = z.infer<typeof CompanySummarySchema>;

/** What the extension (or the dashboard) sends to save a posting. */
export const ShortlistInputSchema = z.object({
  title: z.string().trim().min(1).max(300),
  company: z.string().trim().min(1).max(200),
  location: z.string().trim().max(200).default(''),
  url: z.string().url().max(2000),
  source: z.string().trim().max(60).default('manual'),
  note: z.string().trim().max(2000).default(''),
  flags: z.array(RedFlagSchema).max(30).default([]),
});
export type ShortlistInput = z.input<typeof ShortlistInputSchema>;

export const ShortlistItemSchema = ShortlistInputSchema.extend({
  id: z.string(),
  addedAt: z.string(),
  companyKey: z.string(),
});
export type ShortlistItem = z.infer<typeof ShortlistItemSchema>;

export const LookupRequestSchema = z.object({
  company: z.string().trim().max(200).default(''),
  url: z.string().trim().max(2000).default(''),
  title: z.string().trim().max(300).default(''),
});
export type LookupRequest = z.input<typeof LookupRequestSchema>;

export const LookupResponseSchema = z.object({
  company: z.string(),
  matches: z.array(RepeatMatchSchema),
  shortlisted: z.boolean(),
  profile: ProfileSchema,
});
export type LookupResponse = z.infer<typeof LookupResponseSchema>;

export const SettingsSchema = z.object({
  /** Empty string = use the bundled sample data. */
  applicationsLog: z.string().default(''),
  outreachLog: z.string().default(''),
  batchesDir: z.string().default(''),
  /** Where quick-added postings are saved. Empty = shortlist.json in JobPilot's own settings folder. */
  shortlistFile: z.string().default(''),
  profile: ProfileSchema.default({}),
  followUpMinDays: z.number().int().min(1).max(60).default(8),
  followUpMaxDays: z.number().int().min(1).max(90).default(10),
  staleConnectDays: z.number().int().min(1).max(365).default(14),
  /** Desktop only. "HH:MM" local time, or empty to disable. */
  morningNotification: z.string().regex(/^$|^([01]\d|2[0-3]):[0-5]\d$/).default('09:00'),
  startWithWindows: z.boolean().default(false),
});
export type Settings = z.infer<typeof SettingsSchema>;

export const HealthSchema = z.object({
  ok: z.literal(true),
  name: z.literal('jobpilot'),
  version: z.string(),
  demo: z.boolean(),
  today: z.string(),
  files: z.object({
    applicationsLog: z.string(),
    outreachLog: z.string(),
    batchesDir: z.string(),
  }),
  loadedAt: z.string(),
  warnings: z.number().int(),
});
export type Health = z.infer<typeof HealthSchema>;
