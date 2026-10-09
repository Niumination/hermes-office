# AGENTS.md — rules for anything, human or agent, that edits this repo

Read this before the README. The README describes what the product is; this
describes how it is allowed to change.

Every rule below was paid for. None of them is style preference.

---

## 0. One command decides

```bash
bash scripts/verify.sh          # ~6 min, all 14 gates
bash scripts/verify.sh --fast   # ~1 min, skips the byte-exact sprite rebuild
```

Do not report work as finished without a green run pasted into your report.
"Tests passed" is not a report; the gate list is.

If anything looks inexplicably broken, run `bash scripts/check-handoff.sh`
**first**. It answers "is this tree what it claims to be?" — a question that
came back wrong nine times while this fork was built, and that makes every
other failure untrustworthy until settled.

---

## 1. Never edit a number to make a gate green

`check-docs.py` compares 92 documented claims against the repo. When it says
the doc is wrong, the doc is *usually* wrong — but not always. Twice the
honest fix was in the opposite direction:

- ARCHITECTURE.md claimed "250 sprites programmatically stylized". Only 100
  ever were. The number was right and the sentence was a lie.
- `docs/PRICING.md` sold "61 machine-verified claims" when the real figure
  was 87. Understating is still a false claim; it only survived because
  nothing executed it.

Ask which side is lying before editing either.

---

## 2. A check that can stop running is not a check

This repo's most persistent defect is not broken code. It is a verifier that
silently stops verifying.

`check-docs.py` once searched for `**N sprite** distilisasi`. Someone
reworded the sentence; the regex stopped matching; the check quietly stopped
running; the total dropped 79 → 78 and the suite still printed PASS.

So in `check-docs.py`, **no pattern is optional**:

```python
want(label, pattern, haystack, where)              # must match, or fail by name
want_all(label, pattern, haystack, where, minimum) # table must still have rows
```

Never reintroduce a bare `if m:` that skips. Never satisfy a "does the doc
state N?" check with a bare substring test — `"32" in doc` is also true of
`132`, and that exact coincidence kept a deleted table green.

---

## 3. Mutation-test every gate you add

A gate nobody has seen fail is a guess. Before claiming a new check works,
break the thing it guards and paste the failure.

Current record: 10/10 plate rules, 11 sprite mutations, 7 doc-checker
mutations, 4 handoff mutations. Add yours to the tally in `CHANGELOG-v2.md`.

---

## 4. A verifier must never write into what it verifies

`build-cast-sprites.py` originally wrote to a fixed path inside
`frontend/public/sprites/donghua/`. Calling it from the verifier would
overwrite the art being checked with possibly-broken output — verification
that destroys its own evidence.

Any builder a verifier invokes must accept `--out DIR` and be pointed at
scratch.

---

## 5. Art: restyle, never regenerate

- `art/originals/sprites/` (100 files) is the only source of truth for the
  `derived` sprites. **A missing originals tree is a hard stop, never a
  warning.** The pipeline once treated its own filtered output as pristine
  input and filtered it twice, destroying the art while printing
  `originals preserved`.
- `art/donghua-cast/` (16 renders) is the source for the 32 `built` sprites.
- Generated art is not reproducible. Hashes protect the **artifact**;
  `--regen` protects the **recipe**. Both are needed: a reversed mirror in
  the builder changes zero bytes on disk and passes every hash.
- Never produce a character's four facings as four separate generations.
  Identity drifts and the face changes when it turns. Generate front + rear,
  mirror for left/right.

---

## 6. Tests: poll for "it happened", sleep for "it must not"

A fixed sleep followed by a positive assertion is load-sensitive. `node --test`
runs files concurrently; on a loaded 2-core box a 10 ms timer missed its
second tick in 9 runs out of 10.

- "did X happen?" → `waitFor(() => cond, 5000)`
- "X must not happen" → a plain sleep is correct; waiting longer can only
  make it harder to pass, never easier

And never let a clock reach an assertion by accident. The kiosk stamps
`Date.now()` into the page; the redaction tests sweep the whole document for
forbidden substrings; a 13-digit epoch contains arbitrary 3-digit runs. That
cost ~20 minutes of red CI per day in one-second windows. Fixtures pin the
clock **and assert the pin cannot collide**.

---

## 7. Do not touch these without an explicit decision

- the per-source token model (`TOKEN_SOURCES`, `{source, hash}`)
- the redaction pipeline
- the `channel_msg` privacy contract
- guest sanitization — it must hold on **both** REST and WebSocket
- **an anchor failure must never deny an action or kill the process.** The
  ledger is evidence, not an authority.

---

## 8. Committing

`node_modules/`, `dist/`, `data/`, `*.db` are generated — never commit them.
`art/` **is** committed (5.2 MB): it is the input that makes 132 sprites
reproducible, and keeping it outside the repo is the defect that destroyed
the art once already.

After any deliberate change to tracked files:

```bash
bash scripts/check-handoff.sh --write   # re-record MANIFEST.sha256
```

Re-recording without reading what changed defeats the manifest. Read the
diff first.

`--write` refuses to run while `check-sprites.py` or `check-plates.py` is
red, because it once recorded a `SPRITES.json` that had silently reverted to
an older revision — and the resulting manifest then certified the damaged
tree as intact. An integrity tool that can be made to vouch for corruption
is worse than none: it ends the investigation. Override only when you know
why: `--write --force`.
