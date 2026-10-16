/**
 * ecosystem — the owner's two workplaces, written down as data.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Every place name this office drew before today came from somewhere else.
 * The eight room ids (`lobby`, `kitchen`, `nap-room`, …) were inherited verbatim
 * from the `W17ant/Claude-Office` fork — a generic Western startup floor plan —
 * and donghua names were painted over them one by one. Neither layer described
 * the owner's work. The office drew a kitchen and a nap room; the ecosystem has
 * neither. It did not draw `apps/`, `skills/` or `9router`; those exist.
 *
 * The correction is not a new coat of paint. It is a chain:
 *
 *     OFFICE  →  ROOM  →  DESK  →  AGENT
 *     machine    category  repo    telegram topic
 *
 * The UI is correct when it can say one sentence truthfully:
 *
 *     "Orkestrator in Mac · room Root · desk mirai"
 *
 * and wrong when it cannot. That sentence is the whole specification.
 *
 * WHAT IS A FACT HERE
 * -------------------
 * Everything below is transcribed from the owner's own repositories, never
 * inferred. Each block carries its source. Two consequences follow:
 *
 *   - An agent is a Telegram topic, not an archetype. `cast.ts` guessed
 *     'scholar' and 'alchemist' from role strings; the owner had already
 *     rejected exactly that, in writing, inside `topics.json`:
 *     "Nilai bukan research/writer/developer generik MIRAI."
 *     The warning predated the mistake.
 *
 *   - A room is a folder, not a mood. On the Mac the one-home rule guarantees
 *     a project lives in exactly one folder, so a desk's room is never
 *     ambiguous and never needs a lookup table.
 *
 * WHAT THIS FILE MUST NEVER DO
 * ----------------------------
 * Invent a room on LightVela to match one on the Mac. The Mac has sixteen root
 * folders; LightVela has a handful of services and no folder taxonomy at all.
 * Mirroring the Mac onto the cloud would repeat the original error in a new
 * direction. LightVela gets the rooms LightVela actually has.
 *
 * PRIVATE REPOSITORIES
 * --------------------
 * Two desks are marked `private`. Their existence, owner and room are facts and
 * are drawn. Their contents are never read by this project and never rendered.
 * A private desk is drawn as a closed desk, not as an empty one — the office
 * says "you are not being shown this", never "there is nothing here".
 */

export type OfficeId = 'mac' | 'lightvela'

// ---------------------------------------------------------------------------
// Offices
// ---------------------------------------------------------------------------

export interface EcoOffice {
  id: OfficeId
  /** What the owner calls it. */
  label: string
  icon: string
  /** Hostname as it appears in the owner's own docs. */
  host: string
  /** Tailscale address — the two machines reach each other on :9900. */
  tailscale: string
  /** Filesystem root of the ecosystem on that machine. */
  root: string
  /** Telegram supergroup that fronts this office's agents. */
  chatId: string
  chatTitle: string
  /** One line: what this machine is for. */
  purpose: string
}

/**
 * Source: ecosystem-config/AGENTS.md (Mac tree), ecosystem-config/docs/registry/
 * a2a-hermes-mac-vps.md (addresses), and lightvela-cloud-ekosistem.md (cloud SSOT,
 * audit 5 Oct 2026).
 */
export const OFFICES: Record<OfficeId, EcoOffice> = {
  mac: {
    id: 'mac',
    label: 'Mac',
    icon: '💻',
    host: 'zhalls-macbook-pro',
    tailscale: '100.120.57.37',
    root: '~/Desktop/Niumination',
    chatId: '-1004204696417',
    chatTitle: 'Niu-MissionControl',
    purpose: 'Ekosistem terstruktur — 16 folder akar, aturan one-home.',
  },
  lightvela: {
    id: 'lightvela',
    label: 'LightVela',
    icon: '☁️',
    host: 'vm-6-34-ubuntu',
    tailscale: '100.65.20.34',
    root: '~/niumination',
    chatId: '',
    chatTitle: '',
    purpose: 'Server awan — proyek baru yang tidak ada di Mac, plus layanan hidup.',
  },
}

export const OFFICE_ORDER: readonly OfficeId[] = ['mac', 'lightvela'] as const

// ---------------------------------------------------------------------------
// Rooms
// ---------------------------------------------------------------------------

export interface EcoRoom {
  id: string
  office: OfficeId
  label: string
  icon: string
  /** Where this room comes from on disk, so the name can be checked. */
  path: string
  /** Root rooms are drawn first and larger: they hold the ecosystem itself. */
  isRoot: boolean
  note?: string
}

/**
 * Mac rooms are the root folders of `~/Desktop/Niumination`, transcribed from
 * the tree in AGENTS.md. Counts are the owner's own, not recomputed here.
 *
 * `root` is a real room, not a fallback: `mirai/` is a submodule sitting at the
 * top level of the ecosystem, which is precisely why the owner describes it as
 * "mirai termasuk di root ekosistem mac".
 */
const MAC_ROOMS: EcoRoom[] = [
  { id: 'root',     office: 'mac', label: 'Root Ekosistem', icon: '🗺️', path: '~/Desktop/Niumination', isRoot: true,
    note: 'AGENTS.md · BACKLOG.md · mirai/' },
  { id: 'apps',     office: 'mac', label: 'Apps',      icon: '🏭', path: 'apps/',     isRoot: false, note: 'tayang, teruji' },
  { id: 'services', office: 'mac', label: 'Services',  icon: '🔧', path: 'services/', isRoot: false, note: 'backend & mesin' },
  { id: 'sites',    office: 'mac', label: 'Sites',     icon: '🌐', path: 'sites/',    isRoot: false, note: 'frontend' },
  { id: 'desktop',  office: 'mac', label: 'Desktop',   icon: '🖥️', path: 'desktop/',  isRoot: false, note: 'aplikasi native' },
  { id: 'agents',   office: 'mac', label: 'Agents',    icon: '🤖', path: 'agents/',   isRoot: false, note: 'AI + otomasi' },
  { id: 'labs',     office: 'mac', label: 'Labs',      icon: '🔬', path: 'labs/',     isRoot: false, note: 'eksperimen' },
  { id: 'dinas',    office: 'mac', label: 'Dinas',     icon: '🏛️', path: 'dinas/',    isRoot: false, note: 'administrasi ASN' },
  { id: 'brain',    office: 'mac', label: 'Brain',     icon: '📚', path: 'brain/',    isRoot: false, note: 'Obsidian vault' },
  { id: 'skills',   office: 'mac', label: 'Skills',    icon: '🧠', path: 'skills/',   isRoot: false, note: '238 skill · 21 domain' },
  { id: 'tools',    office: 'mac', label: 'Tools',     icon: '🛠️', path: 'tools/',    isRoot: false },
  { id: 'vault',    office: 'mac', label: 'Vault',     icon: '🔐', path: 'vault/',    isRoot: false, note: 'rahasia — isinya tak pernah digambar' },
]

/**
 * LightVela has no folder taxonomy, so its rooms are the groupings the owner
 * named when listing that office's Telegram topics: the ecosystem root, the
 * infrastructure it keeps alive, and the content studio.
 *
 * Deliberately short. Inventing `apps/` and `sites/` here to match the Mac
 * would be the same error this file was written to undo.
 */
const LIGHTVELA_ROOMS: EcoRoom[] = [
  { id: 'root',    office: 'lightvela', label: 'Root Ekosistem', icon: '🗺️', path: '~/niumination', isRoot: true,
    note: 'hermes-office/' },
  { id: 'infra',   office: 'lightvela', label: 'Infrastruktur & Monitoring', icon: '🛰️', path: 'layanan systemd + funnel', isRoot: false,
    note: '9router · gateway · cron · octo' },
  { id: 'content', office: 'lightvela', label: 'Content Studio', icon: '🎬', path: 'contentvela/', isRoot: false },
]

export const ROOMS: readonly EcoRoom[] = [...MAC_ROOMS, ...LIGHTVELA_ROOMS]

export function roomsOf(office: OfficeId): EcoRoom[] {
  return ROOMS.filter((r) => r.office === office)
}

export function roomAt(office: OfficeId, id: string): EcoRoom | undefined {
  return ROOMS.find((r) => r.office === office && r.id === id)
}

// ---------------------------------------------------------------------------
// Desks — a desk is a repository
// ---------------------------------------------------------------------------

export interface EcoDesk {
  /** Unique within its office. */
  id: string
  office: OfficeId
  room: string
  label: string
  /** `owner/name` on GitHub, or null for things that live only on disk. */
  repo: string | null
  /**
   * A private repo. Drawn as a closed desk. This project never reads it; the
   * owner's LightVela agent does that work, because LightVela is already wired
   * to GitHub over an authorised path.
   */
  private: boolean
  /** Live service this desk corresponds to, when there is one. */
  port?: number
  note?: string
}

/**
 * Transcribed from ecosystem-config/docs/registry/project-catalog.md and the
 * AGENTS.md tree. Not every repo in the account appears: 40 of the 93 public
 * repos are dotfile forks with no desk in either office.
 */
const MAC_DESKS: EcoDesk[] = [
  // root — the ecosystem itself
  { id: 'mirai', office: 'mac', room: 'root', label: 'mirai', repo: 'Niumination/mirai', private: false, port: 8800,
    note: 'MIRAI Mission Control — proyek inti ekosistem' },
  { id: 'ecosystem-config', office: 'mac', room: 'root', label: 'ecosystem-config', repo: 'Niumination/ecosystem-config', private: false,
    note: 'SSOT — AGENTS.md · BACKLOG.md' },

  // dinas — private, pinned
  { id: 'asn-admin', office: 'mac', room: 'dinas', label: 'asn-admin', repo: 'Niumination/asn-admin', private: true,
    note: 'naskah dinas — output ASN dilarang masuk repo publik' },

  // apps
  { id: 'niu-lkh', office: 'mac', room: 'apps', label: 'Niu-LKH', repo: 'Niumination/Niu-LKH', private: false },
  { id: 'pemdi-aceh-tengah', office: 'mac', room: 'apps', label: 'PemdiAcehTengah', repo: 'Niumination/PemdiAcehTengah', private: false },
  { id: 'niu-gayo-agroclimate', office: 'mac', room: 'apps', label: 'niu-gayo-agroclimate', repo: 'Niumination/niu-gayo-agroclimate', private: false },
  { id: 'niu-vermilion', office: 'mac', room: 'apps', label: 'niu-vermilion', repo: 'Niumination/Niu-Vermilion', private: false },
  { id: 'niu-dash', office: 'mac', room: 'apps', label: 'niu-dash', repo: 'Niumination/niu-dash', private: false },
  { id: 'cc-switch', office: 'mac', room: 'apps', label: 'cc-switch', repo: 'Niumination/cc-switch', private: false },
  { id: 'kune-ya', office: 'mac', room: 'apps', label: 'kune-ya.com', repo: 'Niumination/kune-ya.com', private: false },
  { id: 'mac-web-dashboard', office: 'mac', room: 'apps', label: 'mac-web-dashboard', repo: 'Niumination/mac-web-dashboard', private: false },
  { id: 'niumination-restore', office: 'mac', room: 'apps', label: 'niumination-restore', repo: 'Niumination/niumination-restore', private: true },

  // services
  { id: 'sapa-ai', office: 'mac', room: 'services', label: 'sapa-ai', repo: 'Niumination/sapa-ai', private: false },
  { id: 'niu-cast', office: 'mac', room: 'services', label: 'niu-cast', repo: 'Niumination/niu-cast', private: false },
  { id: 'latticesend', office: 'mac', room: 'services', label: 'latticesend', repo: null, private: false, note: 'blueprint' },

  // sites
  { id: 'niu-oss-dashboard', office: 'mac', room: 'sites', label: 'Niu-OSS-Dashboard', repo: 'Niumination/Niu-OSS-Dashboard', private: false },
  { id: 'audit-ti-at', office: 'mac', room: 'sites', label: 'AuditTI-AT', repo: 'Niumination/AuditTI-AT', private: false },
  { id: 'tedeo-kanban', office: 'mac', room: 'sites', label: 'TEDEO-Kanban', repo: null, private: false },
  { id: 'spatial-vision', office: 'mac', room: 'sites', label: 'spatial-vision', repo: 'Niumination/spatial-vision', private: false },

  // desktop
  { id: 'flame-ade', office: 'mac', room: 'desktop', label: 'Flame-ADE', repo: 'Niumination/Flame-ADE', private: false },
  { id: 'didong-code', office: 'mac', room: 'desktop', label: 'didong-code', repo: 'Niumination/didong-code', private: false },
  { id: 'x-downloader', office: 'mac', room: 'desktop', label: 'x-downloader', repo: 'Niumination/x-downloader', private: false },

  // labs
  { id: 'mata-aihackfest', office: 'mac', room: 'labs', label: 'mata-aihackfest-2026', repo: 'Niumination/mata-aihackfest-2026', private: false },
  { id: 'maze-3d', office: 'mac', room: 'labs', label: 'maze-3d', repo: 'Niumination/Maze-3D-Game---Web-Based', private: false },

  // brain / skills
  { id: 'brain', office: 'mac', room: 'brain', label: 'brain', repo: null, private: false, note: 'Obsidian vault — lokal' },
  { id: 'skill-bank', office: 'mac', room: 'skills', label: 'skills', repo: null, private: false, note: '238 skill' },
]

/**
 * LightVela desks. `hermes-office` sits at the root of `~/niumination`, which is
 * why the owner says it belongs to "root ekosistem lightvela" — the same shape
 * as `mirai` on the Mac.
 *
 * Ports and exposure come from lightvela-cloud-ekosistem.md §1.
 */
const LIGHTVELA_DESKS: EcoDesk[] = [
  { id: 'hermes-office', office: 'lightvela', room: 'root', label: 'hermes-office', repo: 'Niumination/hermes-office', private: false, port: 7333,
    note: 'Funnel / — kantor ini sendiri' },

  { id: '9router', office: 'lightvela', room: 'infra', label: '9router', repo: null, private: false, port: 20128,
    note: '803 model · 3 combo · tailnet-only :9443' },
  { id: 'hermes-gateway', office: 'lightvela', room: 'infra', label: 'Hermes Gateway', repo: null, private: false,
    note: 'Telegram · WhatsApp · LightClaw' },
  { id: 'office-octo', office: 'lightvela', room: 'infra', label: 'Office Octo', repo: null, private: false,
    note: 'bridge — internal' },
  { id: 'hermes-cron', office: 'lightvela', room: 'infra', label: 'Hermes Cron', repo: null, private: false,
    note: '5 job → topik #55' },
  { id: 'agroclimate-live', office: 'lightvela', room: 'infra', label: 'Agro-Climate (tayang)', repo: 'Niumination/niu-gayo-agroclimate', private: false, port: 7444,
    note: 'Funnel /agroclimate · API :7455 — dikembangkan di Mac' },

  { id: 'contentvela', office: 'lightvela', room: 'content', label: 'contentvela', repo: 'Niumination/contentvela', private: false,
    note: 'Content Creator Workspace' },
]

export const DESKS: readonly EcoDesk[] = [...MAC_DESKS, ...LIGHTVELA_DESKS]

export function desksOf(office: OfficeId, room?: string): EcoDesk[] {
  return DESKS.filter((d) => d.office === office && (room === undefined || d.room === room))
}

export function deskAt(office: OfficeId, id: string): EcoDesk | undefined {
  return DESKS.find((d) => d.office === office && d.id === id)
}

// ---------------------------------------------------------------------------
// Agents — an agent is a Telegram topic
// ---------------------------------------------------------------------------

export interface EcoAgent {
  /** Scoped by office on purpose: `mac/general` is not `lightvela/general`. */
  id: string
  office: OfficeId
  label: string
  /**
   * Forum topic id in the office's supergroup. `null` for the primary agent:
   * a message with no thread id reaches the inbox, which IS the main agent.
   */
  topicId: number | null
  /** The office's main agent — the one the owner talks to directly. */
  primary: boolean
  /**
   * A pinned agent only ever works one desk. The owner named two:
   * ASN works `asn-admin` and nothing else; Contentvela works `contentvela`.
   * Every other agent roams.
   */
  pinnedDesk: string | null
}

/**
 * Mac roster. Topic ids are verbatim from
 * mirai/fleet/plugins/telegram_topic_profiles/topics.json, chat -1004204696417
 * ("Niu-MissionControl"). That file carries the owner's own instruction:
 *
 *     "General (id 1) sengaja tidak di map: pesan tanpa thread id
 *      = agent utama / inbox."
 *
 * so the primary agent is modelled as topicId null rather than as topic 1.
 */
const MAC_AGENTS: EcoAgent[] = [
  { id: 'mac/utama',       office: 'mac', label: 'Agen Utama',      topicId: null,  primary: true,  pinnedDesk: null },
  { id: 'mac/orkestrator', office: 'mac', label: 'Orkestrator',     topicId: 13902, primary: false, pinnedDesk: null },
  { id: 'mac/research',    office: 'mac', label: 'Research',        topicId: 802,   primary: false, pinnedDesk: null },
  { id: 'mac/builder',     office: 'mac', label: 'Builder',         topicId: 803,   primary: false, pinnedDesk: null },
  { id: 'mac/qa',          office: 'mac', label: 'QA',              topicId: 804,   primary: false, pinnedDesk: null },
  { id: 'mac/kreator',     office: 'mac', label: 'Kreator',         topicId: 1172,  primary: false, pinnedDesk: null },
  { id: 'mac/serbaguna',   office: 'mac', label: 'Serbaguna',       topicId: 7402,  primary: false, pinnedDesk: null },
  { id: 'mac/cron',        office: 'mac', label: 'Cron & Otomasi',  topicId: 12595, primary: false, pinnedDesk: null },
  { id: 'mac/edu',         office: 'mac', label: 'Edu Content',     topicId: 12707, primary: false, pinnedDesk: null },
  { id: 'mac/asn',         office: 'mac', label: 'ASN',             topicId: 8853,  primary: false, pinnedDesk: 'asn-admin' },
]

/**
 * LightVela roster. Topic ids given by the owner on 17 Oct 2026; they are not
 * published in any repository this project can read, so there is no file to
 * check them against — with one exception that checks itself.
 *
 * Topic 55 is corroborated: lightvela-cloud-ekosistem.md §5 records that all
 * five Hermes cron jobs deliver to "topik #55", and cron output is exactly
 * infrastructure and monitoring traffic. The id and the room agree without
 * having been made to.
 *
 * Note the difference from the Mac, which is real and not a transcription
 * slip. There, topic 1 is deliberately unmapped because an unthreaded message
 * IS the main agent's inbox. Here the owner runs General as its own topic
 * alongside a separate primary agent, so topic 1 is carried as a topic.
 */
const LIGHTVELA_AGENTS: EcoAgent[] = [
  { id: 'lightvela/utama',       office: 'lightvela', label: 'Agen Utama',                 topicId: null, primary: true,  pinnedDesk: null },
  { id: 'lightvela/infra',       office: 'lightvela', label: 'Infrastruktur & Monitoring', topicId: 55,   primary: false, pinnedDesk: null },
  { id: 'lightvela/general',     office: 'lightvela', label: 'General',                    topicId: 1,    primary: false, pinnedDesk: null },
  { id: 'lightvela/studio',      office: 'lightvela', label: 'Content Studio',             topicId: 838,  primary: false, pinnedDesk: null },
  { id: 'lightvela/contentvela', office: 'lightvela', label: 'Contentvela',                topicId: 5,    primary: false, pinnedDesk: 'contentvela' },
]

export const AGENTS: readonly EcoAgent[] = [...MAC_AGENTS, ...LIGHTVELA_AGENTS]

export function agentsOf(office: OfficeId): EcoAgent[] {
  return AGENTS.filter((a) => a.office === office)
}

export function agentAt(id: string): EcoAgent | undefined {
  return AGENTS.find((a) => a.id === id)
}

/** Agents that may never move desk. Two today; the number is data, not a rule. */
export function pinnedAgents(office?: OfficeId): EcoAgent[] {
  return AGENTS.filter((a) => a.pinnedDesk !== null && (office === undefined || a.office === office))
}

/**
 * Where an agent is allowed to be drawn.
 *
 * A pinned agent has exactly one legal desk, so a report placing it anywhere
 * else is a bug in the reporter and must not be rendered: drawing it would be
 * the office inventing a location, which is the one thing it may never do.
 */
export function mayWorkAt(agent: EcoAgent, deskId: string): boolean {
  if (agent.pinnedDesk !== null) return agent.pinnedDesk === deskId
  const desk = deskAt(agent.office, deskId)
  return desk !== undefined
}

// ---------------------------------------------------------------------------
// Placement — the one sentence the UI must be able to say
// ---------------------------------------------------------------------------

export interface Placement {
  agent: EcoAgent
  room: EcoRoom
  desk: EcoDesk
}

/**
 * Resolve "who is where" into office → room → desk, or return null.
 *
 * Null is a real answer and the caller must render it as one. The failure this
 * office has already shipped once is translating "not known" into "zero": a
 * signed-out viewer was shown `MURID 0` and `AMANAT 0` while the server was
 * answering 401 eleven times. MIRAI's own roster.py had the right word for that
 * state years before — `unreachable`, "never an exception". Null here means
 * unreachable, not empty.
 */
export function placeAgent(agentId: string, deskId: string): Placement | null {
  const agent = agentAt(agentId)
  if (!agent) return null
  const desk = deskAt(agent.office, deskId)
  if (!desk) return null
  if (!mayWorkAt(agent, deskId)) return null
  const room = roomAt(agent.office, desk.room)
  if (!room) return null
  return { agent, room, desk }
}

/** The sentence, rendered. Used by tests to hold the spec to its word. */
export function describePlacement(p: Placement): string {
  const office = OFFICES[p.agent.office]
  return `${p.agent.label} di ${office.label} · ruang ${p.room.label} · meja ${p.desk.label}`
}
