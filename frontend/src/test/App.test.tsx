import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App, readRoute } from '../App';
import { health, json } from './fixtures';

describe('the real product landing', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/');
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(json(health))));
  });
  it('keeps the diorama, honest AI capability, and a working primary CTA', async () => {
    render(<App />);
    expect(screen.getByRole('heading', { level: 1, name: /cancel kindly.*suggest again/i })).toBeInTheDocument();
    expect(await screen.findByText(/desk connected/i)).toHaveTextContent(/AI drafting is not configured/i);
    expect(await screen.findByText(/the dock is resting/i)).toBeInTheDocument();
    expect(screen.getByText(/could not start webgl/i)).toBeInTheDocument();
    expect(screen.queryByText(/foundation build/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /start a raincheck/i }));
    expect(window.location.pathname).toBe('/compose');
    expect(screen.getByLabelText('Your note')).toBeInTheDocument();
    expect(screen.queryByText(/the dock is resting/i)).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveFocus();
  });
  it('offers an honest offline state, keeps composing available, and retries health', async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new TypeError('offline')).mockImplementation(() => Promise.resolve(json(health)));
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);
    expect(await screen.findByText(/you can keep writing here/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry connection' }));
    expect(await screen.findByText(/desk connected/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /start a raincheck/i }));
    expect(screen.getByLabelText('Your note')).toBeEnabled();
  });
  it('follows back/forward route changes', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /start a raincheck/i }));
    window.history.replaceState(null, '', '/');
    fireEvent(window, new PopStateEvent('popstate'));
    await waitFor(() => expect(screen.getByRole('button', { name: /start a raincheck/i })).toBeInTheDocument());
  });
  it('does not crash on malformed percent-encoded ticket paths', () => {
    expect(readRoute('/t/%E0%A4%A')).toEqual({ page: 'ticket', token: null });
    window.history.replaceState(null, '', '/t/%E0%A4%A');
    render(<App />);
    expect(screen.getByRole('heading', { name: /lost in the post/i })).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
    expect(document.head.querySelector('meta[name=robots]')).toHaveAttribute('content', 'noindex, nofollow');
  });
});
