/**
 * Typed client for the local API. Responses are validated with the same Zod
 * schemas the server builds them from, so a mismatch fails loudly here instead
 * of surfacing as an undefined somewhere in a component.
 */
import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ApplicationSchema,
  BatchSchema,
  BatchSummarySchema,
  CompanyPageSchema,
  HealthSchema,
  ParseWarningSchema,
  SearchHitSchema,
  SectionNoteSchema,
  SettingsSchema,
  ShortlistItemSchema,
  StatsSchema,
  TodaySchema,
  type Settings,
  type Today,
} from '@jobpilot/shared';
import { z } from 'zod';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json', ...init.headers } : init?.headers,
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string; issues?: Array<{ path: string; message: string }> };
    const detail = body.issues?.map((issue) => `${issue.path}: ${issue.message}`).join('; ');
    throw new ApiError(detail ?? body.error ?? `Request failed (${response.status})`, response.status);
  }
  if (response.status === 204) return schema.parse(undefined);
  return schema.parse(await response.json());
}

const PathsSchema = z.object({ applicationsLog: z.string(), outreachLog: z.string(), batchesDir: z.string(), shortlistFile: z.string(), demo: z.boolean() });
const SettingsResponseSchema = z.object({ settings: SettingsSchema, paths: PathsSchema, settingsFile: z.string() });
export type SettingsResponse = z.infer<typeof SettingsResponseSchema>;

const ApplicationsResponse = z.object({ applications: z.array(ApplicationSchema), notes: z.array(SectionNoteSchema) });
const SearchResponse = z.object({ query: z.string(), hits: z.array(SearchHitSchema) });
const BatchesResponse = z.object({ batches: z.array(BatchSummarySchema) });
const ShortlistResponse = z.object({ items: z.array(ShortlistItemSchema), file: z.string() });
const WarningsResponse = z.object({ warnings: z.array(ParseWarningSchema) });

export const useHealth = () => useQuery({ queryKey: ['health'], queryFn: () => request(HealthSchema, '/api/health') });
export const useToday = () => useQuery({ queryKey: ['today'], queryFn: () => request(TodaySchema, '/api/today') });
export const useApplications = () => useQuery({ queryKey: ['applications'], queryFn: () => request(ApplicationsResponse, '/api/applications') });
export const useStats = () => useQuery({ queryKey: ['stats'], queryFn: () => request(StatsSchema, '/api/stats') });
export const useBatches = () => useQuery({ queryKey: ['batches'], queryFn: () => request(BatchesResponse, '/api/batches') });
export const useShortlist = () => useQuery({ queryKey: ['shortlist'], queryFn: () => request(ShortlistResponse, '/api/shortlist') });
export const useSettings = () => useQuery({ queryKey: ['settings'], queryFn: () => request(SettingsResponseSchema, '/api/settings') });
export const useWarnings = () => useQuery({ queryKey: ['warnings'], queryFn: () => request(WarningsResponse, '/api/warnings') });

export const useBatch = (date: string | undefined) =>
  useQuery({ queryKey: ['batch', date], queryFn: () => request(BatchSchema, `/api/batches/${date}`), enabled: Boolean(date) });

export const useCompany = (key: string | undefined) =>
  useQuery({
    queryKey: ['company', key],
    queryFn: () => request(CompanyPageSchema, `/api/companies/${encodeURIComponent(key ?? '')}`),
    enabled: Boolean(key),
    retry: false,
  });

export const useSearch = (query: string) =>
  useQuery({
    queryKey: ['search', query],
    queryFn: () => request(SearchResponse, `/api/search?q=${encodeURIComponent(query)}`),
    enabled: query.trim().length > 0,
    placeholderData: (previous) => previous,
  });

export function useSetChecked() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; checked: boolean }) =>
      request(z.object({ checked: z.array(z.string()) }), '/api/checks', { method: 'PUT', body: JSON.stringify(input) }),
    // Optimistic: a checkbox that waits for the network feels broken.
    onMutate: ({ id, checked }) => {
      // Synchronous, so the checkbox flips in the same render as the click. An in-flight refetch is
      // cancelled without reverting, or its stale answer would overwrite the tick.
      const previous = client.getQueryData<Today>(['today']);
      if (previous) {
        const next = checked ? [...new Set([...previous.checked, id])] : previous.checked.filter((item) => item !== id);
        client.setQueryData<Today>(['today'], { ...previous, checked: next });
      }
      void client.cancelQueries({ queryKey: ['today'] }, { revert: false });
      return { previous };
    },
    onError: (_error, _input, context) => {
      if (context?.previous) client.setQueryData(['today'], context.previous);
    },
    onSettled: () => client.invalidateQueries({ queryKey: ['today'] }),
  });
}

export function useSaveSettings() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<Settings>) => request(SettingsResponseSchema, '/api/settings', { method: 'PUT', body: JSON.stringify(patch) }),
    onSuccess: () => client.invalidateQueries(),
  });
}

export function useRemoveShortlistItem() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => request(z.undefined(), `/api/shortlist/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['shortlist'] }),
  });
}

export function useReload() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => request(z.object({ loadedAt: z.string() }), '/api/reload', { method: 'POST', body: '{}' }),
    onSuccess: () => client.invalidateQueries(),
  });
}

/** Refetches everything when the server reports that a log file changed. */
export function useLiveUpdates(): void {
  const client = useQueryClient();
  useEffect(() => {
    const source = new EventSource('/api/events');
    const refresh = (): void => void client.invalidateQueries();
    source.addEventListener('change', refresh);
    return () => {
      source.removeEventListener('change', refresh);
      source.close();
    };
  }, [client]);
}

/** Functions the desktop shell exposes through its preload script. Absent in a normal browser. */
export interface DesktopBridge {
  pickFile: (title: string) => Promise<string | null>;
  pickFolder: (title: string) => Promise<string | null>;
  showInFolder: (path: string) => Promise<void>;
  applyDesktopSettings: () => Promise<void>;
}

declare global {
  interface Window {
    jobpilot?: DesktopBridge;
  }
}
