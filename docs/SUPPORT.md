# Runtime support

What runs this, for how long, and what happens when that stops being true.

This page exists because "supported" is the word enterprise reviews ask about
and almost nobody defines. Here it has one meaning and no other:

> **Supported** = CI runs the full gate suite on that version, and a red gate
> on a supported version blocks the release.

Not "it probably works". Not "we would accept a patch". If a version is in
the table below, there is a leg of CI standing behind it; if it is not, there
is nothing.

## The matrix

| Node | Status upstream | Upstream EOL | Here |
|---|---|---|---|
| 22.x (Jod) | Maintenance LTS since 2025-10-21 | 2027-04-30 | **Supported — this is the floor** |
| 24.x (Krypton) | Active LTS, maintenance from 2026-10-20 | 2028-04-30 | **Supported — recommended** |

Dates are the OpenJS release schedule ([nodejs/Release](https://github.com/nodejs/release)),
not an estimate. `scripts/check-docs.py` fails if a version listed above is
past the EOL date printed next to it, so this table cannot quietly outlive
the thing it describes.

The floor is declared once, in `package.json` → `engines.node`, and
`scripts/verify.sh` reads it from there before installing anything. The table
above is checked against both that field and the CI matrix, so the three
cannot drift apart.

## Two honest notes on the matrix

**The floor is already a maintenance-only release.** Node 22 stopped getting
anything but critical and security fixes in October 2025 and is gone on
2027-04-30. That is fine today and will not be fine for long: anyone
deploying this fresh should deploy on 24. The floor stays at 22 because
raising it is a breaking change for existing installs and there is no
technical reason to force it yet — but it is a dated decision, not a
permanent one.

**Node 26 is not in the table, and becomes Active LTS on 2026-10-28.** It is
untested here. The honest status is "unknown", and writing "supported" for a
version no CI leg has ever run would be exactly the kind of claim the rest of
this repository exists to prevent. Adding a third matrix leg is cheap; it has
not been done yet.

## Why the floor exists at all

`better-sqlite3` is a native addon. A native addon is compiled against a
specific Node ABI, and when the ABI is wrong the failure is not a clean error
message — the process **crashes**. On Node 20 the backend suite dies with
SIGSEGV, and every gate downstream then reports numbers that are pure
fiction: zero frontend tests, dozens of backend failures, documentation
claims that appear to be lies.

That is the worst failure mode this project has, because it is
indistinguishable from the product being broken. So `scripts/verify.sh` checks
the runtime before it installs a single package, and says so in one line:

```
FAIL: this repo requires Node >= 22; you are running v20.20.2.
```

| Node | ABI | What happens |
|---|---|---|
| 20.20.2 | 115 | Refused by the preflight. Without it: SIGSEGV, fictional gate results |
| 22.23.3 | 127 | Supported |
| 24.x | 137 | Supported |

## When a version is dropped

A version leaves this table when upstream EOL passes, and not before. The
removal is a documented change in `handoff/LOG.md` with the CI matrix edited
in the same patch — never a silent deletion, because "we quietly stopped
testing that" is how a support claim becomes a lie.

Raising `engines.node` is treated as a breaking change and gets a major
version bump. Dropping a version from CI while leaving the floor alone is
not: it is an honesty correction, and it makes the product claim smaller.

## Operating system and deployment

CI runs on `ubuntu-latest`. The server is plain Node, Express and SQLite with
no platform-specific code, and `scripts/check-deployable.sh` gates against
hard-coded hosts, so nothing in the shipped tree assumes a particular
machine. Only Linux is tested. macOS is where it is developed and is expected
to work; Windows is neither tested nor expected to work, mostly on account of
path handling in the asset scripts.

`ubuntu-latest` moves to Ubuntu 26 on 2026-10-19. That is a scheduled change
to the runner under this matrix, not to the matrix itself, and it has not
been exercised here yet.

## What support does not mean

Nothing here is for sale: one owner, one token, MIT.
There is no uptime SLA, no response-time commitment on bug reports, and no
paid support contract. The product is a repository that can prove things
about itself; the support claim is exactly as large as the CI matrix and not
one version larger.

Security reports are the exception and do have a committed response window —
see [`SECURITY.md` → Coordinated disclosure](SECURITY.md#11-coordinated-disclosure).
