/**
 * auth.js — Bearer token per-source auth (SECURITY.md §2).
 * Roles: cloud-bridge, mac-bridge (POST /event, GET /roster),
 *        owner (everything except /event), guest (read-only, filtered).
 */
import { createHash, randomUUID } from "crypto";
import { config } from "./config.js";

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
 * @returns {{ source: "cloud"|"mac"|"owner"|"guest", role: "bridge"|"owner"|"guest" } | null}
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
        role:
          entry.source === "owner"
            ? "owner"
            : entry.source === "guest"
              ? "guest"
              : "bridge",
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
  for (const [sid, t] of sessionTokens) {
    const issued = parseInt(sid.split(".")[1]) || 0;
    if (now - issued > SESSION_TTL_MS) sessionTokens.delete(sid);
  }
  if (sessionTokens.size > 1000) return null;
  const sid = crypto.randomUUID() + "." + now;
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
export const requireAny = requireAuth(["bridge", "owner", "guest"]);
