import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import { stubMatchMedia } from '../test/setup'
import AtmosphereLayer from './AtmosphereLayer'

/**
 * AtmosphereLayer runs raw WebGL, which means the interesting cases are all
 * about what happens when WebGL is *not* available or goes away. jsdom has no
 * WebGL2 at all, so these tests exercise the degraded paths for free — which
 * is exactly the environment an older Safari, a locked-down browser or an
 * embedded webview presents.
 *
 * The contract being pinned: the room must still look fine without its air.
 * A governance dashboard that renders a black box because a shader failed is
 * worse than one with no atmosphere.
 */

beforeEach(() => {
  stubMatchMedia(false)
})

describe('AtmosphereLayer — degraded environments', () => {
  it('renders a canvas even when WebGL2 is unavailable', () => {
    const { container } = render(<AtmosphereLayer />)
    const canvas = container.querySelector('canvas.atmosphere-layer')
    expect(canvas).toBeInTheDocument()
  })

  it('does not throw when getContext returns null', () => {
    // jsdom already returns null; assert explicitly so a future jsdom that
    // stubs WebGL does not quietly change what this suite covers.
    const spy = vi
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue(null)
    expect(() => render(<AtmosphereLayer state="critical" />)).not.toThrow()
    spy.mockRestore()
  })

  it('is hidden from assistive technology', () => {
    // Purely decorative: a screen reader announcing "canvas" between the room
    // and the agents would be noise.
    const { container } = render(<AtmosphereLayer />)
    expect(container.querySelector('canvas')).toHaveAttribute('aria-hidden')
  })

  it('unmounts cleanly without leaving the context behind', () => {
    const { unmount, container } = render(<AtmosphereLayer />)
    expect(container.querySelector('canvas')).toBeInTheDocument()
    expect(() => unmount()).not.toThrow()
  })
})

describe('AtmosphereLayer — props are inert without a context', () => {
  it.each(['normal', 'warm', 'hot', 'critical', 'tripped'] as const)(
    'accepts burn state %s without throwing',
    (state) => {
      expect(() => render(<AtmosphereLayer state={state} />)).not.toThrow()
    }
  )

  it('accepts the night phase', () => {
    expect(() => render(<AtmosphereLayer phase="night" />)).not.toThrow()
  })

  it('accepts a disabled ray strength for windowless rooms', () => {
    // server-room and parking pass rayStrength near zero: light shafts with
    // no visible source read as fog, not atmosphere.
    expect(() => render(<AtmosphereLayer rayStrength={0} />)).not.toThrow()
  })

  it('re-renders on state change without rebuilding the element', () => {
    const { container, rerender } = render(<AtmosphereLayer state="normal" />)
    const first = container.querySelector('canvas')
    rerender(<AtmosphereLayer state="tripped" />)
    // State is read inside the render loop via a ref, so a change must not
    // tear down and recreate the GL context.
    expect(container.querySelector('canvas')).toBe(first)
  })
})

describe('AtmosphereLayer — reduced motion', () => {
  it('still renders when the user asks for reduced motion', () => {
    stubMatchMedia(true)
    const { container } = render(<AtmosphereLayer state="critical" />)
    // Reduced motion freezes time rather than removing the layer: the colour
    // grade still carries the burn state, which is information, not decoration.
    expect(container.querySelector('canvas.atmosphere-layer')).toBeInTheDocument()
  })

  it('survives a browser with no matchMedia at all', () => {
    vi.stubGlobal('matchMedia', undefined)
    expect(() => render(<AtmosphereLayer />)).not.toThrow()
  })
})
