import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FishingDiorama } from '../components/FishingDiorama';

/** Lifecycle test double, not an assertion about GPU rendering or shader pixels. */
function fakeWebGL() {
  const gl = {
    VERTEX_SHADER: 1, FRAGMENT_SHADER: 2, COMPILE_STATUS: 3, LINK_STATUS: 4,
    ARRAY_BUFFER: 5, STATIC_DRAW: 6, FLOAT: 7, TRIANGLES: 8, COLOR_BUFFER_BIT: 9,
    createShader: vi.fn(() => ({})), shaderSource: vi.fn(), compileShader: vi.fn(), getShaderParameter: vi.fn(() => true),
    getShaderInfoLog: vi.fn(), deleteShader: vi.fn(), createProgram: vi.fn(() => ({})), attachShader: vi.fn(),
    linkProgram: vi.fn(), getProgramParameter: vi.fn(() => true), getProgramInfoLog: vi.fn(), useProgram: vi.fn(),
    createBuffer: vi.fn(() => ({})), bindBuffer: vi.fn(), bufferData: vi.fn(), getAttribLocation: vi.fn(() => 0),
    enableVertexAttribArray: vi.fn(), vertexAttribPointer: vi.fn(), getUniformLocation: vi.fn((_program: unknown, name: string) => name),
    uniform3fv: vi.fn(), clearColor: vi.fn(), clear: vi.fn(), viewport: vi.fn(), uniform2f: vi.fn(), uniform1f: vi.fn(),
    uniform4fv: vi.fn(), uniform3f: vi.fn(), drawArrays: vi.fn(), deleteBuffer: vi.fn(), deleteProgram: vi.fn(),
  };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(gl as unknown as WebGLRenderingContext);
  vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0, y: 0, top: 0, right: 300, bottom: 240, left: 0, width: 300, height: 240, toJSON: () => ({}),
  });
  const raf = vi.fn(() => 1);
  const cancel = vi.fn();
  vi.stubGlobal('requestAnimationFrame', raf); vi.stubGlobal('cancelAnimationFrame', cancel);
  return { gl, raf, cancel };
}

describe('original fishing scene lifecycle', () => {
  it('starts still for reduced motion, and offers an explicit accessible play/pause override', () => {
    const { raf, cancel } = fakeWebGL();
    vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
      matches: true, media: query, onchange: null, addEventListener: vi.fn(), removeEventListener: vi.fn(),
      addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
    }));
    const { container } = render(<FishingDiorama />);
    expect(screen.getByText('Still scene')).toBeInTheDocument();
    expect(container.firstChild).toHaveAttribute('data-animation-state', 'paused');
    expect(raf).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Play the dock animation' }));
    expect(container.firstChild).toHaveAttribute('data-animation-state', 'playing');
    expect(raf).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Pause the dock animation' }));
    expect(container.firstChild).toHaveAttribute('data-animation-state', 'paused');
    expect(cancel).toHaveBeenCalled();
  });
  it('caps mobile DPR, supports a keyboard ripple, and falls back on context loss', () => {
    const { gl, cancel } = fakeWebGL();
    vi.stubGlobal('devicePixelRatio', 5);
    const { unmount } = render(<FishingDiorama />);
    const canvas = screen.getByRole('img') as HTMLCanvasElement;
    expect(canvas).toHaveAttribute('tabindex', '0');
    expect(canvas.width).toBe(450);
    expect(canvas.height).toBe(360);
    const event = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true, bubbles: true });
    expect(canvas.dispatchEvent(event)).toBe(false);
    const loss = new Event('webglcontextlost', { cancelable: true });
    fireEvent(canvas, loss);
    expect(loss.defaultPrevented).toBe(true);
    expect(screen.getByText('The dock is resting.')).toBeInTheDocument();
    expect(cancel).toHaveBeenCalled();
    unmount();
    expect(gl.deleteProgram).toHaveBeenCalled();
    expect(gl.deleteBuffer).toHaveBeenCalled();
  });
  it('stops animation offscreen and while hidden, then resumes when both allow it', () => {
    const { cancel } = fakeWebGL();
    let intersection: IntersectionObserverCallback = () => {};
    class Observer {
      constructor(callback: IntersectionObserverCallback) { intersection = callback; }
      observe = vi.fn(); unobserve = vi.fn(); disconnect = vi.fn();
    }
    vi.stubGlobal('IntersectionObserver', Observer);
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    const { container } = render(<FishingDiorama />);
    expect(container.firstChild).toHaveAttribute('data-animation-state', 'playing');
    act(() => intersection([{ isIntersecting: false } as IntersectionObserverEntry], {} as IntersectionObserver));
    expect(container.firstChild).toHaveAttribute('data-animation-state', 'paused');
    visibility.mockReturnValue('hidden');
    fireEvent(document, new Event('visibilitychange'));
    act(() => intersection([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver));
    expect(container.firstChild).toHaveAttribute('data-animation-state', 'paused');
    visibility.mockReturnValue('visible');
    fireEvent(document, new Event('visibilitychange'));
    expect(container.firstChild).toHaveAttribute('data-animation-state', 'playing');
    expect(cancel).toHaveBeenCalled();
  });
});
