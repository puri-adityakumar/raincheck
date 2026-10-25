import { useEffect, useRef, useState, type ReactNode } from 'react';
import { apiFetch, apiUrl, ApiError } from '../lib/api/client';
import type { CreateTicketRequest, CreateTicketResponse, GenerateRequest, GenerateResponse, LocationResult, ProposedTime, Relationship, Tone } from '../lib/api/types';
import { addDays, browserTimezone, displayTimestamp, todayIn, validDate, validTimezone } from '../lib/dates';
import { asApiError, errorExplanation, fieldErrors, ticketPaths } from '../lib/errors';
import { limitText, textLength } from '../lib/text';
import { useWeather } from '../lib/useWeather';
import { CitySearch, cityLabel } from './CitySearch';
import { TheatricalLabel, TicketContent, WeatherNote } from './TicketContent';

interface Draft {
  relationship: Relationship; recipient: string; sender: string; tone: Tone;
  title: string; details: string; context: string;
  date: string; start: string; end: string; timezone: string; message: string;
}

function initialDraft(): Draft {
  const timezone = browserTimezone();
  return {
    relationship: 'friend', recipient: '', sender: '', tone: 'honest',
    title: '', details: '', context: '', date: addDays(todayIn(timezone), 1),
    start: '15:00', end: '', timezone, message: '',
  };
}

const optional = (value: string) => value.trim() || null;
const hasControls = (value: string) => /[\u0000-\u0008\u000b-\u001f\u007f]/.test(value);

function validate(draft: Draft, needMessage: boolean): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!validTimezone(draft.timezone)) errors['proposed.timezone'] = 'Use an IANA timezone, such as Europe/London or America/New_York.';
  if (!validDate(draft.date)) errors['proposed.date'] = 'Choose a valid replacement date.';
  else if (validTimezone(draft.timezone)) {
    const today = todayIn(draft.timezone);
    if (draft.date < today || draft.date > addDays(today, 365)) errors['proposed.date'] = 'Choose a day between today and one year from today.';
  }
  const time = /^([01]\d|2[0-3]):[0-5]\d$/;
  if (!time.test(draft.start)) errors['proposed.start_time'] = 'Choose a valid start time.';
  if (draft.end && (!time.test(draft.end) || draft.end <= draft.start)) errors['proposed.end_time'] = 'End time must be after the start, on the same day.';
  for (const [key, value, max] of [
    ['recipient.display_name', draft.recipient, 40], ['sender_name', draft.sender, 40],
    ['plan.title', draft.title, 80], ['plan.details', draft.details, 400], ['context', draft.context, 400],
  ] as const) {
    if (textLength(value.trim()) > max || hasControls(value)) errors[key] = `Use plain text, up to ${max} characters.`;
  }
  if (needMessage && (!draft.message.trim() || textLength(draft.message.trim()) > 1200 || hasControls(draft.message))) {
    errors.message = 'Write a plain-text note between 1 and 1,200 characters, without control characters.';
  }
  return errors;
}

function Field({ name, label, children, hint, error }: { name: string; label: string; children: ReactNode; hint?: string; error?: string }) {
  return <div className="field">
    <label htmlFor={name}>{label}</label>
    {children}
    {hint && <p className="field-hint" id={`${name}-hint`}>{hint}</p>}
    {error && <p className="field-error" id={`${name}-error`}>{error}</p>}
  </div>;
}

function ShareConfirmation({ ticket, draft, proposed, weather, onEdit }: {
  ticket: CreateTicketResponse; draft: Draft; proposed: ProposedTime;
  weather: ReturnType<typeof useWeather>['data']; onEdit: () => void;
}) {
  const [copy, setCopy] = useState<'idle' | 'copying' | 'copied' | 'manual'>('idle');
  const link = useRef<HTMLInputElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const shareUrl = window.location.origin + ticket.share_path;
  useEffect(() => { heading.current?.focus(); }, []);
  async function copyLink() {
    setCopy('copying');
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(shareUrl);
      setCopy('copied');
    } catch {
      setCopy('manual');
      link.current?.focus();
      link.current?.select();
    }
  }
  return <div className="composer-page share-page">
    <div className="page-intro">
      <p className="eyebrow">Your raincheck is ready</p>
      <h1 tabIndex={-1} ref={heading}>A kinder next chapter.</h1>
      <p>Nothing has been sent. Share the link yourself, when you’re ready.</p>
    </div>
    <div className="composer-grid">
      <section className="share-tools paper-panel" aria-labelledby="share-title">
        <p className="eyebrow">One link, one little maybe</p>
        <h2 id="share-title">Pass it along.</h2>
        {draft.tone === 'theatrical' && <TheatricalLabel />}
        <label htmlFor="share-link">Your share link</label>
        <input ref={link} id="share-link" className="metadata" readOnly value={shareUrl} onFocus={(event) => event.currentTarget.select()} />
        <p className="field-hint">Anyone with this link can read the ticket. Keep it out of public places if the note is private.</p>
        <div className="button-row">
          <button className="primary-button" type="button" disabled={copy === 'copying'} onClick={() => void copyLink()}>{copy === 'copying' ? 'Copying…' : 'Copy link'}</button>
          <a className="secondary-button" href={ticket.share_path}>Open ticket</a>
        </div>
        <p role="status" className="copy-status">{copy === 'copied' ? 'Link copied. You choose where to share it.' : copy === 'manual' ? 'Clipboard unavailable. Select the link above and copy it manually.' : '\u00a0'}</p>
        <div className="share-download">
          <a className="secondary-button" href={apiUrl(ticket.ics_path)} referrerPolicy="no-referrer" download>Download calendar file (.ics)</a>
          <p className="small-note">Just a tentative file to download. No invite is sent and no calendar is updated.</p>
        </div>
        <p className="metadata">Expires {displayTimestamp(ticket.expires_at)}</p>
        <div className="edit-new">
          <h3>Want to change something?</h3>
          <p>The shared ticket stays exactly as it is. Start a new version with your current note; you’ll review and share a new link.</p>
          <button type="button" className="text-button" onClick={onEdit}>Edit as a new ticket</button>
        </div>
      </section>
      <TicketContent message={draft.message.trim()} proposed={proposed} theatrical={draft.tone === 'theatrical'} title={draft.title} recipient={draft.recipient} sender={draft.sender} weather={weather} />
    </div>
  </div>;
}

export function Composer({ aiAvailable }: { aiAvailable: boolean | null }) {
  const [draft, setDraft] = useState<Draft>(initialDraft);
  const [city, setCity] = useState<LocationResult | null>(null);
  const [includeWeather, setIncludeWeather] = useState(true);
  const [weatherRevision, setWeatherRevision] = useState(0);
  const [reviewed, setReviewed] = useState(false);
  const [consent, setConsent] = useState(false);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [attempted, setAttempted] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [serverFields, setServerFields] = useState<Record<string, string>>({});
  const [generating, setGenerating] = useState(false);
  const [creating, setCreating] = useState(false);
  const [generationError, setGenerationError] = useState<ApiError | null>(null);
  const [source, setSource] = useState<'manual' | 'ai' | 'sample'>('manual');
  const [created, setCreated] = useState<CreateTicketResponse | null>(null);
  const [hadShared, setHadShared] = useState(false);
  const dateEdited = useRef(false);
  const generation = useRef<AbortController | null>(null);
  const revision = useRef(0);
  const errorPanel = useRef<HTMLDivElement>(null);
  const note = useRef<HTMLTextAreaElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const alive = useRef(true);
  const weather = useWeather(city, draft.date, draft.timezone, includeWeather, weatherRevision);
  const errors = { ...validate(draft, true), ...serverFields };
  const valid = Object.keys(errors).length === 0;
  const proposed: ProposedTime = {
    date: draft.date, start_time: draft.start, end_time: optional(draft.end), timezone: draft.timezone,
    location_label: weather.data?.location.label ?? (city ? cityLabel(city) : null),
  };
  const request: GenerateRequest = {
    recipient: { relationship: draft.relationship, display_name: optional(draft.recipient) },
    tone: draft.tone, plan: { title: optional(draft.title), details: optional(draft.details) },
    proposed, sender_name: optional(draft.sender), weather_token: weather.data?.weather_token ?? null,
    context: optional(draft.context),
  };

  useEffect(() => {
    alive.current = true;
    heading.current?.focus();
    return () => { alive.current = false; generation.current?.abort(); };
  }, []);
  useEffect(() => { if (error) errorPanel.current?.focus(); }, [error]);

  function invalidate() {
    revision.current += 1;
    generation.current?.abort();
    setGenerating(false);
    setReviewed(false);
    setConsent(false);
    setError(null);
    setServerFields({});
    setGenerationError(null);
  }
  function update<K extends keyof Draft>(key: K, value: Draft[K]) {
    invalidate();
    if (key === 'date') dateEdited.current = true;
    setDraft((current) => {
      const next = { ...current, [key]: value };
      if (key === 'timezone' && !dateEdited.current && validTimezone(String(value))) next.date = addDays(todayIn(String(value)), 1);
      return next;
    });
  }
  function selectCity(value: LocationResult) {
    invalidate();
    setCity(value);
    setDraft((current) => ({
      ...current, timezone: value.timezone,
      date: dateEdited.current ? current.date : addDays(todayIn(value.timezone), 1),
    }));
  }
  function refreshWeather() {
    invalidate();
    setWeatherRevision((value) => value + 1);
  }
  function fieldProps(name: string) {
    const visible = Boolean(errors[name] && (touched[name] || attempted || serverFields[name]));
    return {
      id: name, name, 'aria-invalid': visible,
      'aria-describedby': [['plan.details', 'context', 'proposed.date', 'proposed.timezone', 'message'].includes(name) ? `${name}-hint` : '', visible ? `${name}-error` : ''].filter(Boolean).join(' ') || undefined,
      onBlur: () => setTouched((current) => ({ ...current, [name]: true })),
    };
  }
  function visibleError(name: string) { return touched[name] || attempted || serverFields[name] ? errors[name] : undefined; }
  function focusFirst(fields: Record<string, string>) {
    const first = Object.keys(fields)[0];
    window.requestAnimationFrame(() => document.getElementById(first)?.focus());
  }
  async function generate() {
    const fields = validate(draft, false);
    if (Object.keys(fields).length) { setAttempted(true); focusFirst(fields); return; }
    generation.current?.abort();
    const controller = new AbortController();
    generation.current = controller;
    const version = revision.current;
    setGenerating(true);
    setGenerationError(null);
    try {
      const data = await apiFetch<GenerateResponse>('/api/generate', { method: 'POST', body: request, signal: controller.signal });
      if (controller.signal.aborted || revision.current !== version || !alive.current) return;
      if (!data.message?.trim() || textLength(data.message) > 700 || hasControls(data.message)) throw new ApiError({ code: 'generation_failed', status: 502, message: 'Drafting returned an unusable note. Write your own, or try again.' });
      setDraft((current) => ({ ...current, message: data.message }));
      setSource(data.labels.is_sample ? 'sample' : data.labels.is_ai_generated ? 'ai' : 'manual');
      setReviewed(false); setConsent(false); setError(null); setServerFields({});
      note.current?.focus();
    } catch (caught) {
      if (!controller.signal.aborted && revision.current === version && alive.current) {
        const failure = asApiError(caught);
        setGenerationError(failure);
        setServerFields(fieldErrors(failure));
        note.current?.focus();
      }
    } finally {
      if (revision.current === version && alive.current) setGenerating(false);
    }
  }
  async function createTicket() {
    const fields = validate(draft, true);
    setAttempted(true);
    if (Object.keys(fields).length) { focusFirst(fields); return; }
    if (!reviewed || !consent || creating || generating || weather.loading) return;
    setCreating(true); setError(null);
    const { context: _context, ...shared } = request;
    void _context; // Private drafting context never belongs in a ticket request.
    const body: CreateTicketRequest = { ...shared, message: draft.message.trim(), reviewed: true };
    try {
      const ticket = await apiFetch<CreateTicketResponse>('/api/tickets', { method: 'POST', body });
      if (!alive.current) return;
      if (!ticketPaths(ticket.share_path, ticket.ics_path)) throw new ApiError({ code: 'invalid_response', status: 502, message: 'The desk returned an unsafe ticket link. No link was opened. Please try again.' });
      setCreated(ticket);
      setHadShared(true);
    } catch (caught) {
      if (!alive.current) return;
      const failure = asApiError(caught);
      setError(failure);
      setServerFields(fieldErrors(failure));
      if (failure.code === 'weather_token_invalid') {
        setIncludeWeather(false); setReviewed(false); setConsent(false);
      }
    } finally { if (alive.current) setCreating(false); }
  }

  if (created) return <ShareConfirmation ticket={created} draft={draft} proposed={created.proposed} weather={weather.data} onEdit={() => {
    setCreated(null); invalidate(); setAttempted(false);
    window.requestAnimationFrame(() => document.getElementById('composer-title')?.focus());
  }} />;

  const today = validTimezone(draft.timezone) ? todayIn(draft.timezone) : undefined;
  return <div className="composer-page">
    <div className="page-intro">
      <p className="eyebrow">The writing desk / nothing sent automatically</p>
      <h1 id="composer-title" ref={heading} tabIndex={-1}>A small change of plans.</h1>
      <p>Keep it honest. Make it yours. Offer one concrete next time.</p>
      {hadShared && <p className="notice">You’re making a new ticket. The previous link is unchanged.</p>}
    </div>
    <div className="composer-grid">
      <form className="composer-form" noValidate onSubmit={(event) => { event.preventDefault(); void createTicket(); }}>
        <fieldset disabled={creating}>
          <legend className="section-legend"><span>01</span> A little context</legend>
          <div className="section-content">
            <Field name="relationship" label="Who is it for?">
              <select id="relationship" value={draft.relationship} onChange={(event) => update('relationship', event.target.value as Relationship)}>
                {(['friend', 'group', 'coworker', 'family', 'date', 'neighbor', 'other'] as const).map((value) => <option key={value} value={value}>{value === 'group' ? 'A group' : value.charAt(0).toUpperCase() + value.slice(1)}</option>)}
              </select>
            </Field>
            <div className="field-pair">
              <Field name="recipient.display_name" label="Their name (optional)" error={visibleError('recipient.display_name')}>
                <input {...fieldProps('recipient.display_name')} autoComplete="off" maxLength={80} value={draft.recipient} onChange={(event) => update('recipient', limitText(event.target.value, 40))} />
              </Field>
              <Field name="sender_name" label="Your name (optional)" error={visibleError('sender_name')}>
                <input {...fieldProps('sender_name')} autoComplete="off" maxLength={80} value={draft.sender} onChange={(event) => update('sender', limitText(event.target.value, 40))} />
              </Field>
            </div>
            <Field name="plan.title" label="What were the plans? (optional)" error={visibleError('plan.title')}>
              <input {...fieldProps('plan.title')} maxLength={160} value={draft.title} placeholder="Coffee, a walk, a long-overdue catch-up…" onChange={(event) => update('title', limitText(event.target.value, 80))} />
            </Field>
            <Field name="plan.details" label="Plan details (optional)" hint="Shared on the ticket. Leave private details out." error={visibleError('plan.details')}>
              <textarea {...fieldProps('plan.details')} rows={2} maxLength={800} value={draft.details} onChange={(event) => update('details', limitText(event.target.value, 400))} />
            </Field>
            <Field name="context" label="Anything to help with drafting? (optional)" hint="Used only for drafting, not added to the ticket. No need to share medical or sensitive details." error={visibleError('context')}>
              <textarea {...fieldProps('context')} rows={2} maxLength={800} value={draft.context} onChange={(event) => update('context', limitText(event.target.value, 400))} />
            </Field>
            <fieldset className="tone-options">
              <legend>How should it sound?</legend>
              <div className="tone-grid">
                {([
                  ['honest', 'Honest', 'Kind and to the point.'],
                  ['cozy', 'Cozy', 'A little extra warmth.'],
                  ['theatrical', 'Theatrical', 'Clearly a joke.'],
                ] as const).map(([value, label, hint]) => <label className={`tone-card ${draft.tone === value ? 'is-selected' : ''}`} key={value}>
                  <input type="radio" name="tone" value={value} checked={draft.tone === value} onChange={() => update('tone', value)} />
                  <span><strong>{label}</strong><small>{hint}</small></span>
                </label>)}
              </div>
            </fieldset>
            {draft.tone === 'theatrical' && <TheatricalLabel />}
          </div>
        </fieldset>
        <fieldset disabled={creating}>
          <legend className="section-legend"><span>02</span> Offer one next time</legend>
          <div className="section-content">
            <CitySearch selected={city} onSelect={selectCity} onClear={() => { invalidate(); setCity(null); }} />
            <Field name="proposed.date" label="Replacement date" hint="Tickets normally expire in 30 days. The desk will check whether this date fits its configured lifetime." error={visibleError('proposed.date')}>
              <input {...fieldProps('proposed.date')} required type="date" min={today} max={today ? addDays(today, 365) : undefined} value={draft.date} onChange={(event) => update('date', event.target.value)} />
            </Field>
            <div className="field-pair">
              <Field name="proposed.start_time" label="Start time" error={visibleError('proposed.start_time')}>
                <input {...fieldProps('proposed.start_time')} required type="time" value={draft.start} onChange={(event) => update('start', event.target.value)} />
              </Field>
              <Field name="proposed.end_time" label="End time (optional)" error={visibleError('proposed.end_time')}>
                <input {...fieldProps('proposed.end_time')} type="time" value={draft.end} onChange={(event) => update('end', event.target.value)} />
              </Field>
            </div>
            <Field name="proposed.timezone" label="Timezone" hint="Times are local to this zone. Clock-change gaps are rejected; repeated times use the earlier occurrence." error={visibleError('proposed.timezone')}>
              <input {...fieldProps('proposed.timezone')} required list="timezone-options" spellCheck={false} autoComplete="off" value={draft.timezone} onChange={(event) => update('timezone', event.target.value)} />
              <datalist id="timezone-options">{Array.from(new Set([browserTimezone(), city?.timezone, 'UTC', 'America/New_York', 'America/Los_Angeles', 'Europe/London', 'Europe/Paris', 'Asia/Kolkata', 'Asia/Tokyo', 'Australia/Sydney'].filter((value): value is string => Boolean(value)))).map((zone) => <option value={zone} key={zone} />)}</datalist>
            </Field>
            {city && <div className="weather-controls">
              <label className="check-label"><input type="checkbox" checked={includeWeather} onChange={(event) => { invalidate(); setIncludeWeather(event.target.checked); }} /><span>Include a real forecast, if available</span></label>
              <div role="status">
                {weather.loading && <p className="small-note">Fetching weather for your selected city and day…</p>}
                {weather.note && <p className="small-note">{weather.note}</p>}
                {weather.error && <p className="small-note">{weather.error.message} No weather is attached. You can continue without it.</p>}
              </div>
              {weather.data && <WeatherNote weather={weather.data} />}
              {includeWeather && !weather.loading && <button type="button" className="text-button" onClick={refreshWeather}>Refresh weather</button>}
            </div>}
          </div>
        </fieldset>
        <fieldset disabled={creating}>
          <legend className="section-legend"><span>03</span> Your words, your call</legend>
          <div className="section-content">
            <div className="ai-note">
              <p className="eyebrow">A little help, never a fake excuse</p>
              <p>{aiAvailable === false ? 'AI drafting is not configured on this desk. Write your own note below, and you can still make a real ticket.' : aiAvailable ? 'AI can offer a first draft. Read it carefully and make it yours.' : 'AI availability hasn’t been confirmed. You can write your own note without it.'}</p>
              <button type="button" className="secondary-button" disabled={generating || weather.loading} onClick={() => void generate()}>{generating ? 'Asking for a draft…' : draft.message.trim() ? 'Try AI drafting (replaces text)' : 'Try AI drafting'}</button>
              {generating && <button type="button" className="text-button" onClick={() => { generation.current?.abort(); revision.current += 1; setGenerating(false); }}>Cancel drafting</button>}
              <p role="status">{generationError ? errorExplanation(generationError) : generating ? 'Waiting for the drafting service. Your existing note stays until a real draft returns.' : ''}</p>
            </div>
            {draft.tone === 'theatrical' && <TheatricalLabel />}
            <Field name="message" label="Your note" hint="Only say what’s true. Don’t invent illness, emergencies, weather, or someone’s availability." error={visibleError('message')}>
              <textarea {...fieldProps('message')} ref={note} required rows={7} maxLength={2400} value={draft.message} placeholder="Write the note you actually mean…" onChange={(event) => update('message', limitText(event.target.value, 1200))} />
            </Field>
            <p className="metadata message-count">{textLength(draft.message)} / 1,200 · {source === 'ai' ? 'AI-drafted · read and edit before sharing' : source === 'sample' ? 'Sample text, not AI inference' : 'Written by you'}</p>
          </div>
        </fieldset>
        <fieldset disabled={creating || generating || weather.loading} className="review-section">
          <legend className="section-legend"><span>04</span> One last look</legend>
          <div className="section-content">
            <p>Read the ticket preview, including the time and anything you’ve chosen to share. The date is a suggestion, not confirmed availability.</p>
            <label className="check-label"><input type="checkbox" checked={reviewed} onChange={(event) => setReviewed(event.target.checked)} /><span>I’ve read and reviewed the current note and ticket details.</span></label>
            <label className="check-label"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} /><span>I understand anyone with the link can read this ticket, and I agree to create a shareable link.</span></label>
            <p className="small-note">Changes clear both checks. Drafts stay in this tab only. Nothing is sent automatically.</p>
          </div>
        </fieldset>
        {error && <div className="error-panel" role="alert" tabIndex={-1} ref={errorPanel}>
          <h3>Let’s fix that before sharing.</h3>
          <p>{errorExplanation(error)}</p>
          {Object.entries(serverFields).length > 0 && <ul>{Object.entries(serverFields).map(([path, message]) => <li key={path}><a href={`#${path}`}>{message}</a></li>)}</ul>}
          {error.code === 'weather_token_invalid' && <div className="button-row">
            <button type="button" className="secondary-button" onClick={() => { invalidate(); setIncludeWeather(true); setWeatherRevision((value) => value + 1); }}>Refresh and include weather</button>
            <p>Weather was removed. Review again to continue without it.</p>
          </div>}
        </div>}
        <button className="primary-button create-button" type="submit" disabled={!valid || !reviewed || !consent || creating || generating || weather.loading}>{creating ? 'Making your ticket…' : hadShared ? 'Create a new share ticket' : 'Create share ticket'}<span aria-hidden="true"> ↗</span></button>
        <p className="small-note" role="status">{creating ? 'Saving the reviewed ticket. Please keep this tab open.' : !valid ? 'Add a valid note, date, time, and timezone before sharing.' : !reviewed || !consent ? 'Both checks above are needed before a link can be created.' : weather.loading ? 'Wait for weather, or turn it off to continue.' : 'Ready when you are. You’ll choose where to share the link.'}</p>
      </form>
      <aside className="preview-column">
        <p className="eyebrow preview-caption">The other side of your note / live preview</p>
        <TicketContent preview message={draft.message} proposed={proposed} theatrical={draft.tone === 'theatrical'} title={draft.title} recipient={draft.recipient} sender={draft.sender} weather={weather.data} />
        {draft.details && <div className="preview-details"><p className="eyebrow">Shared plan details</p><p>{draft.details}</p></div>}
        <p className="small-note preview-privacy">Only this note, optional names, plan details, suggested time, city, and included forecast are shared. Drafting context is not.</p>
      </aside>
    </div>
  </div>;
}
