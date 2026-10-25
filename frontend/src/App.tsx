import { lazy, Suspense, useEffect, useState } from 'react';
import { Composer } from './components/Composer';
import { PublicTicket } from './components/PublicTicket';
import { ApiError, getHealth } from './lib/api/client';
import type { HealthResponse } from './lib/api/types';

const FishingDiorama = lazy(() => import('./components/FishingDiorama').then((module) => ({ default: module.FishingDiorama })));
type HealthState = { status: 'checking' } | { status: 'ok'; data: HealthResponse } | { status: 'offline'; message: string };
type Route = { page: 'landing' | 'compose' | 'missing' } | { page: 'ticket'; token: string | null };

export function readRoute(pathname: string): Route {
  if (pathname === '/' || pathname === '') return { page: 'landing' };
  if (pathname === '/compose' || pathname === '/compose/') return { page: 'compose' };
  if (pathname.startsWith('/t/')) {
    const raw = pathname.slice(3).replace(/\/$/, '');
    try { return { page: 'ticket', token: decodeURIComponent(raw) }; }
    catch { return { page: 'ticket', token: null }; }
  }
  return { page: 'missing' };
}

function Landing({ start }: { start: () => void }) {
  return <>
    <section className="landing-hero">
      <div className="hero-copy">
        <p className="eyebrow"><span className="little-rule" /> Good plans. Another day.</p>
        <h1 className="hero-title">Cancel kindly.<br /><span>Suggest again.</span></h1>
        <p className="hero-description">Life happens. The friendship stays.<br />Write a thoughtful note, offer another time, and leave the door open.</p>
        <button className="primary-button hero-cta" type="button" onClick={start}>Start a raincheck <span aria-hidden="true">↗</span></button>
        <p className="hero-postscript">No account. No auto-send. Just a little grace.</p>
      </div>
      <figure className="hero-scene">
        <Suspense fallback={<div className="scene-loading" role="status">Waking the dock…</div>}>
          <FishingDiorama className="aspect-[760/600] w-full" />
        </Suspense>
        <figcaption><span className="metadata">A moment of stillness</span><span>Move for fish. Tap for ripples.</span></figcaption>
        <span className="scene-margin-note" aria-hidden="true">the world can wait a minute.</span>
      </figure>
    </section>
    <section className="landing-bottom" id="the-idea">
      <div className="landing-philosophy"><p className="eyebrow">A raincheck, not a disappearing act.</p><h2>Not “never”.<br />Just “not today”.</h2><p>You don’t need a grand excuse. A few honest words and one real alternative go a long way.</p></div>
      <ol className="how-steps">
        <li><span className="metadata">01 / Find your words</span><h3>A note that sounds like you.</h3><p>Write it yourself, or ask for a draft when AI is available. Always read and edit before sharing.</p></li>
        <li><span className="metadata">02 / Offer a maybe</span><h3>Something to look forward to.</h3><p>Choose a replacement time. Add a city forecast if you like. No calendar availability is assumed.</p></li>
        <li><span className="metadata">03 / Pass it along</span><h3>A small ticket, a fresh start.</h3><p>Make an expiring link and share it yourself. Your recipient can accept, with no account and no calendar writes.</p></li>
      </ol>
    </section>
    <section className="promise-strip" aria-label="Our promises"><p>Honest words.</p><span aria-hidden="true">/</span><p>Real forecasts, or none.</p><span aria-hidden="true">/</span><p>No messages sent for you.</p></section>
  </>;
}

export function App() {
  const [route, setRoute] = useState<Route>(() => readRoute(window.location.pathname));
  const [health, setHealth] = useState<HealthState>({ status: 'checking' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const changed = () => { setRoute(readRoute(window.location.pathname)); window.scrollTo?.(0, 0); };
    window.addEventListener('popstate', changed);
    return () => window.removeEventListener('popstate', changed);
  }, []);
  const isPublic = route.page === 'ticket';
  useEffect(() => {
    if (isPublic) return;
    const controller = new AbortController();
    setHealth({ status: 'checking' });
    getHealth(controller.signal).then((data) => { if (!controller.signal.aborted) setHealth({ status: 'ok', data }); })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setHealth({ status: 'offline', message: error instanceof ApiError ? error.message : 'The desk could not be reached.' });
      });
    return () => controller.abort();
  }, [attempt, isPublic]);
  useEffect(() => {
    document.title = isPublic ? 'A raincheck for you · Raincheck' : route.page === 'compose' ? 'A small change of plans · Raincheck' : 'Raincheck · Good plans, another day';
    const robots = document.createElement('meta');
    robots.name = 'robots'; robots.content = 'noindex, nofollow';
    if (isPublic) document.head.appendChild(robots);
    return () => { robots.remove(); };
  }, [isPublic, route.page]);
  function navigate(path: string) {
    window.history.pushState(null, '', path);
    setRoute(readRoute(path));
    window.scrollTo?.(0, 0);
  }
  return <div className="app-shell">
    <a className="skip-link" href="#main">Skip to content</a>
    <header className="site-header">
      <a className="brand" href="/" onClick={(event) => { if (!event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) { event.preventDefault(); navigate('/'); } }} aria-label="Raincheck home">Raincheck<span aria-hidden="true">.</span></a>
      <p className="header-tagline metadata">For plans worth keeping.</p>
      {route.page === 'landing' ? <a className="header-link" href="#the-idea">The idea <span aria-hidden="true">↓</span></a> : <a className="header-link" href="/">A fresh start <span aria-hidden="true">↗</span></a>}
    </header>
    <main id="main" tabIndex={-1}>
      {route.page === 'landing' && <Landing start={() => navigate('/compose')} />}
      {route.page === 'compose' && <Composer aiAvailable={health.status === 'ok' ? health.data.capabilities.ai_generation : null} />}
      {route.page === 'ticket' && <PublicTicket key={route.token} token={route.token} />}
      {route.page === 'missing' && <section className="ticket-state"><p className="eyebrow">Not found</p><h1>This page wandered off.</h1><a className="primary-button" href="/">Back to Raincheck</a></section>}
    </main>
    {!isPublic && <section className={`desk-status ${health.status === 'offline' ? 'is-offline' : ''}`} aria-label="Desk connection">
      <p role="status">{health.status === 'checking' ? 'Checking the desk connection…' : health.status === 'offline' ? `${health.message} You can keep writing here; creating a link needs the API.` : `Desk connected. ${health.data.capabilities.ai_generation ? 'AI drafting is available.' : 'AI drafting is not configured. Your own words work just fine.'}${!health.data.capabilities.tickets ? ' Ticket service is not currently available.' : ''}`}</p>
      {health.status === 'offline' && <button type="button" className="text-button" onClick={() => setAttempt((value) => value + 1)}>Retry connection</button>}
    </section>}
    <footer className="site-footer"><p className="footer-brand">Raincheck</p><p>A little grace for a change of plans.</p><p className="metadata">Nothing sent. Nothing scheduled for you.</p></footer>
  </div>;
}
