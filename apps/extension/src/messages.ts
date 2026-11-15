/**
 * Messages between the content script / popup and the background service worker.
 *
 * Content scripts run inside the job site's page, so they cannot call
 * http://127.0.0.1 themselves (mixed content, CORS, private-network rules).
 * The service worker can, because the manifest grants it that one host.
 */
import type { LookupRequest, LookupResponse, ShortlistInput, ShortlistItem, Today } from '@jobpilot/shared';

export type Request =
  | { type: 'lookup'; payload: LookupRequest }
  | { type: 'shortlist:add'; payload: ShortlistInput }
  | { type: 'today' };

export type Result<T> = { ok: true; data: T } | { ok: false; error: string; offline: boolean };

export interface Responses {
  lookup: LookupResponse;
  'shortlist:add': { item: ShortlistItem; created: boolean };
  today: Today;
}

export function send<K extends Request['type']>(request: Extract<Request, { type: K }>): Promise<Result<Responses[K]>> {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(request, (response: Result<Responses[K]> | undefined) => {
        if (chrome.runtime.lastError || !response) {
          resolve({ ok: false, error: chrome.runtime.lastError?.message ?? 'No response from the extension', offline: true });
        } else {
          resolve(response);
        }
      });
    } catch (error) {
      resolve({ ok: false, error: String(error), offline: true });
    }
  });
}
