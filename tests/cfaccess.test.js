/**
 * cfaccess.test.js — Cloudflare Access JWT verification.
 *
 * This is the module that lets the office keep a public hostname and still
 * have no login form: the edge authenticates once per device, then signs
 * every forwarded request. The whole value of that arrangement rests on the
 * signature actually being checked, so these tests are written as attacks
 * rather than as happy paths.
 *
 * Keys are generated here, and the JWKS endpoint is a local stub, so the
 * tests never reach Cloudflare and never need the network.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, createSign, randomUUID } from "crypto";
import { verifyAccessJwt, mayAutoSessionViaAccess, accessConfigured, _resetCertsCache } from "../server/cfaccess.js";

const b64url = (buf) =>
  Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

function makeKey(kid) {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: "jwk" }), kid, alg: "RS256", use: "sig" };
  return { jwk, privateKey, kid };
}

function sign(privateKey, header, payload) {
  const h = b64url(JSON.stringify(header));
  const p = b64url(JSON.stringify(payload));
  const s = createSign("RSA-SHA256");
  s.update(`${h}.${p}`);
  s.end();
  return `${h}.${p}.${b64url(s.sign(privateKey))}`;
}

const TEAM = "http://127.0.0.1:0"; // url form => stub issuer, no network
const AUD = "aud-" + randomUUID();
const NOW = 1_800_000_000_000;

function stubFetch(keys, { ok = true } = {}) {
  return async () => ({ ok, json: async () => ({ keys }) });
}

function goodToken(key, over = {}) {
  return sign(key.privateKey,
    { alg: "RS256", kid: key.kid, typ: "JWT" },
    { aud: AUD, email: "owner@example.test", sub: "u1",
      exp: Math.floor(NOW / 1000) + 3600, nbf: Math.floor(NOW / 1000) - 10, ...over });
}

const verify = (tok, key, over = {}) =>
  verifyAccessJwt(tok, { team: TEAM, aud: AUD, now: NOW, fetchImpl: stubFetch([key.jwk]), ...over });

test("a correctly signed Access token is accepted", async () => {
  _resetCertsCache();
  const k = makeKey("k1");
  const id = await verify(goodToken(k), k);
  assert.equal(id?.email, "owner@example.test");
});

test("a token signed by someone else is refused", async () => {
  _resetCertsCache();
  const real = makeKey("k1");
  const attacker = makeKey("k1"); // same kid, different key
  const forged = sign(attacker.privateKey,
    { alg: "RS256", kid: "k1", typ: "JWT" },
    { aud: AUD, exp: Math.floor(NOW / 1000) + 3600 });
  assert.equal(await verify(forged, real), null);
});

test("alg:none is refused — the token may not name its own algorithm", async () => {
  _resetCertsCache();
  const k = makeKey("k1");
  const h = b64url(JSON.stringify({ alg: "none", kid: "k1" }));
  const p = b64url(JSON.stringify({ aud: AUD, exp: Math.floor(NOW / 1000) + 3600 }));
  assert.equal(await verify(`${h}.${p}.`, k), null);
});

test("algorithm-confusion: an HS256 token signed with the public key is refused", async () => {
  // The classic attack: take the published RSA public key, use it as an HMAC
  // secret, and claim alg:HS256. It fails here for a structural reason worth
  // stating — verifyAccessJwt pins RSA-SHA256 at the verifier and never reads
  // alg from the token to decide how to check it. The header check is a
  // second line, not the only one.
  _resetCertsCache();
  const k = makeKey("k1");
  const { createHmac } = await import("crypto");
  const h = b64url(JSON.stringify({ alg: "HS256", kid: "k1", typ: "JWT" }));
  const p = b64url(JSON.stringify({ aud: AUD, exp: Math.floor(NOW / 1000) + 3600 }));
  const secret = Buffer.from(k.jwk.n, "base64url");
  const sig = b64url(createHmac("sha256", secret).update(`${h}.${p}`).digest());
  assert.equal(await verify(`${h}.${p}.${sig}`, k), null);
});

test("an unknown kid is refused", async () => {
  _resetCertsCache();
  const k = makeKey("k1");
  const other = makeKey("k2");
  assert.equal(await verify(goodToken(other), k), null);
});

test("a token minted for a different Access application is refused", async () => {
  _resetCertsCache();
  const k = makeKey("k1");
  assert.equal(await verify(goodToken(k, { aud: "some-other-app" }), k), null);
});

test("an expired token is refused, and clock skew is bounded", async () => {
  _resetCertsCache();
  const k = makeKey("k1");
  const expired = goodToken(k, { exp: Math.floor(NOW / 1000) - 600 });
  assert.equal(await verify(expired, k), null);
  _resetCertsCache();
  const justExpired = goodToken(k, { exp: Math.floor(NOW / 1000) - 10 });
  assert.notEqual(await verify(justExpired, k), null, "10s inside the skew window is fine");
});

test("garbage, empty and truncated tokens are refused without throwing", async () => {
  _resetCertsCache();
  const k = makeKey("k1");
  for (const t of ["", "a", "a.b", "a.b.c", "....", null, undefined, "%%%.%%%.%%%"]) {
    assert.equal(await verify(t, k), null, `refused: ${JSON.stringify(t)}`);
  }
});

test("a JWKS endpoint that fails closes the door", async () => {
  _resetCertsCache();
  const k = makeKey("k1");
  assert.equal(
    await verifyAccessJwt(goodToken(k),
      { team: TEAM, aud: AUD, now: NOW, fetchImpl: stubFetch([k.jwk], { ok: false }) }),
    null);
});

test("unconfigured Access never vouches for anybody", async () => {
  _resetCertsCache();
  assert.equal(accessConfigured({}), false);
  const req = { headers: { "cf-access-jwt-assertion": "anything" } };
  assert.equal(await mayAutoSessionViaAccess(req, {}), false);
  assert.equal(await mayAutoSessionViaAccess(req, { OFFICE_CF_ACCESS_TEAM: "t" }), false,
    "half-configured is still unconfigured");
});

test("the bare header without a signature vouches for nobody", async () => {
  _resetCertsCache();
  const k = makeKey("k1");
  const env = { OFFICE_CF_ACCESS_TEAM: TEAM, OFFICE_CF_ACCESS_AUD: AUD };
  assert.equal(
    await mayAutoSessionViaAccess({ headers: { "cf-access-jwt-assertion": "not-a-jwt" } }, env,
      { now: NOW, fetchImpl: stubFetch([k.jwk]) }),
    false);
  assert.equal(await mayAutoSessionViaAccess({ headers: {} }, env, { now: NOW, fetchImpl: stubFetch([k.jwk]) }), false);
});
