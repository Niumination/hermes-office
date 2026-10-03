/**
 * auth.js — Bearer token per-source auth (SECURITY.md §2).
 * Roles: cloud-bridge, mac-bridge (POST /event, GET /roster),
 *        owner (everything except /event), guest (read-only, filtered).
 */
import { createHash } from "crypto";
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
 * @returns {{ source: "cloud"|"mac"|"owner"|"guest", role: "bridge"|"owner"|"guest" } | null}
 */
export function authenticate(req) {
  const token = getBearer(req);
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
