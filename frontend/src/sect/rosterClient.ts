/**
 * rosterClient — fetches /roster, the list of agents this office is configured
 * to run.
 *
 * WHY THE UI NEEDS THIS AND NEVER HAD IT
 * --------------------------------------
 * Three sources answer "who exists", and until now the frontend read only two:
 *
 *   /policy    occupants — who the server has PLACED in a hall. Needs an event
 *              before an agent appears, so a configured agent that has never
 *              run is absent.
 *   /presence  heartbeats — who has been SEEN. Same gap: no event, no entry.
 *   /roster    configuration — who is SUPPOSED to be here. No event required.
 *
 * `mac` and `boss` sit in /roster and in neither of the others, so the office
 * drew one agent out of three and looked broken. The missing third source was
 * never fetched by a single line of frontend code.
 *
 * WHAT THIS MUST NOT BE USED FOR
 * ------------------------------
 * The roster says an agent is configured. It does NOT say where it is, and it
 * does not say it is alive. Placing a roster entry into a hall as though the
 * server put it there would be the UI inventing a location — the exact fault
 * that made the floor plan untrustworthy before. Callers draw these as ghosts,
 * in their own strip, labelled for what they are.
 */

export interface RosterAgent {
  id: string
  role?: string
}

interface WireAgent {
  name?: string
  role?: string
}

/**
 * Fetch /roster. Never throws: like the ladder, the roster is an enrichment.
 * A failed fetch must leave the office drawing what it already knows rather
 * than white-screening, so this returns an empty list on any failure.
 */
export async function fetchRoster(
  fetchImpl: typeof fetch = fetch,
): Promise<RosterAgent[]> {
  try {
    const res = await fetchImpl('/roster', { credentials: 'include' })
    if (!res.ok) return []
    const body: unknown = await res.json()
    const raw = (body as { agents?: unknown })?.agents
    if (!Array.isArray(raw)) return []
    const out: RosterAgent[] = []
    for (const a of raw as WireAgent[]) {
      const id = typeof a?.name === 'string' ? a.name.trim() : ''
      if (!id) continue
      out.push({ id, role: typeof a?.role === 'string' ? a.role : undefined })
    }
    return out
  } catch {
    return []
  }
}
