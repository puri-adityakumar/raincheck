import type { ProposedTime, WeatherResponse, WeatherSnapshot } from '../lib/api/types';
import { displayDate, displayTimestamp } from '../lib/dates';

export const JOKE_LABEL = 'Clearly theatrical — a joke, not a real excuse';

export function TheatricalLabel() {
  return <p className="joke-label">{JOKE_LABEL}</p>;
}

export function WeatherNote({ weather }: { weather: WeatherSnapshot | WeatherResponse }) {
  const fetched = 'forecast' in weather ? weather.source.fetched_at : weather.fetched_at;
  return (
    <section className="weather-note" aria-label="Grounded weather forecast">
      <p className="eyebrow">Forecast · {weather.date}</p>
      <p>{weather.summary}</p>
      <p className="metadata">{weather.attribution.text} · Fetched {displayTimestamp(fetched)}</p>
      <p className="small-note">A forecast, not a promise. Conditions can change.</p>
    </section>
  );
}

export function ProposedDetails({ proposed }: { proposed: ProposedTime }) {
  return (
    <div className="proposed-details">
      <p className="eyebrow">One suggested next time</p>
      <p className="proposed-day">{displayDate(proposed.date)}</p>
      <p className="metadata">{proposed.start_time || 'Choose a time'}{proposed.end_time ? `–${proposed.end_time}` : ''} · {proposed.timezone}</p>
      {proposed.location_label && <p className="location-label">{proposed.location_label}</p>}
      <p className="small-note">A suggestion only. Calendar availability has not been checked or confirmed.</p>
    </div>
  );
}

export function TicketContent({ message, proposed, theatrical, title, recipient, sender, weather, preview = false }: {
  message: string; proposed: ProposedTime; theatrical: boolean;
  title?: string | null; recipient?: string | null; sender?: string | null;
  weather?: WeatherResponse | WeatherSnapshot | null; preview?: boolean;
}) {
  return (
    <article className="raincheck-ticket" aria-label={preview ? 'Your ticket preview' : 'Raincheck ticket'}>
      <div className="ticket-stub">
        <div><p className="eyebrow">Raincheck / {preview ? 'Not shared yet' : 'A little invitation to try again'}</p><p className="ticket-wordmark">Take a raincheck.</p></div>
        <span className="stamp" aria-hidden="true">another<br />little<br />maybe</span>
      </div>
      <div className="ticket-body">
        {theatrical && <TheatricalLabel />}
        {recipient && <p className="metadata">For {recipient}</p>}
        {title && <h2 className="ticket-title">{title}</h2>}
        <p className={`ticket-message ${message ? '' : 'empty-message'}`}>{message || 'Your own words go here.'}</p>
        {sender && <p className="signature">From {sender}</p>}
        <ProposedDetails proposed={proposed} />
        {weather && <WeatherNote weather={weather} />}
      </div>
      <div className="ticket-foot metadata">No messages sent. No calendars written.</div>
    </article>
  );
}
