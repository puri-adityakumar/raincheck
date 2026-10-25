import { useEffect, useId, useState } from 'react';
import { apiFetch } from '../lib/api/client';
import type { LocationResult, LocationsResponse } from '../lib/api/types';
import { asApiError } from '../lib/errors';
import { limitText, textLength } from '../lib/text';

export function cityLabel(city: LocationResult): string {
  return [city.name, city.admin1, city.country].filter(Boolean).join(', ');
}

export function CitySearch({ selected, onSelect, onClear }: {
  selected: LocationResult | null;
  onSelect: (city: LocationResult) => void;
  onClear: () => void;
}) {
  const id = useId();
  const [query, setQuery] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const [state, setState] = useState<{
    query: string; status: 'loading' | 'done' | 'error';
    data?: LocationsResponse; message?: string;
  } | null>(null);
  const normalized = query.trim();
  const length = textLength(normalized);
  const searching = !selected && length >= 2 && length <= 80 && !dismissed;

  useEffect(() => {
    if (!searching) return;
    const controller = new AbortController();
    let current = true;
    setState({ query: normalized, status: 'loading' });
    const timer = window.setTimeout(() => {
      apiFetch<LocationsResponse>(`/api/locations/search?${new URLSearchParams({ q: normalized, limit: '5' })}`, { signal: controller.signal })
        .then((data) => {
          if (current) setState({ query: normalized, status: 'done', data });
        })
        .catch((error: unknown) => {
          if (current && !controller.signal.aborted) setState({ query: normalized, status: 'error', message: asApiError(error).message });
        });
    }, 300);
    return () => {
      current = false;
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [normalized, searching, attempt]);

  const visible = searching && state?.query === normalized ? state : null;
  return (
    <div className="city-search">
      <label htmlFor={`${id}-city`}>City <span className="optional">optional</span></label>
      <input id={`${id}-city`} type="search" autoComplete="off" maxLength={160} value={selected ? cityLabel(selected) : query}
        aria-describedby={`${id}-help`} onKeyDown={(event) => {
          if (event.key === 'Escape') setDismissed(true);
        }} onChange={(event) => {
          setQuery(limitText(event.target.value, 80));
          setDismissed(false);
          if (selected) onClear();
        }} placeholder="Search for a city, not an address" />
      <p id={`${id}-help`} className="field-hint">Choose a result to use its city and timezone. Or leave this blank.</p>
      {selected && <div className="selected-city">
        <p className="metadata">Selected city · {selected.timezone}</p>
        <button type="button" className="text-button" onClick={() => { setQuery(''); onClear(); }}>Remove city</button>
      </div>}
      <div role="status" className="search-status">
        {searching && (!visible || visible.status === 'loading') && <p>Looking for cities…</p>}
        {visible?.status === 'error' && <p>{visible.message} You can continue without a city.</p>}
        {visible?.status === 'done' && visible.data?.results.length === 0 && <p>No cities found. Try a nearby city, or leave it blank.</p>}
      </div>
      {visible?.status === 'error' && <button type="button" className="text-button" onClick={() => setAttempt((value) => value + 1)}>Retry city search</button>}
      {visible?.status === 'done' && visible.data && visible.data.results.length > 0 && (
        <div className="search-results">
          <ul aria-label="City search results">
            {visible.data.results.map((city) => <li key={city.id}>
              <button type="button" onClick={() => { onSelect(city); setQuery(''); }}>
                <span>{cityLabel(city)}</span><span className="metadata">{city.timezone}</span>
              </button>
            </li>)}
          </ul>
          <p className="metadata">{visible.data.attribution.text}</p>
        </div>
      )}
    </div>
  );
}
