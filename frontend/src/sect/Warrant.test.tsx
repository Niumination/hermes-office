/**
 * Warrant tests.
 *
 * The component is small; the things worth pinning are the ones that were
 * absent from the product entirely until now, plus the two ways a login
 * control usually goes wrong: keeping the secret, and inventing a refusal
 * the server never made.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Warrant from './Warrant'

afterEach(cleanup)

const ok = () => new Response(JSON.stringify({ ok: true, role: 'owner' }), { status: 200 })
const refuse = (status: number, error?: string) =>
  new Response(JSON.stringify(error ? { error } : {}), { status })

describe('Warrant', () => {
  it('renders nothing for a viewer who already has standing', () => {
    const { container } = render(<Warrant isGuest={false} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('offers a guest a way in', () => {
    render(<Warrant isGuest />)
    expect(screen.getByRole('button', { name: /masuk/i })).toBeTruthy()
  })

  it('sends the token as a Bearer header and asks for the cookie back', async () => {
    const user = userEvent.setup()
    const fetchImpl = vi.fn().mockResolvedValue(ok())
    const onEntered = vi.fn()
    render(<Warrant isGuest fetchImpl={fetchImpl as unknown as typeof fetch} onEntered={onEntered} />)

    await user.click(screen.getByRole('button', { name: /masuk/i }))
    await user.type(screen.getByLabelText(/token pemilik/i), 'owner-token-abc')
    await user.click(screen.getByRole('button', { name: /^masuk$/i }))

    await waitFor(() => expect(fetchImpl).toHaveBeenCalled())
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/auth/session')
    expect(init.method).toBe('POST')
    expect(init.credentials).toBe('include')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer owner-token-abc')
    expect(onEntered).toHaveBeenCalled()
  })

  it('does not keep the token after spending it', async () => {
    // The session lives in an HttpOnly cookie. A bearer token left in React
    // state (or, worse, localStorage) would hand any XSS a key to the fleet.
    const user = userEvent.setup()
    const onEntered = vi.fn()
    render(
      <Warrant
        isGuest
        fetchImpl={vi.fn().mockResolvedValue(ok()) as unknown as typeof fetch}
        onEntered={onEntered}
      />,
    )
    await user.click(screen.getByRole('button', { name: /masuk/i }))
    const field = screen.getByLabelText(/token pemilik/i) as HTMLInputElement
    await user.type(field, 'owner-token-abc')
    await user.click(screen.getByRole('button', { name: /^masuk$/i }))

    await waitFor(() => expect(onEntered).toHaveBeenCalled())
    expect(field.value).toBe('')
    expect(window.localStorage.getItem('token')).toBeNull()
    expect(JSON.stringify(window.localStorage)).not.toContain('owner-token-abc')
  })

  it('reports the server wording on a refusal, not its own', async () => {
    const user = userEvent.setup()
    render(
      <Warrant
        isGuest
        fetchImpl={vi.fn().mockResolvedValue(refuse(401, 'Tidak terotorisasi')) as unknown as typeof fetch}
        onEntered={vi.fn()}
      />,
    )
    await user.click(screen.getByRole('button', { name: /masuk/i }))
    await user.type(screen.getByLabelText(/token pemilik/i), 'salah')
    await user.click(screen.getByRole('button', { name: /^masuk$/i }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe('Tidak terotorisasi')
  })

  it('distinguishes a full session table from a bad token', async () => {
    // 429 and 401 send the operator after different problems. Collapsing them
    // into "login failed" would cost them the diagnosis.
    const user = userEvent.setup()
    render(
      <Warrant
        isGuest
        fetchImpl={vi.fn().mockResolvedValue(refuse(429)) as unknown as typeof fetch}
        onEntered={vi.fn()}
      />,
    )
    await user.click(screen.getByRole('button', { name: /masuk/i }))
    await user.type(screen.getByLabelText(/token pemilik/i), 'x')
    await user.click(screen.getByRole('button', { name: /^masuk$/i }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/sesi/i)
    expect(alert.textContent).not.toMatch(/ditolak/i)
  })

  it('does not call a network failure a rejected token', async () => {
    const user = userEvent.setup()
    render(
      <Warrant
        isGuest
        fetchImpl={vi.fn().mockRejectedValue(new TypeError('offline')) as unknown as typeof fetch}
        onEntered={vi.fn()}
      />,
    )
    await user.click(screen.getByRole('button', { name: /masuk/i }))
    await user.type(screen.getByLabelText(/token pemilik/i), 'x')
    await user.click(screen.getByRole('button', { name: /^masuk$/i }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/tidak dapat dihubungi/i)
  })

  it('will not submit an empty token', async () => {
    const user = userEvent.setup()
    const fetchImpl = vi.fn()
    render(<Warrant isGuest fetchImpl={fetchImpl as unknown as typeof fetch} onEntered={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: /masuk/i }))
    await user.click(screen.getByRole('button', { name: /^masuk$/i }))
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
