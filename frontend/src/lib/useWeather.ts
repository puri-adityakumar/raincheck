import { useEffect, useState } from 'react';
import { apiFetch, ApiError } from './api/client';
import type { LocationResult, WeatherResponse } from './api/types';
import { addDays, todayIn, validDate, validTimezone } from './dates';
import { asApiError } from './errors';

export function useWeather(city: LocationResult | null, date: string, timezone: string, enabled: boolean, revision: number) {
  const zoneMatches = city?.timezone === timezone;
  const today = city && validTimezone(city.timezone) ? todayIn(city.timezone) : '';
  const inRange = validDate(date) && date >= today && date <= addDays(today || '2000-01-01', 14);
  const eligible = Boolean(city && enabled && zoneMatches && inRange);
  // The key guards the render *before* effect cleanup too, so stale proofs are never sent.
  const key = JSON.stringify([city?.id, city?.latitude, city?.longitude, date, timezone, enabled, revision]);
  const [state, setState] = useState<{
    key: string; data: WeatherResponse | null; error: ApiError | null; loading: boolean;
  } | null>(null);

  useEffect(() => {
    if (!city || !eligible) return;
    const controller = new AbortController();
    let current = true;
    setState({ key, data: null, error: null, loading: true });
    const params = new URLSearchParams({
      location_id: city.id,
      latitude: city.latitude.toFixed(4),
      longitude: city.longitude.toFixed(4),
      date, timezone: city.timezone,
    });
    apiFetch<WeatherResponse>(`/api/weather?${params}`, { signal: controller.signal })
      .then((data) => {
        if (!current) return;
        if (data.date !== date || data.location.timezone !== city.timezone || data.grounded !== true || !data.weather_token) {
          throw new ApiError({ code: 'weather_unavailable', status: 502, message: 'The forecast did not match your selected day and timezone.' });
        }
        setState({ key, data, error: null, loading: false });
      })
      .catch((error: unknown) => {
        if (current && !controller.signal.aborted) setState({ key, data: null, error: asApiError(error), loading: false });
      });
    return () => { current = false; controller.abort(); };
  }, [key, eligible, city, date]);

  const matching = eligible && state?.key === key ? state : null;
  return {
    data: matching?.data ?? null,
    error: matching?.error ?? null,
    loading: eligible && (matching?.loading ?? true),
    note: !city || !enabled ? null : !zoneMatches
      ? 'Weather needs the selected city’s timezone. Use that timezone again, or continue without weather.'
      : !inRange ? 'Forecasts are only available from today through the next 14 days. You can still make a ticket without weather.' : null,
  };
}
