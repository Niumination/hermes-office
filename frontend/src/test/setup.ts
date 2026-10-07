import '@testing-library/jest-dom/vitest'
import { afterEach, beforeAll, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

// jsdom has no canvas backend, so every getContext call logs a loud
// "Not implemented" to stderr. That is precisely the degraded path
// AtmosphereLayer is designed for, so make it explicit and quiet rather than
// letting real failures hide inside the noise.
beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as
    HTMLCanvasElement['getContext']
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

// jsdom implements neither of these, and both are load-bearing:
// AtmosphereLayer reads prefers-reduced-motion, and several components key
// animation off it. Returning a real MediaQueryList shape (with the
// addEventListener pair) is what lets the cleanup paths be tested at all.
export function stubMatchMedia(reduceMotion = false) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation((query: string) => ({
      matches: query.includes('prefers-reduced-motion') ? reduceMotion : false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }))
  )
}

/** Minimal fetch stub: route -> response. Unmatched routes reject loudly so a
 *  forgotten endpoint shows up as a test failure, not as silent empty state. */
export function stubFetch(routes: Record<string, { status?: number; body?: unknown }>) {
  // The init argument must be in the signature even though the stub ignores
  // it: tests assert on the method and body that components send, and `tsc`
  // runs over these files as part of `npm run build`.
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    void init
    const url = typeof input === 'string' ? input : input.toString()
    const key = Object.keys(routes).find((k) => url.startsWith(k))
    if (!key) throw new Error(`unstubbed fetch: ${url}`)
    const { status = 200, body = {} } = routes[key]
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    } as unknown as Response
  })
  vi.stubGlobal('fetch', fn)
  return fn
}
