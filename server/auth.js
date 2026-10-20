/**
 * auth.js — Bearer token per-source auth (SECURITY.md §2).
 * Roles: cloud-bridge, mac-bridge (POST /event, GET /roster),
 *        owner (everything except /event).
 *
 * There is no guest role. This office has one occupant; a read-only public
 * view described a deployment that never existed, and every route that
 * accepted it widened the blast radius for no one's benefit.
 */
import { createHash, randomUUID } from "crypto";
import { config } from "./config.js";

/**
 * Cloudflare edge ranges (cf-ips /v4, 2026-10-18 snapshot) + private / tailnet
 * ranges, so that when the office is fronted by Cloudflare, req.ip reflects
 * the real client IP from X-Forwarded-For. Without this, every browser
 * request appears to come from Cloudflare's edge IP and the owner-origin
 * auto session in index.js can never match the tailnet allowlist.
 */
// Defaults are loopback only: the office is strictly private, so no
// third-party edge range ships in code. Set OFFICE_TRUSTED_PROXIES in
// .env.office to add Cloudflare edge ranges when the site is fronted by a
// Cloudflare tunnel and real client IPs must be resolved from
// X-Forwarded-For (the tunnel forwards the original client IP).
const CF_AND_PRIVATE_RANGES = (
  process.env.OFFICE_TRUSTED_PROXIES ||
  "127.0.0.1,::1"
).split(",").map((s) => s.trim());

const IPV4 = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;

/** `::ffff:127.0.0.1` is how an IPv4 peer looks on a dual-stack socket. */
function normalizeIp(ip) {
  if (!ip) return "";
  const s = String(ip).trim();
  return s.startsWith("::ffff:") ? s.slice(7) : s;
}

function ipInCidr(ip, cidr) {
  if (cidr.includes("/")) {
    const [net, bits] = cidr.split("/");
    const b = parseInt(bits, 10);
    // IPv4 maths only. An IPv6 address can never belong to an IPv4 CIDR, and
    // feeding one to the shift arithmetic below silently yields NaN — which
    // compares equal to nothing, but only by luck. Refuse explicitly.
    if (!IPV4.test(ip) || !IPV4.test(net) || !(b >= 0 && b <= 32)) return false;
    const toN = (s) => s.split(".").reduce((a, o) => ((a << 8) + parseInt(o)) >>> 0, 0);
    const mask = b === 0 ? 0 : (0xffffffff << (32 - b)) >>> 0;
    return (toN(ip) & mask) === (toN(net) & mask);
  }
  return ip === cidr; // bare IP = exact match
}

export function isTrustedProxyIp(ip) {
  const n = normalizeIp(ip);
  if (!n) return false;
  return CF_AND_PRIVATE_RANGES.some((c) => ipInCidr(n, c));
}

/**
 * Auto-session allowlist — who may be handed an owner cookie with no token.
 *
 * Default is EMPTY, which disables the feature outright. This must fail
 * closed: an office that mints owner sessions for everyone is strictly worse
 * than one that asks for a token, because no credential rotation can close
 * it. Opt in with OFFICE_AUTO_SESSION_CIDRS, e.g. "127.0.0.1,100.64.0.0/10"
 * for loopback plus the tailnet.
 */
const AUTO_SESSION_CIDRS = (process.env.OFFICE_AUTO_SESSION_CIDRS || "")
  .split(",").map((s) => s.trim()).filter(Boolean);

/**
 * Headers that only ever appear when the request crossed a reverse proxy or
 * tunnel. Their presence means the peer address is the tunnel, not the
 * visitor — so the office cannot tell a tailnet browser from the open
 * internet by IP, and must not try.
 */
const FORWARDED_HEADERS = [
  "x-forwarded-for", "forwarded", "x-real-ip",
  "cf-connecting-ip", "cf-ray", "true-client-ip",
];

export function cameThroughProxy(req) {
  const h = req?.headers || {};
  return FORWARDED_HEADERS.some((k) => typeof h[k] === "string" && h[k] !== "");
}

/**
 * May this request be given an owner session without presenting a token?
 *
 * Both conditions must hold, and both default to "no":
 *  1. the direct peer address is in OFFICE_AUTO_SESSION_CIDRS, and
 *  2. the request did not arrive through a proxy or tunnel.
 *
 * Condition 2 is the one that matters in this deployment. The Cloudflare
 * tunnel runs on the office host, so every visitor from the public internet
 * arrives at the socket as 127.0.0.1. An IP allowlist alone would therefore
 * hand an owner cookie to the entire internet while looking correct.
 */
export function mayAutoSession(req) {
  if (AUTO_SESSION_CIDRS.length === 0) return false;
  if (cameThroughProxy(req)) return false;
  return AUTO_SESSION_CIDRS.some((c) => ipInCidr(normalizeIp(req?.socket?.remoteAddress), c));
}

export const autoSessionEnabled = () => AUTO_SESSION_CIDRS.length > 0;

function hashToken(t) {
  return createHash("sha256").update(t).digest("hex");
}

// Map token-hash -> source identity (raw tokens never compared in a hot loop)
const TOKEN_SOURCES = [];
for (const [source, token] of Object.entries(config.tokens)) {
  if (token) TOKEN_SOURCES.push({ source, hash: hashToken(token) });
}

/** Extract bearer token from request. */
export function getBearer(req) {
  const h = req.headers["authorization"] || "";
  return h.startsWith("Bearer ") ? h.slice(7) : "";
}

/**
 * Resolve request identity. Returns null when unauthorized.
 * Accepts Bearer header (bridges/tools) or office_session cookie (browser,
 * obtained via POST /auth/session — keeps tokens out of URLs and logs).
 * @returns {{ source: "cloud"|"mac"|"owner", role: "bridge"|"owner" } | null}
 */
export function authenticate(req) {
  let token = getBearer(req);
  if (!token && req.headers?.cookie) {
    const m = /(?:^|;\s*)office_session=([A-Za-z0-9._-]+)/.exec(req.headers.cookie);
    if (m && sessionTokens.has(m[1])) token = sessionTokens.get(m[1]);
  }
  if (!token) return null;
  const h = hashToken(token);
  for (const entry of TOKEN_SOURCES) {
    if (entry.hash === h) {
        return {
          source: entry.source,
          role: entry.source === "owner" ? "owner" : "bridge",
        };
    }
  }
  return null;
}

// Session cookies: map random session id -> raw token (bounded, TTL 12h)
const sessionTokens = new Map();
const SESSION_TTL_MS = 12 * 3600 * 1000;

const MAX_SESSIONS = 1000;

export function createSession(token, now = Date.now()) {
  // purge expired
  for (const sid of sessionTokens.keys()) {
    const issued = parseInt(sid.split(".")[1]) || 0;
    if (now - issued > SESSION_TTL_MS) sessionTokens.delete(sid);
  }
  // Evict oldest rather than refuse. Refusing looks safer and is not: with a
  // bounded table and a 12h TTL, enough sessions in one window made
  // createSession return null and locked the owner out with a 429 until the
  // TTL expired. A full table is a reason to forget the oldest visitor, never
  // a reason to turn away the next one. Map preserves insertion order, and
  // ids are minted in time order, so the first key is the oldest.
  while (sessionTokens.size >= MAX_SESSIONS) {
    const oldest = sessionTokens.keys().next().value;
    if (oldest === undefined) break;
    sessionTokens.delete(oldest);
  }
  const sid = randomUUID() + "." + now;
  sessionTokens.set(sid, token);
  return sid;
}

/** Drop every live session. Used when credentials rotate. */
export function revokeAllSessions() {
  const n = sessionTokens.size;
  sessionTokens.clear();
  return n;
}

/**
 * `secure` must be set whenever the browser reached us over HTTPS, otherwise
 * the cookie is also sent over plain HTTP and any network between the browser
 * and the edge can lift an owner session off the wire. It is conditional
 * rather than always-on because the office is legitimately served over plain
 * HTTP on loopback and over a tailnet, where a Secure cookie would simply be
 * dropped by the browser and nothing would work.
 */
export function sessionCookieHeader(sid, { secure = false } = {}) {
  return `office_session=${sid}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_MS / 1000}` +
    (secure ? "; Secure" : "");
}

/** Did this request reach us over TLS, directly or through a trusted proxy? */
export function isSecureRequest(req) {
  if (req?.secure === true) return true;
  const xf = req?.headers?.["x-forwarded-proto"];
  if (typeof xf === "string" && xf.split(",")[0].trim().toLowerCase() === "https") return true;
  return req?.socket?.encrypted === true;
}


/** Middleware factory. `roles` undefined = any authenticated identity. */
export function requireAuth(roles) {
  return (req, res, next) => {
    const identity = authenticate(req);
    if (!identity) return res.status(401).json({ error: "Unauthorized" });
    if (roles && !roles.includes(identity.role)) {
      return res.status(403).json({ error: "Forbidden for role: " + identity.role });
    }
    req.identity = identity;
    next();
  };
}

export const requireBridge = requireAuth(["bridge", "owner"]);
export const requireOwner = requireAuth(["owner"]);
export const requireAny = requireAuth(["bridge", "owner"]);
