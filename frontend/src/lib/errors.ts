import { ApiError } from './api/client';

export function asApiError(error: unknown): ApiError {
  return error instanceof ApiError ? error : new ApiError({
    code: 'unexpected_error', status: 0,
    message: 'Something interrupted that step. Your note is still here. Please try again.',
  });
}

export function fieldErrors(error: ApiError): Record<string, string> {
  const details = error.details;
  if (!details || typeof details !== 'object' || !('fields' in details) || !Array.isArray(details.fields)) return {};
  const fields: Record<string, string> = {};
  for (const item of details.fields) {
    if (item && typeof item === 'object' && typeof item.path === 'string' && typeof item.message === 'string') {
      fields[item.path] = item.message;
    }
  }
  return fields;
}

export function errorExplanation(error: ApiError): string {
  switch (error.code) {
    case 'ai_unavailable': return `${error.message} Write your own note below. You can still make a ticket.`;
    case 'weather_token_invalid': return 'The weather proof is missing, expired, or no longer matches. Refresh weather or remove it, then review again. Your edited note is safe.';
    case 'date_out_of_ticket_window': return 'That day is beyond this ticket’s lifetime (normally 30 days). Choose an earlier replacement date, then review again.';
    case 'invalid_local_time': return 'That local time does not exist because the clocks change. Choose a different start or end time. Repeated times use the earlier occurrence.';
    case 'location_mismatch': return 'The city and timezone no longer match. Select the city again, or continue without weather.';
    default: return error.message;
  }
}

/** Never turn an API-supplied path into an external or executable link. */
export function ticketPaths(share: string, ics: string): boolean {
  return /^\/t\/[A-Za-z0-9_-]+$/.test(share) && /^\/api\/tickets\/[A-Za-z0-9_-]+\/raincheck\.ics$/.test(ics);
}
