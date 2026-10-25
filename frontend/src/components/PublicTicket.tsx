import { useEffect, useRef, useState } from 'react';
import { apiFetch, apiUrl, ApiError } from '../lib/api/client';
import type { AcceptResponse, TicketResponse } from '../lib/api/types';
import { displayTimestamp } from '../lib/dates';
import { asApiError } from '../lib/errors';
import { TicketContent } from './TicketContent';

type State = { status: 'loading' } | { status: 'found'; ticket: TicketResponse } | { status: 'error'; error: ApiError };

export function PublicTicket({ token }: { token: string | null }) {
  const [state, setState] = useState<State>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [accepting, setAccepting] = useState(false);
  const [acceptError, setAcceptError] = useState<ApiError | null>(null);
  const [acceptNote, setAcceptNote] = useState('');
  const acceptance = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const acceptedHeading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    const version = ++generation.current;
    setState({ status: 'loading' }); setAcceptError(null); setAcceptNote(''); setAccepting(false);
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
      setState({ status: 'error', error: new ApiError({ code: 'ticket_not_found', status: 404, message: 'This ticket could not be found.' }) });
      return () => { generation.current += 1; };
    }
    apiFetch<TicketResponse>(`/api/tickets/${encodeURIComponent(token)}`, { signal: controller.signal })
      .then((ticket) => { if (!controller.signal.aborted && version === generation.current) setState({ status: 'found', ticket }); })
      .catch((error: unknown) => { if (!controller.signal.aborted && version === generation.current) setState({ status: 'error', error: asApiError(error) }); });
    return () => { generation.current += 1; controller.abort(); acceptance.current?.abort(); };
  }, [token, attempt]);

  async function accept() {
    if (state.status !== 'found' || state.ticket.status === 'accepted' || accepting || !token) return;
    const controller = new AbortController();
    acceptance.current = controller;
    const version = generation.current;
    setAccepting(true); setAcceptError(null);
    try {
      const response = await apiFetch<AcceptResponse>(`/api/tickets/${encodeURIComponent(token)}/accept`, { method: 'POST', signal: controller.signal });
      if (controller.signal.aborted || version !== generation.current) return;
      setState((current) => current.status === 'found' ? {
        status: 'found', ticket: { ...current.ticket, status: 'accepted', accepted_at: current.ticket.accepted_at ?? response.accepted_at },
      } : current);
      setAcceptNote(response.already_accepted ? 'This suggestion was already accepted. The original acceptance time is unchanged.' : 'Your acceptance is saved. Nothing has been sent and no calendar has been updated.');
      window.requestAnimationFrame(() => acceptedHeading.current?.focus());
    } catch (caught) {
      if (controller.signal.aborted || version !== generation.current) return;
      const error = asApiError(caught);
      if (error.status === 404 || error.status === 410) setState({ status: 'error', error });
      else setAcceptError(error);
    } finally {
      if (!controller.signal.aborted && version === generation.current) setAccepting(false);
    }
  }

  if (state.status === 'loading') return <section className="ticket-state" role="status">
    <p className="eyebrow">One small moment</p><h1>Opening your raincheck…</h1><p>Looking up this ticket, not anyone’s calendar.</p>
  </section>;

  if (state.status === 'error') {
    const expired = state.error.status === 410;
    const missing = state.error.status === 404;
    return <section className="ticket-state" aria-labelledby="ticket-state-title">
      <p className="eyebrow">Raincheck / {expired ? 'Expired' : missing ? 'Not found' : 'Connection interrupted'}</p>
      <h1 id="ticket-state-title">{expired ? 'This raincheck has run its course.' : missing ? 'A little lost in the post.' : 'The desk is out of reach.'}</h1>
      <p>{expired ? 'This ticket has expired and can’t be read or accepted. Ask the sender for a fresh link.' : missing ? 'We couldn’t find that ticket. Check the complete link, or ask the sender for a new one.' : state.error.message}</p>
      {!expired && !missing && <button type="button" className="primary-button" onClick={() => setAttempt((value) => value + 1)}>Try loading again</button>}
      <a className="text-button" href="/">Make your own raincheck</a>
    </section>;
  }
  const { ticket } = state;
  const accepted = ticket.status === 'accepted';
  return <div className="recipient-page">
    <div className="recipient-intro"><p className="eyebrow">A note{ticket.sender_name ? ` from ${ticket.sender_name}` : ' for you'}</p><h1>Good plans deserve a second try.</h1></div>
    <div className="recipient-grid">
      <div>
        <TicketContent message={ticket.message} proposed={ticket.proposed} theatrical={ticket.theatrical || ticket.tone === 'theatrical'} title={ticket.plan.title} recipient={ticket.recipient.display_name} sender={ticket.sender_name} weather={ticket.weather} />
        {ticket.plan.details && <section className="public-plan-details"><h2>Plan details</h2><p>{ticket.plan.details}</p></section>}
      </div>
      <aside className="recipient-actions paper-panel">
        <p className="eyebrow">The next move is yours</p>
        {accepted ? <section aria-label="Accepted suggestion">
          <h2 ref={acceptedHeading} tabIndex={-1}>Suggestion accepted.</h2>
          <p className="metadata">Accepted {ticket.accepted_at ? displayTimestamp(ticket.accepted_at) : 'previously'}</p>
          <p role="status">{acceptNote || 'Your acceptance is already saved. The original acceptance time is unchanged.'}</p>
        </section> : <>
          <h2>Does this work for you?</h2>
          <p>Accepting records a yes on this ticket. It doesn’t check availability, send a message, or change a calendar.</p>
          <button type="button" className="primary-button" disabled={accepting} onClick={() => void accept()}>{accepting ? 'Saving your acceptance…' : 'Accept this suggestion'}</button>
          {accepting && <p role="status">Saving just your acceptance…</p>}
        </>}
        {acceptError && <div className="error-panel" role="alert"><p>{acceptError.message}</p><p>Try accepting again. If the first request arrived, the original acceptance time will be kept.</p></div>}
        <div className="calendar-download">
          <a className="secondary-button" href={apiUrl(`/api/tickets/${encodeURIComponent(token ?? '')}/raincheck.ics`)} referrerPolicy="no-referrer" download>Download calendar file (.ics)</a>
          <p className="small-note">An ordinary tentative download, not an invitation or calendar update.</p>
        </div>
        <p className="availability-note">Calendar availability has not been checked or confirmed, even after acceptance.</p>
        <p className="small-note">{ticket.availability.note}</p>
        <p className="metadata expiry">Ticket expires {displayTimestamp(ticket.expires_at)}</p>
        <p className="small-note">Anyone with this link can read it. There’s no inbox and no automatic notification.</p>
      </aside>
    </div>
  </div>;
}
