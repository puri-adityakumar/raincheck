import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Composer } from '../components/Composer';
import { JOKE_LABEL } from '../components/TicketContent';
import type { CreateTicketRequest } from '../lib/api/types';
import { addDays } from '../lib/dates';
import { created, day, deferred, failure, forecast, json, london } from './fixtures';

function write(value = 'I need to move our coffee. Could we try tomorrow?') {
  fireEvent.change(screen.getByLabelText('Your note'), { target: { value } });
}
function gates() {
  fireEvent.click(screen.getByRole('checkbox', { name: /read and reviewed the current/i }));
  fireEvent.click(screen.getByRole('checkbox', { name: /anyone with the link/i }));
}
function shareButton() { return screen.getByRole('button', { name: /^create.*share ticket/i }); }
function mockCreate(extra?: (path: string, init?: RequestInit) => Promise<Response> | undefined) {
  const mock = vi.fn().mockImplementation((path: string, init?: RequestInit) => {
    const custom = extra?.(path, init);
    if (custom) return custom;
    if (path === '/api/tickets') {
      const body = JSON.parse(String(init?.body)) as CreateTicketRequest;
      return Promise.resolve(json({ ...created, proposed: body.proposed, labels: { theatrical: body.tone === 'theatrical', availability_confirmed: false } }, 201));
    }
    throw new Error(`Unexpected fixture request: ${path}`);
  });
  vi.stubGlobal('fetch', mock);
  return mock;
}
async function selectLondon() {
  fireEvent.change(screen.getByRole('searchbox', { name: /city/i }), { target: { value: 'London' } });
  fireEvent.click(await screen.findByRole('button', { name: /London, England, United Kingdom/i }));
}

describe('manual writing and explicit sharing', () => {
  it.each([
    ['Their name (optional)', 40], ['Your name (optional)', 40],
    ['What were the plans? (optional)', 80], ['Plan details (optional)', 400],
    ['Anything to help with drafting? (optional)', 400], ['Your note', 1200],
  ])('allows the full code-point limit and bounds editing for %s', (label, max) => {
    render(<Composer aiAvailable={false} />);
    write();
    const input = screen.getByLabelText(label);
    const value = '𠮷'.repeat(Number(max));
    fireEvent.change(input, { target: { value } });
    expect(input).toHaveValue(value);
    expect(input).toHaveAttribute('maxlength', String(Number(max) * 2));
    fireEvent.blur(input);
    expect(input).toHaveAttribute('aria-invalid', 'false');
    gates();
    expect(shareButton()).toBeEnabled();
    if (label === 'Your note') expect(screen.getByText(/^1200 \/ 1,200/)).toBeInTheDocument();
    fireEvent.change(input, { target: { value: value + '𠮷' } });
    expect(input).toHaveValue(value);
    expect(shareButton()).toBeDisabled();
  });

  it('accepts a 700-code-point API draft and counts it without UTF-16 inflation', async () => {
    const message = '𠮷'.repeat(700);
    mockCreate((path) => path === '/api/generate' ? Promise.resolve(json({
      message, labels: { is_ai_generated: true, is_sample: false },
    })) : undefined);
    render(<Composer aiAvailable />);
    fireEvent.click(screen.getByRole('button', { name: /try AI drafting/i }));
    await waitFor(() => expect(screen.getByLabelText('Your note')).toHaveValue(message));
    expect(screen.getByText(/^700 \/ 1,200/)).toBeInTheDocument();
    gates();
    expect(shareButton()).toBeEnabled();
  });

  it('rejects an API draft beyond 700 code points without replacing current writing', async () => {
    mockCreate((path) => path === '/api/generate' ? Promise.resolve(json({
      message: '𠮷'.repeat(701), labels: { is_ai_generated: true, is_sample: false },
    })) : undefined);
    render(<Composer aiAvailable />);
    write('Keep this note.');
    fireEvent.click(screen.getByRole('button', { name: /try AI drafting/i }));
    await screen.findByText(/drafting returned an unusable note/i);
    expect(screen.getByLabelText('Your note')).toHaveValue('Keep this note.');
  });

  it('uses the API base for creation and ICS, but the frontend origin for recipient links', async () => {
    const base = 'https://api.example/service';
    vi.stubEnv('VITE_API_BASE_URL', base + '/');
    const mock = mockCreate((path) => path === `${base}/api/tickets` ? Promise.resolve(json(created, 201)) : undefined);
    render(<Composer aiAvailable={false} />);
    write(); gates(); fireEvent.click(shareButton());
    await screen.findByRole('heading', { name: 'A kinder next chapter.' });
    expect(mock).toHaveBeenCalledWith(`${base}/api/tickets`, expect.objectContaining({ method: 'POST' }));
    expect(screen.getByRole('link', { name: /download calendar file/i })).toHaveAttribute('href', base + created.ics_path);
    expect(screen.getByRole('link', { name: /download calendar file/i })).toHaveAttribute('referrerpolicy', 'no-referrer');
    expect(screen.getByLabelText('Your share link')).toHaveValue(window.location.origin + created.share_path);
    expect(screen.getByRole('link', { name: 'Open ticket' })).toHaveAttribute('href', created.share_path);
  });

  it('requires valid current text, review, and separate link consent; all edits clear both gates', () => {
    mockCreate();
    render(<Composer aiAvailable={false} />);
    expect(shareButton()).toBeDisabled();
    write();
    expect(shareButton()).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: /read and reviewed the current/i }));
    expect(shareButton()).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: /anyone with the link/i }));
    expect(shareButton()).toBeEnabled();
    write('This is the revised, current message.');
    expect(shareButton()).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: /read and reviewed the current/i })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: /anyone with the link/i })).not.toBeChecked();
    gates();
    fireEvent.change(screen.getByLabelText('Start time'), { target: { value: '16:30' } });
    expect(shareButton()).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: /read and reviewed the current/i })).not.toBeChecked();
    gates();
    write('   ');
    fireEvent.blur(screen.getByLabelText('Your note'));
    expect(screen.getByLabelText('Your note')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText(/write a plain-text note between/i)).toBeInTheDocument();
    expect(shareButton()).toBeDisabled();
  });
  it('keeps user text on typed 503 and creates a real group ticket with the exact contract body', async () => {
    const mock = mockCreate((path) => path === '/api/generate' ? Promise.resolve(failure('ai_unavailable', 'Drafting is not configured.', 503, { reason: 'not_configured' })) : undefined);
    render(<Composer aiAvailable={false} />);
    fireEvent.change(screen.getByLabelText('Who is it for?'), { target: { value: 'group' } });
    fireEvent.change(screen.getByLabelText('Their name (optional)'), { target: { value: '  Friends  ' } });
    fireEvent.change(screen.getByLabelText('Your name (optional)'), { target: { value: ' Alex ' } });
    fireEvent.change(screen.getByLabelText('What were the plans? (optional)'), { target: { value: ' Coffee ' } });
    fireEvent.change(screen.getByLabelText('Plan details (optional)'), { target: { value: ' At the corner. ' } });
    fireEvent.change(screen.getByLabelText('Anything to help with drafting? (optional)'), { target: { value: 'Private drafting-only context' } });
    fireEvent.change(screen.getByLabelText('Timezone'), { target: { value: 'UTC' } });
    fireEvent.change(screen.getByLabelText('Replacement date'), { target: { value: day } });
    fireEvent.change(screen.getByLabelText('End time (optional)'), { target: { value: '16:00' } });
    write('  A real user-written note.\nCould we try tomorrow?  ');
    fireEvent.click(screen.getByRole('button', { name: /try AI drafting/i }));
    expect(await screen.findByText(/write your own note below.*still make a ticket/i)).toBeInTheDocument();
    expect(screen.getByLabelText('Your note')).toHaveValue('  A real user-written note.\nCould we try tomorrow?  ');
    const generateBody = JSON.parse(mock.mock.calls.find(([path]) => path === '/api/generate')?.[1].body as string);
    expect(generateBody.context).toBe('Private drafting-only context');
    gates();
    fireEvent.click(shareButton());
    expect(await screen.findByRole('heading', { name: 'A kinder next chapter.' })).toBeInTheDocument();
    const request = mock.mock.calls.find(([path]) => path === '/api/tickets');
    expect(JSON.parse(request?.[1].body as string)).toEqual({
      message: 'A real user-written note.\nCould we try tomorrow?',
      recipient: { relationship: 'group', display_name: 'Friends' }, sender_name: 'Alex', tone: 'honest',
      plan: { title: 'Coffee', details: 'At the corner.' },
      proposed: { date: day, start_time: '15:00', end_time: '16:00', timezone: 'UTC', location_label: null },
      weather_token: null, reviewed: true,
    });
    expect(screen.getByLabelText('Your share link')).toHaveValue(window.location.origin + created.share_path);
    expect(screen.getByRole('link', { name: /download calendar file/i })).toHaveAttribute('href', created.ics_path);
    expect(screen.getByRole('link', { name: 'Open ticket' })).toHaveAttribute('href', created.share_path);
    expect(screen.getByText(/no calendar is updated/i)).toBeInTheDocument();
  });
  it('does not fake clipboard success and provides a selected manual-copy field', async () => {
    mockCreate();
    const clipboard = vi.fn().mockRejectedValue(new Error('denied'));
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: clipboard } });
    render(<Composer aiAvailable={false} />);
    write(); gates(); fireEvent.click(shareButton());
    fireEvent.click(await screen.findByRole('button', { name: 'Copy link' }));
    expect(await screen.findByText(/clipboard unavailable.*copy it manually/i)).toBeInTheDocument();
    expect(screen.queryByText(/link copied/i)).not.toBeInTheDocument();
    const input = screen.getByLabelText('Your share link') as HTMLInputElement;
    expect(input).toHaveFocus();
    expect(input.selectionEnd).toBe(input.value.length);
    expect(clipboard).toHaveBeenCalledWith(window.location.origin + created.share_path);
  });
  it('reports clipboard success only after writeText resolves', async () => {
    mockCreate();
    const pending = deferred<void>();
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn(() => pending.promise) } });
    render(<Composer aiAvailable={false} />);
    write(); gates(); fireEvent.click(shareButton());
    fireEvent.click(await screen.findByRole('button', { name: 'Copy link' }));
    expect(screen.queryByText(/link copied/i)).not.toBeInTheDocument();
    await act(async () => pending.resolve());
    expect(screen.getByText(/link copied/i)).toBeInTheDocument();
  });
  it('creates a new version instead of silently editing the old shared ticket', async () => {
    const mock = mockCreate();
    render(<Composer aiAvailable={false} />);
    write(); gates(); fireEvent.click(shareButton());
    fireEvent.click(await screen.findByRole('button', { name: 'Edit as a new ticket' }));
    expect(screen.getByText(/previous link is unchanged/i)).toBeInTheDocument();
    expect(screen.getByLabelText('Your note')).toHaveValue('I need to move our coffee. Could we try tomorrow?');
    expect(shareButton()).toBeDisabled();
    gates(); write('An updated note.'); gates(); fireEvent.click(shareButton());
    await screen.findByRole('heading', { name: 'A kinder next chapter.' });
    expect(mock.mock.calls.filter(([path]) => path === '/api/tickets')).toHaveLength(2);
    expect(mock.mock.calls.every(([, init]) => init.method === 'POST')).toBe(true);
  });
  it('persists the theatrical disclaimer through writing, preview, and sharing', async () => {
    mockCreate();
    render(<Composer aiAvailable={false} />);
    fireEvent.click(screen.getByRole('radio', { name: /theatrical/i }));
    write('The moon has requisitioned my afternoon. Another time?');
    expect(screen.getAllByText(JOKE_LABEL).length).toBeGreaterThanOrEqual(2);
    gates(); fireEvent.click(shareButton());
    await screen.findByRole('heading', { name: 'A kinder next chapter.' });
    expect(screen.getAllByText(JOKE_LABEL)).toHaveLength(2);
  });
  it('shows accessible validation and actionable server date/DST errors without losing the note', async () => {
    const mock = mockCreate((path) => path === '/api/tickets' ? Promise.resolve(failure('invalid_local_time', 'Invalid local time.', 422, { fields: [{ path: 'proposed.start_time', message: 'This time falls in a DST gap.' }] })) : undefined);
    render(<Composer aiAvailable={false} />);
    write();
    fireEvent.change(screen.getByLabelText('End time (optional)'), { target: { value: '14:00' } });
    fireEvent.blur(screen.getByLabelText('End time (optional)'));
    expect(screen.getByText('End time must be after the start, on the same day.')).toBeInTheDocument();
    expect(screen.getByLabelText('End time (optional)')).toHaveAttribute('aria-invalid', 'true');
    gates(); expect(shareButton()).toBeDisabled();
    fireEvent.change(screen.getByLabelText('End time (optional)'), { target: { value: '' } });
    gates(); fireEvent.click(shareButton());
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/clocks change/i);
    expect(alert).toHaveFocus();
    expect(screen.getByLabelText('Start time')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Your note')).toHaveValue('I need to move our coffee. Could we try tomorrow?');
    expect(mock).toHaveBeenCalledTimes(1);
  });
  it('ignores an AI response after a relevant edit rather than overwriting current writing', async () => {
    const pending = deferred<Response>();
    mockCreate((path) => path === '/api/generate' ? pending.promise : undefined);
    render(<Composer aiAvailable />);
    fireEvent.click(screen.getByRole('button', { name: /try AI drafting/i }));
    write('New user text while drafting was pending.');
    await act(async () => pending.resolve(json({
      message: 'Old model text', labels: { is_ai_generated: true, is_sample: false },
    })));
    expect(screen.getByLabelText('Your note')).toHaveValue('New user text while drafting was pending.');
    expect(screen.queryByText('Old model text')).not.toBeInTheDocument();
  });
  it('uses only returned AI text as an editable draft and requires a fresh review', async () => {
    mockCreate((path) => path === '/api/generate' ? Promise.resolve(json({
      generation_id: 'gen_123', message: 'A fixture draft from the mocked API, not a live model.',
      tone: 'honest', labels: { is_ai_generated: true, is_sample: false, theatrical: false, availability_confirmed: false },
      review_required: true, max_length: 1200, disclosures: ['AI-drafted. Read and edit before sharing.'], created_at: created.created_at,
    })) : undefined);
    render(<Composer aiAvailable />);
    write('My previous note.'); gates();
    fireEvent.click(screen.getByRole('button', { name: /try AI drafting/i }));
    await waitFor(() => expect(screen.getByLabelText('Your note')).toHaveValue('A fixture draft from the mocked API, not a live model.'));
    expect(screen.getByText(/AI-drafted · read and edit before sharing/i)).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /read and reviewed/i })).not.toBeChecked();
    expect(shareButton()).toBeDisabled();
    expect(screen.getByLabelText('Your note')).toHaveFocus();
  });
  it('rejects unsafe returned share paths rather than opening external links', async () => {
    mockCreate((path) => path === '/api/tickets' ? Promise.resolve(json({ ...created, share_path: '//evil.example/steal' }, 201)) : undefined);
    render(<Composer aiAvailable={false} />);
    write(); gates(); fireEvent.click(shareButton());
    expect(await screen.findByRole('alert')).toHaveTextContent(/unsafe ticket link/i);
    expect(screen.queryByLabelText('Your share link')).not.toBeInTheDocument();
  });
});

describe('city-bound, optional weather', () => {
  function weatherMock(weatherHandler?: (url: URL) => Promise<Response>) {
    return mockCreate((path) => {
      if (path.startsWith('/api/locations/search')) return Promise.resolve(json({ query: 'London', results: [london], attribution: { text: 'Location search by Open-Meteo.com', url: 'https://open-meteo.com/' } }));
      if (path.startsWith('/api/weather')) {
        const url = new URL(path, window.location.origin);
        return weatherHandler ? weatherHandler(url) : Promise.resolve(json(forecast(url.searchParams.get('date') ?? day)));
      }
    });
  }
  it('requests authoritative city id, rounded coordinates, returned timezone, and day; shares only the proof', async () => {
    const mock = weatherMock();
    render(<Composer aiAvailable={false} />);
    await selectLondon();
    await waitFor(() => expect(screen.getAllByText(/Light rain, 12–18°C/i)).toHaveLength(2));
    expect(screen.getByLabelText('Timezone')).toHaveValue('Europe/London');
    const url = new URL(mock.mock.calls.find(([path]) => path.startsWith('/api/weather'))?.[0] as string, window.location.origin);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      location_id: london.id, latitude: '51.5085', longitude: '-0.1257',
      date: (screen.getByLabelText('Replacement date') as HTMLInputElement).value, timezone: london.timezone,
    });
    expect(screen.getAllByText(/Weather data by Open-Meteo.com.*Fetched.*UTC/)).toHaveLength(2);
    write(); gates(); fireEvent.click(shareButton());
    await screen.findByRole('heading', { name: 'A kinder next chapter.' });
    const body = JSON.parse(mock.mock.calls.find(([path]) => path === '/api/tickets')?.[1].body as string);
    expect(body.weather_token).toBe('wxs_test-proof');
    expect(body.proposed.location_label).toBe('London, England, United Kingdom');
    expect(body).not.toHaveProperty('latitude');
    expect(body).not.toHaveProperty('weather');
  });
  it('invalidates weather immediately on date changes, ignores late responses, and allows lookup failure without a proof', async () => {
    const stale = deferred<Response>();
    let requests = 0;
    const mock = weatherMock((url) => {
      requests += 1;
      if (requests === 1) return Promise.resolve(json(forecast(url.searchParams.get('date') ?? day)));
      if (requests === 2) return stale.promise;
      return Promise.resolve(failure('weather_unavailable', 'Forecast lookup failed.', 502));
    });
    render(<Composer aiAvailable={false} />);
    await selectLondon();
    await screen.findAllByText(/Light rain, 12–18°C/i);
    write(); gates();
    const currentDay = (screen.getByLabelText('Replacement date') as HTMLInputElement).value;
    fireEvent.change(screen.getByLabelText('Replacement date'), { target: { value: addDays(currentDay, 1) } });
    expect(screen.queryByText(/Light rain, 12–18°C/i)).not.toBeInTheDocument();
    expect(screen.getByText(/fetching weather/i)).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /read and reviewed/i })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Replacement date'), { target: { value: addDays(currentDay, 2) } });
    await screen.findByText(/Forecast lookup failed.*No weather is attached/i);
    await act(async () => stale.resolve(json(forecast(addDays(currentDay, 1), london, 'wxs_stale'))));
    expect(screen.queryByText(/Light rain, 12–18°C/i)).not.toBeInTheDocument();
    gates(); fireEvent.click(shareButton());
    await screen.findByRole('heading', { name: 'A kinder next chapter.' });
    const body = JSON.parse(mock.mock.calls.find(([path]) => path === '/api/tickets')?.[1].body as string);
    expect(body.weather_token).toBeNull();
  });
  it('invalidates on timezone or city removal and never requests city weather with an unrelated timezone', async () => {
    const mock = weatherMock();
    render(<Composer aiAvailable={false} />);
    await selectLondon(); await screen.findAllByText(/Light rain, 12–18°C/i);
    write(); gates();
    fireEvent.change(screen.getByLabelText('Timezone'), { target: { value: 'Asia/Tokyo' } });
    expect(screen.queryByText(/Light rain, 12–18°C/i)).not.toBeInTheDocument();
    expect(screen.getByText(/weather needs the selected city’s timezone/i)).toBeInTheDocument();
    expect(mock.mock.calls.filter(([path]) => path.startsWith('/api/weather'))).toHaveLength(1);
    gates();
    fireEvent.click(screen.getByRole('button', { name: 'Remove city' }));
    expect(screen.getByRole('checkbox', { name: /read and reviewed/i })).not.toBeChecked();
    gates(); fireEvent.click(shareButton());
    await screen.findByRole('heading', { name: 'A kinder next chapter.' });
    const body = JSON.parse(mock.mock.calls.find(([path]) => path === '/api/tickets')?.[1].body as string);
    expect(body.weather_token).toBeNull();
    expect(body.proposed.location_label).toBeNull();
  });
  it('does not request or invent a forecast beyond 14 days', async () => {
    const mock = weatherMock();
    render(<Composer aiAvailable={false} />);
    fireEvent.change(screen.getByLabelText('Replacement date'), { target: { value: addDays(day, 20) } });
    await selectLondon();
    expect(screen.getByText(/forecasts are only available.*14 days/i)).toBeInTheDocument();
    expect(mock.mock.calls.filter(([path]) => path.startsWith('/api/weather'))).toHaveLength(0);
    write(); gates(); expect(shareButton()).toBeEnabled();
  });
  it('lets an expired proof be removed or refreshed without losing the edited note', async () => {
    let creates = 0;
    const mock = weatherMock();
    mock.mockImplementation((path: string, init?: RequestInit) => {
      if (path.startsWith('/api/locations/search')) return Promise.resolve(json({ results: [london], attribution: { text: 'Location search by Open-Meteo.com', url: 'https://open-meteo.com/' } }));
      if (path.startsWith('/api/weather')) return Promise.resolve(json(forecast(new URL(path, window.location.origin).searchParams.get('date') ?? day)));
      if (path === '/api/tickets') {
        creates += 1;
        return Promise.resolve(creates === 1 ? failure('weather_token_invalid', 'Expired proof.', 422, { reason: 'expired' }) : json({ ...created, proposed: JSON.parse(String(init?.body)).proposed }, 201));
      }
      throw new Error('Unexpected fixture request');
    });
    render(<Composer aiAvailable={false} />);
    await selectLondon(); await screen.findAllByText(/Light rain, 12–18°C/i);
    write('Keep my carefully edited message.'); gates(); fireEvent.click(shareButton());
    expect(await screen.findByRole('alert')).toHaveTextContent(/weather proof.*expired/i);
    expect(screen.getByLabelText('Your note')).toHaveValue('Keep my carefully edited message.');
    expect(screen.getByRole('checkbox', { name: /include a real forecast/i })).not.toBeChecked();
    expect(shareButton()).toBeDisabled();
    expect(screen.getByRole('button', { name: /refresh and include weather/i })).toBeEnabled();
    gates(); fireEvent.click(shareButton());
    await screen.findByRole('heading', { name: 'A kinder next chapter.' });
    const bodies = mock.mock.calls.filter(([path]) => path === '/api/tickets').map(([, init]) => JSON.parse(String(init.body)));
    expect(bodies[0].weather_token).toBe('wxs_test-proof');
    expect(bodies[1].weather_token).toBeNull();
    expect(bodies[1].message).toBe('Keep my carefully edited message.');
  });
});
