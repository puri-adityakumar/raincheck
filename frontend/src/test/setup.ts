import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';

beforeEach(() => {
  vi.stubEnv('VITE_API_BASE_URL', '');
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

Object.defineProperty(window, 'scrollTo', { configurable: true, value: vi.fn() });

// jsdom has no WebGL. The diorama must fall back instead of throwing.
Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
  configurable: true,
  value: () => null,
});

Object.defineProperty(window, 'matchMedia', {
  configurable: true,
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }),
});
