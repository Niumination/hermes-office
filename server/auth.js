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
const CF_AND_PRIVATE_RANGES = (
  process.env.OFFICE_TRUSTED_PROXIES ||
  "198.41.0.0/16,198.44.0.0/14,162.158.0.0/15,172.64.0.0/13,131.0.72.0/22,103.21.244.0/22,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,100.64.0.0/10"
).split(",").map((s) => s.trim());

function ipInCidr(ip, cidr) {
  const [net, bits] = cidr.split("/");
  if (!net || bits === undefined) return false;
  const b = parseInt(bits, 10);
  const toN = (s) => s.split(".").reduce((a, o) => ((a << 8) + parseInt(o)) >>> 0, 0);
  return (toN(ip) & ((0xffffffff << (32 - b)) >>> 0)) === (toN(net) & ((0xffffffff << (32 - b)) >>> 0));
}

export function isTrustedProxyIp(ip) {
  if (!ip) return false;
  return CF_AND_PRIVATE_RANGES.some((c) => ipInCidr(ip, c));
}

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

export function createSession(token, now = Date.now()) {
  // purge expired
  for (const sid of sessionTokens.keys()) {
    const issued = parseInt(sid.split(".")[1]) || 0;
    if (now - issued > SESSION_TTL_MS) sessionTokens.delete(sid);
  }
  if (sessionTokens.size > 1000) return null;
  const sid = randomUUID() + "." + now;
  sessionTokens.set(sid, token);
  return sid;
}

export function sessionCookieHeader(sid) {
  return `office_session=${sid}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_MS / 1000}`;
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
