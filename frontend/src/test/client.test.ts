import { describe, expect, it, vi } from 'vitest';
import { ApiError, apiFetch, apiUrl } from '../lib/api/client';

describe('apiFetch', () => {
  it.each([
    ['https://api.example', 'https://api.example'],
    ['https://api.example/', 'https://api.example'],
    ['http://127.0.0.1:8000/service///', 'http://127.0.0.1:8000/service'],
  ])('uses the configured API base %s for JSON and calendar URLs', async (base, expected) => {
    vi.stubEnv('VITE_API_BASE_URL', base);
    const mock = vi.fn().mockResolvedValue(new Response('{"ok":true}'));
    vi.stubGlobal('fetch', mock);
    await expect(apiFetch('/api/health')).resolves.toEqual({ ok: true });
    expect(mock).toHaveBeenCalledWith(`${expected}/api/health`, expect.objectContaining({
      credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error', cache: 'no-store',
    }));
    expect(apiUrl('/api/tickets/fixture/raincheck.ics')).toBe(`${expected}/api/tickets/fixture/raincheck.ics`);
    expect(() => apiUrl('//other.example/api/health')).toThrow(ApiError);
  });

  it.each([
    'javascript:alert(1)', 'data:text/html,fixture', 'ftp://api.example',
    'https://user:fixture@api.example', 'https://api.example?route=1',
    'https://api.example#fragment', '/relative-api',
  ])('rejects an unsafe or malformed API base without making a request: %s', async (base) => {
    vi.stubEnv('VITE_API_BASE_URL', base);
    const mock = vi.fn();
    vi.stubGlobal('fetch', mock);
    const error = await apiFetch('/api/health').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code: 'invalid_api_base', status: 0 });
    expect((error as ApiError).message).not.toContain(base);
    expect(mock).not.toHaveBeenCalled();
  });

  it('maps the typed error envelope into ApiError', async () => {
    const body = {
      error: {
        code: 'validation_error',
        message: 'Some fields need attention.',
        details: { fields: [{ path: 'message', message: 'Write something.' }] },
        request_id: 'req-123',
      },
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(body), {
          status: 422,
          headers: { 'Content-Type': 'application/json', 'X-Request-ID': 'req-123' },
        }),
      ),
    );

    await expect(apiFetch('/api/tickets')).rejects.toMatchObject({
      name: 'ApiError',
      code: 'validation_error',
      status: 422,
      requestId: 'req-123',
    });
  });

  it('uses a client-only network_error when the desk is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));

    const error = await apiFetch('/api/health').catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe('network_error');
    expect((error as ApiError).status).toBe(0);
  });

  it('serialises a JSON body and returns parsed success payloads', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiFetch('/api/example', { method: 'POST', body: { a: 1 } })).resolves.toEqual({
      ok: true,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/example',
      expect.objectContaining({
        method: 'POST',
        body: '{"a":1}',
        headers: expect.any(Headers),
      }),
    );
  });

  it('does not route API requests to external or traversal paths', async () => {
    const mock = vi.fn();
    vi.stubGlobal('fetch', mock);
    for (const path of ['https://evil.example/api', '//evil.example/api', '/api/../outside', '/api/thing\\outside']) {
      await expect(apiFetch(path)).rejects.toMatchObject({ code: 'invalid_path' });
    }
    expect(mock).not.toHaveBeenCalled();
  });

  it('preserves abort errors instead of turning cancelled searches into network failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('Aborted', 'AbortError')));
    await expect(apiFetch('/api/locations/search?q=London')).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('rejects malformed success JSON and maps untyped HTTP errors calmly', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response('<html>not JSON</html>'))
      .mockResolvedValueOnce(new Response('down', { status: 503 })));
    await expect(apiFetch('/api/tickets')).rejects.toMatchObject({ code: 'invalid_response' });
    await expect(apiFetch('/api/tickets')).rejects.toMatchObject({ code: 'http_error', status: 503 });
  });
});
