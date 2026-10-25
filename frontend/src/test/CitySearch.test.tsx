import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CitySearch } from '../components/CitySearch';
import { deferred, failure, json, london, newYork } from './fixtures';

describe('debounced, abortable city search', () => {
  it('counts city queries in code points, including the two-character minimum and 80-character maximum', async () => {
    vi.useFakeTimers();
    const mock = vi.fn().mockImplementation(() => Promise.resolve(json({ results: [] })));
    vi.stubGlobal('fetch', mock);
    render(<CitySearch selected={null} onSelect={vi.fn()} onClear={vi.fn()} />);
    const input = screen.getByRole('searchbox');
    fireEvent.change(input, { target: { value: '𠮷' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(350); });
    expect(mock).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: '𠮷𠮷' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(350); });
    expect(mock).toHaveBeenCalledTimes(1);
    const query = '𠮷'.repeat(80);
    fireEvent.change(input, { target: { value: query + '𠮷' } });
    expect(input).toHaveValue(query);
    expect(input).toHaveAttribute('maxlength', '160');
    await act(async () => { await vi.advanceTimersByTimeAsync(350); });
    expect(mock).toHaveBeenCalledTimes(2);
    expect(new URL(mock.mock.calls[1][0], window.location.origin).searchParams.get('q')).toBe(query);
  });

  it('debounces typing and ignores an aborted lookup that returns after a later query', async () => {
    const old = deferred<Response>();
    const mock = vi.fn().mockImplementation((path: string) => path.includes('London')
      ? old.promise : Promise.resolve(json({ query: 'New York', results: [newYork], attribution: { text: 'Location search by Open-Meteo.com' } })));
    vi.stubGlobal('fetch', mock);
    const select = vi.fn();
    render(<CitySearch selected={null} onSelect={select} onClear={vi.fn()} />);
    const input = screen.getByRole('searchbox');
    fireEvent.change(input, { target: { value: 'Lo' } });
    fireEvent.change(input, { target: { value: 'London' } });
    expect(mock).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent(/looking for cities/i);
    await waitFor(() => expect(mock).toHaveBeenCalledTimes(1));
    fireEvent.change(input, { target: { value: 'New York' } });
    expect((mock.mock.calls[0][1] as RequestInit).signal?.aborted).toBe(true);
    const button = await screen.findByRole('button', { name: /New York, New York, United States/i });
    await act(async () => old.resolve(json({ query: 'London', results: [london], attribution: { text: 'Location search by Open-Meteo.com' } })));
    expect(screen.queryByRole('button', { name: /London, England/i })).not.toBeInTheDocument();
    fireEvent.click(button);
    expect(select).toHaveBeenCalledWith(newYork);
    expect(mock).toHaveBeenCalledTimes(2);
  });
  it('handles no results, lookup failure, retry, and Escape without requiring a city', async () => {
    const mock = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(json({ results: [], attribution: { text: 'Open-Meteo.com' } })))
      .mockImplementationOnce(() => Promise.resolve(failure('location_lookup_unavailable', 'City lookup is resting.', 502)))
      .mockImplementation(() => Promise.resolve(json({ results: [london], attribution: { text: 'Open-Meteo.com' } })));
    vi.stubGlobal('fetch', mock);
    render(<CitySearch selected={null} onSelect={vi.fn()} onClear={vi.fn()} />);
    const input = screen.getByRole('searchbox');
    fireEvent.change(input, { target: { value: 'Nowhere' } });
    expect(await screen.findByText(/no cities found/i)).toBeInTheDocument();
    fireEvent.change(input, { target: { value: 'London' } });
    expect(await screen.findByText(/City lookup is resting.*continue without a city/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry city search' }));
    await screen.findByRole('button', { name: /London, England/i });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('button', { name: /London, England/i })).not.toBeInTheDocument();
  });
});
