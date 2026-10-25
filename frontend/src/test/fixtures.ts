import type { CreateTicketResponse, HealthResponse, LocationResult, TicketResponse, WeatherResponse } from '../lib/api/types';
import { addDays, todayIn } from '../lib/dates';

export const day = addDays(todayIn('UTC'), 1);
export const token = 'a'.repeat(43);
export const health: HealthResponse = {
  status: 'ok', service: 'raincheck-api', version: '0.1.0', time: '2026-10-25T10:00:00.000Z', database: 'ok',
  capabilities: { weather: true, tickets: true, ai_generation: false, ai_provider: 'none', paid_training_enabled: false },
};
export const london: LocationResult = {
  id: 'om:2643743', name: 'London', admin1: 'England', country: 'United Kingdom', country_code: 'GB',
  latitude: 51.50853, longitude: -0.12574, timezone: 'Europe/London',
};
export const newYork: LocationResult = {
  id: 'om:5128581', name: 'New York', admin1: 'New York', country: 'United States', country_code: 'US',
  latitude: 40.7143, longitude: -74.006, timezone: 'America/New_York',
};
export const attribution = { text: 'Weather data by Open-Meteo.com', url: 'https://open-meteo.com/' };
export function forecast(date = day, city = london, weatherToken = 'wxs_test-proof'): WeatherResponse {
  return {
    date, location: { label: `${city.name}, ${city.admin1}, ${city.country}`, name: city.name, admin1: city.admin1, country: city.country, country_code: city.country_code, timezone: city.timezone },
    forecast: { weather_code: 61, condition: 'Light rain', temperature_min_c: 12.1, temperature_max_c: 17.8, precipitation_probability_max: 64, precipitation_sum_mm: 2.4, wind_speed_max_kmh: 18.2 },
    summary: 'Light rain, 12–18°C, 64% chance of rain.', grounded: true, is_forecast: true,
    source: { provider: 'open-meteo', endpoint: 'forecast', model: 'best_match', fetched_at: '2026-10-25T10:03:12.000Z' },
    attribution, weather_token: weatherToken,
  };
}
export const created: CreateTicketResponse = {
  ticket_id: '1f0c2d3e-4a5b-6c7d-8e9f-0a1b2c3d4e5f', token,
  share_path: `/t/${token}`, ics_path: `/api/tickets/${token}/raincheck.ics`, accept_path: `/api/tickets/${token}/accept`,
  status: 'open', created_at: '2026-10-25T10:03:12.000Z', expires_at: '2026-11-24T10:03:12.000Z',
  proposed: { date: day, start_time: '15:00', end_time: null, timezone: 'UTC', location_label: null },
  labels: { theatrical: false, availability_confirmed: false },
};
export const publicTicket: TicketResponse = {
  ticket_id: created.ticket_id, status: 'open', message: 'Could we try our coffee another day?',
  sender_name: 'Alex', recipient: { relationship: 'friend', display_name: 'Sam' }, tone: 'honest', theatrical: false,
  plan: { title: 'Coffee at the corner', details: 'The place with the orange chairs.' },
  proposed: created.proposed, weather: null,
  availability: { confirmed: false, note: 'This is a suggestion. No calendar has been checked.' },
  created_at: created.created_at, expires_at: created.expires_at, accepted_at: null,
};
export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'X-Request-ID': 'test-request' } });
}
export function failure(code: string, message: string, status: number, details: unknown = null): Response {
  return json({ error: { code, message, details, request_id: 'test-request' } }, status);
}
export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
