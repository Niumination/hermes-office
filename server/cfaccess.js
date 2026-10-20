/**
 * cfaccess.js — verify Cloudflare Access identity at the origin.
 *
 * Why this file exists
 * --------------------
 * The office wants no login form and no token in the browser. That is a
 * reasonable thing to want, and it is safe exactly when something else has
 * already proven who the visitor is before the request reaches us.
 *
 * A Cloudflare tunnel does NOT do that. It is an outbound connection from the
 * office host to Cloudflare's edge, so host firewall rules never see the
 * traffic and every visitor on the internet arrives at the socket as
 * 127.0.0.1. Treating "came through the tunnel" as "is the owner" published
 * the whole office, verified from outside.
 *
 * Cloudflare Access DOES do that. When a hostname sits behind an Access
 * policy, the edge authenticates the human once per device and then stamps
 * every forwarded request with a signed JWT in `Cf-Access-Jwt-Assertion`.
 * Verifying that signature here is what turns "no login" from a wish into a
 * property: the login happened, it just happened at the edge, weeks ago, and
 * the proof travels with the request.
 *
 * The header alone proves nothing — anyone can send a header. Only the
 * signature counts, which is why this module exists instead of a one-line
 * header check.
 */
import { createPublicKey, createVerify } from "crypto";

const b64urlToBuf = (s) =>
  Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");

/**
 * JWKS cache. Cloudflare rotates signing keys, so nothing is ever pinned.
 *
 * The cache holds the in-flight *promise*, not the resolved value. Caching
 * the value means reading the cache, awaiting a fetch, then writing back a
 * decision made before the await — two concurrent first-requests would race
 * and the later one could overwrite fresher keys with staler ones. Caching
 * the promise also collapses a thundering herd into a single fetch.
 */
const CERTS_TTL_MS = 10 * 60 * 1000;
let certs = null; // { team, at, p: Promise<keys|null> }

export function _resetCertsCache() {
  certs = null;
}

function fetchKeys(team, now, fetchImpl) {
  if (certs && certs.team === team && now - certs.at < CERTS_TTL_MS) return certs.p;

  const url = /^https?:\/\//.test(team)
    ? `${team.replace(/\/$/, "")}/cdn-cgi/access/certs` // tests point this at a stub
    : `https://${team}.cloudflareaccess.com/cdn-cgi/access/certs`;

  const p = (async () => {
    try {
      const res = await fetchImpl(url);
      if (!res.ok) return null;
      const body = await res.json();
      return Array.isArray(body?.keys) ? body.keys : null;
    } catch {
      return null;
    }
  })();

  const entry = { team, at: now, p };
  certs = entry;
  // A failed lookup must not be cached for ten minutes — drop it so the next
  // request retries. Only clear if we are still the current entry.
  p.then((keys) => {
    if (!keys && certs === entry) certs = null;
  });
  return p;
}

/**
 * Verify a Cloudflare Access JWT.
 *
 * Every check below has a reason to exist; none is decoration.
 *  - alg must be RS256 from the JWKS, never from the token. A token that
 *    names its own algorithm can name "none".
 *  - kid must match a published key, so a self-signed token fails.
 *  - aud must equal the Application Audience tag, so a token minted for a
 *    different app in the same Cloudflare team cannot be replayed here.
 *  - iss must be this team's domain.
 *  - exp / nbf with no grace beyond a small clock skew.
 *
 * @returns {Promise<{email?: string, sub?: string} | null>} payload or null
 */
export async function verifyAccessJwt(token, opts) {
  const { team, aud, now = Date.now(), fetchImpl = fetch, skewMs = 60_000 } = opts || {};
  if (!token || !team || !aud) return null;

  const parts = String(token).split(".");
  if (parts.length !== 3) return null;
  const [h64, p64, s64] = parts;

  let header, payload;
  try {
    header = JSON.parse(b64urlToBuf(h64).toString("utf8"));
    payload = JSON.parse(b64urlToBuf(p64).toString("utf8"));
  } catch {
    return null;
  }
  if (header?.alg !== "RS256" || !header?.kid) return null;

  const keys = await fetchKeys(team, now, fetchImpl);
  if (!keys) return null;
  const jwk = keys.find((k) => k.kid === header.kid && (k.kty === "RSA"));
  if (!jwk) return null;

  let pub;
  try {
    pub = createPublicKey({ key: jwk, format: "jwk" });
  } catch {
    return null;
  }

  const v = createVerify("RSA-SHA256");
  v.update(`${h64}.${p64}`);
  v.end();
  if (!v.verify(pub, b64urlToBuf(s64))) return null;

  const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!auds.includes(aud)) return null;

  const issOk = /^https?:\/\//.test(team)
    ? true // stub issuer in tests
    : payload.iss === `https://${team}.cloudflareaccess.com`;
  if (!issOk) return null;

  if (typeof payload.exp === "number" && now > payload.exp * 1000 + skewMs) return null;
  if (typeof payload.nbf === "number" && now < payload.nbf * 1000 - skewMs) return null;

  return { email: payload.email, sub: payload.sub };
}

/** Is Access-based auto-session configured at all? */
export function accessConfigured(env = process.env) {
  return Boolean(env.OFFICE_CF_ACCESS_TEAM && env.OFFICE_CF_ACCESS_AUD);
}

/**
 * May this request be auto-sessioned because Cloudflare Access vouched for it?
 * Unconfigured means no — this must fail closed like every other gate here.
 */
export async function mayAutoSessionViaAccess(req, env = process.env, deps = {}) {
  if (!accessConfigured(env)) return false;
  const jwt = req?.headers?.["cf-access-jwt-assertion"];
  if (!jwt) return false;
  const identity = await verifyAccessJwt(jwt, {
    team: env.OFFICE_CF_ACCESS_TEAM,
    aud: env.OFFICE_CF_ACCESS_AUD,
    now: deps.now,
    fetchImpl: deps.fetchImpl,
  });
  return Boolean(identity);
}
