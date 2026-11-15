/**
 * Service worker: the only part of the extension that talks to the local
 * JobPilot server. It validates what comes back with the shared Zod schemas,
 * so the content script never renders an unexpected shape.
 */
import { DEFAULT_HOST, DEFAULT_PORT, LookupResponseSchema, ShortlistItemSchema, TodaySchema } from '@jobpilot/shared';
import { z } from 'zod';
import type { Request, Result } from './messages';

/** Replaced at build time; the test build points at the test server's port. */
declare const __JOBPILOT_PORT__: number | undefined;
const PORT = typeof __JOBPILOT_PORT__ === 'number' ? __JOBPILOT_PORT__ : DEFAULT_PORT;
const BASE = `http://${DEFAULT_HOST}:${PORT}`;

async function call<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, path: string, body?: unknown): Promise<Result<T>> {
  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(4000),
    });
  } catch {
    return { ok: false, error: 'JobPilot is not running on this computer', offline: true };
  }
  if (!response.ok) return { ok: false, error: `JobPilot answered ${response.status}`, offline: false };
  const parsed = schema.safeParse(await response.json());
  return parsed.success ? { ok: true, data: parsed.data } : { ok: false, error: 'Unexpected answer from JobPilot (version mismatch?)', offline: false };
}

function handle(request: Request): Promise<Result<unknown>> {
  switch (request.type) {
    case 'lookup':
      return call(LookupResponseSchema, '/api/lookup', request.payload);
    case 'shortlist:add':
      return call(z.object({ item: ShortlistItemSchema, created: z.boolean() }), '/api/shortlist', request.payload);
    case 'today':
      return call(TodaySchema, '/api/today');
  }
}

chrome.runtime.onMessage.addListener((request: Request, _sender, sendResponse) => {
  void handle(request).then(sendResponse);
  return true; // keep the channel open for the async answer
});
