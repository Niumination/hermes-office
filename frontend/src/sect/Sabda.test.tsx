/**
 * Sabda — three of these behaviours are contractual, not cosmetic:
 *
 *   1. SECURITY.md §2: a guest is read-only. `POST /chat` is
 *      requireAuth(["bridge","owner"]), so the composer must be absent for a
 *      guest and the transcript must still be readable (GET /chat is
 *      requireAny). Hiding the history would be the UI inventing a refusal.
 *   2. The server's frame shapes. `typing` carries `{ sender }` and
 *      `reaction` carries `{ messageId, reactions[] }`. The old office read
 *      `d?.who`, which is permanently undefined, so its typing indicator
 *      never appeared — and no test caught it, because an `as` cast compiles
 *      whatever you claim. These tests feed the SERVER's shape, so the bug
 *      cannot come back silently.
 *   3. A refused send is reported. Dropping it would let an operator believe
 *      an instruction was delivered when the server threw it away.
 */
import React from 'react'
import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import Sabda from './Sabda'
import { useSabda } from './useSabda'
import type { SabdaMessage } from './useSabda'

const msg = (over: Partial<SabdaMessage> = {}): SabdaMessage => ({
  id: 1, sender: 'owner', text: 'halo', timestamp: 1_760_000_000_000,
  system: false, reactions: [], ...over,
})

const noop = () => {}

const jsonRes = (body: unknown, status = 200) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response

describe('Sabda — panel', () => {
  it('shows the transcript to a guest but gives them no composer', () => {
    render(
      <Sabda messages={[msg({ text: 'riwayat tetap terbaca' })]} typing={null}
        refusal={null} guest loaded onSend={noop} onReact={noop} />,
    )
    // GET /chat is requireAny: the guest reads.
    expect(screen.getByText('riwayat tetap terbaca')).toBeTruthy()
    // POST /chat is not: no input to mislead them with.
    expect(screen.queryByLabelText('Sabda')).toBeNull()
    expect(screen.getByTestId('sabda-guest')).toBeTruthy()
  })

  it('gives a member a composer and sends the trimmed text', async () => {
    const onSend = vi.fn()
    render(
      <Sabda messages={[]} typing={null} refusal={null} guest={false} loaded
        onSend={onSend} onReact={noop} />,
    )
    await userEvent.type(screen.getByLabelText('Sabda'), '  tutup gerbang  {Enter}')
    expect(onSend).toHaveBeenCalledWith('tutup gerbang')
  })

  it('keeps /niu-mode local — it is view state, not a message', async () => {
    const onSend = vi.fn()
    render(
      <Sabda messages={[]} typing={null} refusal={null} guest={false} loaded
        onSend={onSend} onReact={noop} />,
    )
    await userEvent.type(screen.getByLabelText('Sabda'), '/niu-mode{Enter}')
    expect(onSend).not.toHaveBeenCalled()
  })

  it("surfaces the server's refusal instead of swallowing it", () => {
    render(
      <Sabda messages={[]} typing={null} refusal="Perguruan menolak sabda ini."
        guest={false} loaded onSend={noop} onReact={noop} />,
    )
    expect(screen.getByTestId('sabda-refusal').textContent).toContain('menolak')
  })

  it('renders reactions already on a message', () => {
    render(
      <Sabda messages={[msg({ reactions: ['🔥', '🚀'] })]} typing={null} refusal={null}
        guest={false} loaded onSend={noop} onReact={noop} />,
    )
    expect(screen.getByText('🔥')).toBeTruthy()
    expect(screen.getByText('🚀')).toBeTruthy()
  })
})

describe('useSabda — the server contract', () => {
  it('loads history from GET /chat', async () => {
    const fetchImpl = vi.fn(async (_url: string) =>
      jsonRes({ messages: [{ id: 7, sender: 'hermes', text: 'siap', timestamp: 1 }] }))
    const { result } = renderHook(() => useSabda({ fetchImpl }))
    await waitFor(() => expect(result.current.messages).toHaveLength(1))
    expect(result.current.messages[0].sender).toBe('hermes')
    expect(fetchImpl.mock.calls[0][0]).toContain('/chat')
  })

  it('retries a 401 history fetch — it means "no guest session yet", not "denied"', async () => {
    // Reproduces the cold-load race seen in a real browser: GET /chat fires
    // before SectApp's GET /kiosk has minted the session.
    let n = 0
    const fetchImpl = vi.fn(async () => {
      n += 1
      return n === 1
        ? ({ ok: false, status: 401, json: async () => ({}) } as Response)
        : jsonRes({ messages: [{ id: 2, sender: 'owner', text: 'akhirnya', timestamp: 1 }] })
    })
    const { result } = renderHook(() => useSabda({ fetchImpl }))
    await waitFor(() => expect(result.current.messages).toHaveLength(1), { timeout: 3000 })
    expect(result.current.messages[0].text).toBe('akhirnya')
    expect(n).toBeGreaterThan(1)
  })

  it('reads the typing frame the server actually sends ({ sender })', async () => {
    const fetchImpl = vi.fn(async () => jsonRes({ messages: [] }))
    const { result } = renderHook(() => useSabda({ fetchImpl }))
    act(() => { result.current.onTyping({ sender: 'hermes' }) })
    // The old code read `.who` here and got undefined, forever.
    expect(result.current.typing).toBe('hermes')
  })

  it('applies the reaction frame the server sends ({ messageId, reactions[] })', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonRes({ messages: [{ id: 3, sender: 'owner', text: 'hm', timestamp: 1 }] }))
    const { result } = renderHook(() => useSabda({ fetchImpl }))
    await waitFor(() => expect(result.current.messages).toHaveLength(1))
    act(() => { result.current.onReaction({ messageId: 3, reactions: ['👍', '🔥'] }) })
    expect(result.current.messages[0].reactions).toEqual(['👍', '🔥'])
  })

  it('parses the TEXT-JSON reactions that GET /chat really returns', async () => {
    // Verified against a running server: the history endpoint hands back the
    // raw SQLite row, so `reactions` arrives as a string, not an array.
    const fetchImpl = vi.fn(async () => jsonRes({
      messages: [{ id: 5, sender: 'owner', text: 'hm', timestamp: 1, reactions: '["\u{1F44D}","\u{1F525}"]' }],
    }))
    const { result } = renderHook(() => useSabda({ fetchImpl }))
    await waitFor(() => expect(result.current.messages).toHaveLength(1))
    expect(result.current.messages[0].reactions).toEqual(['\u{1F44D}', '\u{1F525}'])
  })

  it('survives a malformed reactions column without blanking the message', async () => {
    const fetchImpl = vi.fn(async () => jsonRes({
      messages: [{ id: 6, sender: 'owner', text: 'tetap tampil', timestamp: 1, reactions: '{rusak' }],
    }))
    const { result } = renderHook(() => useSabda({ fetchImpl }))
    await waitFor(() => expect(result.current.messages).toHaveLength(1))
    expect(result.current.messages[0].text).toBe('tetap tampil')
    expect(result.current.messages[0].reactions).toEqual([])
  })

  it('merges chat_delta into one line and lets chat_done replace it', async () => {
    const fetchImpl = vi.fn(async () => jsonRes({ messages: [] }))
    const { result } = renderHook(() => useSabda({ fetchImpl }))
    act(() => { result.current.onChatDelta({ sender: 'hermes', delta: 'Bai' }) })
    act(() => { result.current.onChatDelta({ sender: 'hermes', delta: 'klah.' }) })
    expect(result.current.messages).toHaveLength(1)
    expect(result.current.messages[0].text).toBe('Baiklah.')
    expect(result.current.messages[0].streaming).toBe(true)

    act(() => {
      result.current.onChatDone({ id: 9, sender: 'hermes', text: 'Baiklah.', timestamp: 2 })
    })
    expect(result.current.messages).toHaveLength(1)
    expect(result.current.messages[0].id).toBe(9)
    expect(result.current.messages[0].streaming).toBeUndefined()
  })

  it('does not duplicate a message the server replays', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonRes({ messages: [{ id: 4, sender: 'owner', text: 'sekali', timestamp: 1 }] }))
    const { result } = renderHook(() => useSabda({ fetchImpl }))
    await waitFor(() => expect(result.current.messages).toHaveLength(1))
    act(() => {
      result.current.onChatDone({ id: 4, sender: 'owner', text: 'sekali', timestamp: 1 })
    })
    expect(result.current.messages).toHaveLength(1)
  })

  it('reports a 403 from POST /chat rather than pretending the send worked', async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      url === '/chat?limit=50' ? jsonRes({ messages: [] }) : jsonRes({ error: 'forbidden' }, 403))
    const { result } = renderHook(() => useSabda({ fetchImpl }))
    await waitFor(() => expect(result.current.loaded).toBe(true))
    await act(async () => { await result.current.send('coba') })
    expect(result.current.refusal).toBeTruthy()
    // And no optimistic line was left on screen claiming it was said.
    expect(result.current.messages).toHaveLength(0)
  })

  it('does not append the sent message locally — chat_done carries it back', async () => {
    const fetchImpl = vi.fn(async () => jsonRes({ messages: [] }))
    const { result } = renderHook(() => useSabda({ fetchImpl }))
    await waitFor(() => expect(result.current.loaded).toBe(true))
    await act(async () => { await result.current.send('halo') })
    expect(result.current.messages).toHaveLength(0)
    act(() => {
      result.current.onChatDone({ id: 11, sender: 'owner', text: 'halo', timestamp: 3 })
    })
    expect(result.current.messages).toHaveLength(1)
  })
})
