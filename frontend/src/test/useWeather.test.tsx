import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useWeather } from '../lib/useWeather';
import { day, deferred, forecast, json, london, newYork } from './fixtures';

describe('weather proof lifecycle', () => {
  it('drops a previous city proof immediately and ignores its late refresh after selecting another city', async () => {
    const late = deferred<Response>();
    let count = 0;
    const mock = vi.fn().mockImplementation((path: string) => {
      count += 1;
      const url = new URL(path, window.location.origin);
      if (count === 2) return late.promise;
      return Promise.resolve(json(forecast(day, url.searchParams.get('location_id') === london.id ? london : newYork, count === 1 ? 'wxs_london' : 'wxs_ny')));
    });
    vi.stubGlobal('fetch', mock);
    const { result, rerender } = renderHook(({ city, revision }) => useWeather(city, day, city.timezone, true, revision), { initialProps: { city: london, revision: 0 } });
    await waitFor(() => expect(result.current.data?.weather_token).toBe('wxs_london'));
    rerender({ city: london, revision: 1 });
    expect(result.current.data).toBeNull();
    expect(result.current.loading).toBe(true);
    rerender({ city: newYork, revision: 1 });
    expect(result.current.data).toBeNull();
    await waitFor(() => expect(result.current.data?.weather_token).toBe('wxs_ny'));
    await act(async () => late.resolve(json(forecast(day, london, 'wxs_stale'))));
    expect(result.current.data?.weather_token).toBe('wxs_ny');
    expect((mock.mock.calls[1][1] as RequestInit).signal?.aborted).toBe(true);
  });
  it('rejects a mismatched forecast instead of attaching an ungrounded token', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(json(forecast('2000-01-01')))));
    const { result } = renderHook(() => useWeather(london, day, london.timezone, true, 0));
    await waitFor(() => expect(result.current.error?.code).toBe('weather_unavailable'));
    expect(result.current.data).toBeNull();
  });
});
