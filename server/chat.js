/**
 * chat.js — /chat/* routes: chat persistence + Hermes gateway proxy (SSE → WS)
 * and @mac A2A routing (ARCHITECTURE.md §5).
 */
import { Router } from "express";
import { addMessage, getMessages, markSeen, addReaction, clearMessages } from "./chat-db.js";
import { clampString, redact } from "./eventbus.js";
import { requireAny, requireOwner, requireAuth } from "./auth.js";
import { config } from "./config.js";

export function createChatRouter(broadcast, emitChatEvent) {
  const r = Router();
  const jsonOnly = (req, res, next) => {
    if (!req.is("application/json")) {
      return res.status(415).json({ error: "Content-Type: application/json required" });
    }
    next();
  };

  // --- read history (any authenticated role) ---
  r.get("/", requireAny, (req, res) => {
    const since = parseInt(req.query.since) || 0;
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    res.json({ messages: getMessages({ since, limit }) });
  });

  // --- user message from office UI (guests are read-only — SECURITY.md §2) ---
  r.post("/", requireAuth(["bridge", "owner"]), jsonOnly, (req, res) => {
    const { text } = req.body ?? {};
    const sender = clampString(req.body?.sender) || "owner";
    if (!text || typeof text !== "string") {
      return res.status(400).json({ error: "Missing text" });
    }

    // Slash commands (owner convenience, from upstream Claude-Office)
    if (text.startsWith("/")) {
      const cmd = text.split(" ")[0];
      let result = null;
      if (cmd === "/clear") {
        clearMessages();
        result = "🧹 Chat cleared";
      } else if (cmd === "/help") {
        result = "📋 Commands: /clear — wipe chat history, /help — this message";
      }
      if (result) {
        addMessage({ sender, text: clampString(text, 4000) });
        const sysMsg = addMessage({ sender: "system", text: result, isSystem: true });
        broadcast({ channel: "chat_done", data: sysMsg });
        return res.json({ ok: true });
      }
    }

    // @mac routing → A2A peer (ARCHITECTURE.md §5), anti-loop cap 1 turn
    if (/@mac\b/i.test(text)) {
      return handleA2aMac({ sender, text, req, res });
    }

    const msg = addMessage({ sender, text: redact(clampString(text, 4000)) });
    broadcast({ channel: "chat_done", data: msg });

    // Forward to Hermes gateway (non-stream path kept simple; stream path below)
    forwardToHermes({ text, sender }).catch((err) => {
      console.error("[chat] hermes proxy failed:", err.message);
    });

    res.json({ ok: true, id: msg.id });
  });

  // --- agent reply (bridge/owner) ---
  r.post("/reply", requireAuth(["bridge", "owner"]), jsonOnly, (req, res) => {
    const { text } = req.body ?? {};
    if (!text) return res.status(400).json({ error: "Missing text" });
    const msg = addMessage({
      sender: clampString(req.body?.sender) || "agent",
      role: clampString(req.body?.role) || "default",
      text: redact(clampString(text, 4000)),
    });
    broadcast({ channel: "chat_done", data: msg });
    res.json({ ok: true, id: msg.id });
  });

  r.post("/seen", requireAny, jsonOnly, (req, res) => {
    const { messageId } = req.body ?? {};
    if (!messageId) return res.status(400).json({ error: "Missing messageId" });
    markSeen(messageId);
    res.json({ ok: true });
  });

  r.post("/react", requireAny, jsonOnly, (req, res) => {
    const { messageId, emoji } = req.body ?? {};
    if (!messageId || !emoji) {
      return res.status(400).json({ error: "Missing messageId or emoji" });
    }
    const reactions = addReaction(messageId, clampString(emoji, 10) || "👍");
    broadcast({ channel: "reaction", data: { messageId, reactions } });
    res.json({ ok: true, reactions });
  });

  r.post("/typing", requireAny, jsonOnly, (req, res) => {
    const sender = clampString(req.body?.sender);
    if (!sender) return res.status(400).json({ error: "Missing sender" });
    broadcast({ channel: "typing", data: { sender } });
    res.json({ ok: true });
  });

  // --- Hermes gateway streaming proxy (owner) ---
  // POST /chat/completions { text } → streams WS chat_delta frames, chat_done at end
  r.post("/completions", requireOwner, jsonOnly, (req, res) => {
    const text = req.body?.text;
    if (!text) return res.status(400).json({ error: "Missing text" });
    res.json({ ok: true, note: "streaming via WS" });
    streamFromHermes({ text, sender: "owner" }).catch((err) =>
      console.error("[chat] stream failed:", err.message)
    );
  });

  // ---------------------------------------------------------------------------
  // A2A @mac routing — one turn, cooldown 60s per context (SECURITY.md §8)
  // ---------------------------------------------------------------------------
  let lastA2aAt = 0;

  async function handleA2aMac({ sender, text, res }) {
    const now = Date.now();
    if (now - lastA2aAt < config.a2aCooldownMs) {
      return res.status(429).json({
        error: `@mac cooldown: retry in ${Math.ceil((config.a2aCooldownMs - (now - lastA2aAt)) / 1000)}s`,
      });
    }
    lastA2aAt = now;

    addMessage({ sender, text: clampString(text, 4000) });

    try {
      const body = {
        jsonrpc: "2.0",
        id: `office-${now}`,
        method: "message/send",
        params: {
          message: {
            role: "user",
            parts: [{ kind: "text", text: text.replace(/@mac\b/gi, "").trim() }],
          },
        },
      };
      const headers = { "Content-Type": "application/json" };
      if (config.hermesA2aMacToken) headers.Authorization = `Bearer ${config.hermesA2aMacToken}`;
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), 30_000);
      const resp = await fetch(`${config.hermesA2aMacUrl}/`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: ac.signal,
      });
      clearTimeout(t);
      const data = await resp.json().catch(() => ({}));
      // Extract first text part from A2A response
      let reply = "";
      const parts = data?.result?.parts || data?.result?.message?.parts || [];
      for (const p of parts) if (p.text) { reply += p.text; break; }
      if (!reply) reply = data?.result?.status?.message?.parts?.[0]?.text || "(mac: empty reply)";

      const msg = addMessage({ sender: "mac", role: "a2a", text: redact(clampString(reply, 4000)) });
      broadcast({ channel: "chat_done", data: msg });
      return res.json({ ok: true, id: msg.id });
    } catch (err) {
      console.error("[chat] a2a mac failed:", err.message);
      const msg = addMessage({ sender: "system", text: `@mac failed: ${err.message}`, isSystem: true });
      broadcast({ channel: "chat_done", data: msg });
      return res.status(502).json({ error: "A2A mac unreachable" });
    }
  }

  // ---------------------------------------------------------------------------
  // Hermes gateway proxy — POST {HERMES_API}/v1/chat/completions (stream:true)
  // ---------------------------------------------------------------------------
  async function streamFromHermes({ text, sender }) {
    const resp = await fetch(`${config.hermesApi}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "default",
        stream: true,
        messages: [{ role: "user", content: text }],
      }),
    });
    if (!resp.ok || !resp.body) {
      throw new Error(`hermes api ${resp.status}`);
    }
    let full = "";
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() || "";
      for (const line of lines) {
        const s = line.trim();
        if (!s.startsWith("data:")) continue;
        const payload = s.slice(5).trim();
        if (payload === "[DONE]") continue;
        try {
          const j = JSON.parse(payload);
          const delta = j.choices?.[0]?.delta?.content || "";
          if (delta) {
            full += delta;
            broadcast({ channel: "chat_delta", data: { sender, delta } });
          }
        } catch {}
      }
    }
    full = redact(clampString(full, 4000) || "");
    if (full) {
      const msg = addMessage({ sender, role: "assistant", text: full });
      broadcast({ channel: "chat_done", data: msg });
    }
    return full;
  }

  async function forwardToHermes(opts) {
    return streamFromHermes(opts);
  }

  return r;
}
