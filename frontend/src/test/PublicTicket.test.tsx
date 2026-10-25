import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { PublicTicket } from '../components/PublicTicket';
import { JOKE_LABEL } from '../components/TicketContent';
import { displayTimestamp } from '../lib/dates';
import { created, deferred, failure, forecast, json, publicTicket, token } from './fixtures';

describe('recipient tickets', () => {
  it('uses the configured API base for loading, accepting and calendar downloads', async () => {
    const base = 'https://api.example/service';
    vi.stubEnv('VITE_API_BASE_URL', base);
    const mock = vi.fn().mockImplementation((path: string) => Promise.resolve(json(path.endsWith('/accept')
      ? { ticket_id: publicTicket.ticket_id, status: 'accepted', accepted_at: '2026-10-26T08:14:00.000Z', already_accepted: false }
      : publicTicket)));
    vi.stubGlobal('fetch', mock);
    render(<PublicTicket token={token} />);
    const accept = await screen.findByRole('button', { name: 'Accept this suggestion' });
    expect(mock).toHaveBeenCalledWith(`${base}/api/tickets/${token}`, expect.any(Object));
    expect(screen.getByRole('link', { name: /download calendar file/i })).toHaveAttribute('href', base + created.ics_path);
    expect(screen.getByRole('link', { name: /download calendar file/i })).toHaveAttribute('referrerpolicy', 'no-referrer');
    fireEvent.click(accept);
    await screen.findByRole('heading', { name: 'Suggestion accepted.' });
    expect(mock).toHaveBeenCalledWith(`${base}/api/tickets/${token}/accept`, expect.objectContaining({ method: 'POST' }));
  });

  it('loads the real public route without health calls or a mounted diorama', async () => {
    const pending = deferred<Response>();
    const mock = vi.fn(() => pending.promise);
    vi.stubGlobal('fetch', mock);
    window.history.replaceState(null, '', `/t/${token}`);
    render(<App />);
    expect(screen.getByRole('status')).toHaveTextContent(/opening your raincheck/i);
    expect(document.querySelector('canvas')).not.toBeInTheDocument();
    await act(async () => pending.resolve(json(publicTicket)));
    expect(screen.getByText(publicTicket.message)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Accept this suggestion' })).toBeEnabled();
    expect(mock).toHaveBeenCalledTimes(1);
    expect(mock).toHaveBeenCalledWith(`/api/tickets/${token}`, expect.any(Object));
    expect(screen.getByRole('link', { name: /download calendar file/i })).toHaveAttribute('href', created.ics_path);
    expect(screen.getAllByText(/calendar availability.*not been checked or confirmed/i)).toHaveLength(2);
    expect(screen.getByText(/ticket expires/i)).toHaveTextContent(displayTimestamp(created.expires_at));
  });
  it.each([false, true])('accepts suggestions, including a repeated idempotent response (%s), with the original timestamp', async (alreadyAccepted) => {
    const acceptedAt = '2026-10-26T08:14:00.000Z';
    const mock = vi.fn().mockImplementation((path: string) => Promise.resolve(json(path.endsWith('/accept')
      ? { ticket_id: publicTicket.ticket_id, status: 'accepted', accepted_at: acceptedAt, already_accepted: alreadyAccepted }
      : publicTicket)));
    vi.stubGlobal('fetch', mock);
    render(<PublicTicket token={token} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Accept this suggestion' }));
    expect(await screen.findByRole('heading', { name: 'Suggestion accepted.' })).toBeInTheDocument();
    expect(screen.getByText(`Accepted ${displayTimestamp(acceptedAt)}`)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Accept this suggestion' })).not.toBeInTheDocument();
    expect(mock.mock.calls[1]).toEqual([`/api/tickets/${token}/accept`, expect.objectContaining({ method: 'POST', body: undefined })]);
    expect(screen.getAllByText(/calendar availability.*not been checked or confirmed/i)).toHaveLength(2);
    expect(screen.getByRole('status')).toHaveTextContent(alreadyAccepted ? /original acceptance time is unchanged/i : /no calendar has been updated/i);
  });
  it('renders an already accepted ticket without a second acceptance request', async () => {
    const mock = vi.fn().mockImplementation(() => Promise.resolve(json({ ...publicTicket, status: 'accepted', accepted_at: '2026-10-26T08:14:00.000Z' })));
    vi.stubGlobal('fetch', mock);
    render(<PublicTicket token={token} />);
    await screen.findByRole('heading', { name: 'Suggestion accepted.' });
    expect(screen.getByText(/original acceptance time is unchanged/i)).toBeInTheDocument();
    expect(mock).toHaveBeenCalledTimes(1);
  });
  it.each([
    [404, 'ticket_not_found', /lost in the post/i],
    [410, 'ticket_expired', /run its course/i],
  ])('shows a designed %s state without acceptance or download controls', async (status, code, heading) => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(failure(String(code), 'Ticket unavailable.', Number(status)))));
    render(<PublicTicket token={token} />);
    expect(await screen.findByRole('heading', { name: heading as RegExp })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /accept/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /download/i })).not.toBeInTheDocument();
  });
  it('retries a failed network lookup without fake ticket contents', async () => {
    const mock = vi.fn().mockRejectedValueOnce(new TypeError('offline')).mockImplementation(() => Promise.resolve(json(publicTicket)));
    vi.stubGlobal('fetch', mock);
    render(<PublicTicket token={token} />);
    expect(await screen.findByRole('heading', { name: /desk is out of reach/i })).toBeInTheDocument();
    expect(screen.queryByText(publicTicket.message)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try loading again' }));
    expect(await screen.findByText(publicTicket.message)).toBeInTheDocument();
    expect(mock).toHaveBeenCalledTimes(2);
  });
  it('allows an acceptance retry and handles expiry between reading and accepting', async () => {
    let accepts = 0;
    const mock = vi.fn().mockImplementation((path: string) => {
      if (!path.endsWith('/accept')) return Promise.resolve(json(publicTicket));
      accepts += 1;
      return accepts === 1 ? Promise.reject(new TypeError('offline')) : Promise.resolve(failure('ticket_expired', 'Expired.', 410));
    });
    vi.stubGlobal('fetch', mock);
    render(<PublicTicket token={token} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Accept this suggestion' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/try accepting again/i);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Accept this suggestion' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Accept this suggestion' }));
    expect(await screen.findByRole('heading', { name: /run its course/i })).toBeInTheDocument();
  });
  it('renders hostile text inertly, with a persistent joke label and only returned weather', async () => {
    const hostile = '<img src=x onerror="window.pwned=true"><script>alert(1)</script>';
    const weather = forecast();
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(json({
      ...publicTicket, message: hostile, theatrical: true, tone: 'theatrical',
      plan: { title: '<h1>Hostile title</h1>', details: hostile },
      weather: {
        date: weather.date, weather_code: 61, condition: 'Light rain', summary: weather.summary,
        temperature_min_c: 12.1, temperature_max_c: 17.8, precipitation_probability_max: 64,
        source: 'open-meteo', fetched_at: weather.source.fetched_at, attribution: weather.attribution,
      },
    }))));
    render(<PublicTicket token={token} />);
    expect(await screen.findByText(JOKE_LABEL)).toBeInTheDocument();
    expect(screen.getAllByText(hostile)).toHaveLength(2);
    expect(screen.getByText('<h1>Hostile title</h1>')).toBeInTheDocument();
    expect(document.querySelector('img')).not.toBeInTheDocument();
    expect(document.querySelector('script')).not.toBeInTheDocument();
    expect(screen.getByText(weather.summary)).toBeInTheDocument();
    expect(screen.getByText(/Weather data by Open-Meteo.com.*Fetched.*UTC/)).toBeInTheDocument();
  });
});
