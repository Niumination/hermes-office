# Contributing — Hermes Office

## Repo conventions

- Branch: `main` (deployable), feature branches `feat/<name>`, fixes `fix/<name>`
- Commit style: conventional commits (`feat:`, `fix:`, `docs:`, `chore:` …)
- Server code: Node 22 ESM, no TypeScript (match Claude-Office server style)
- Frontend: React 18 + TypeScript + Vite

## Contract changes

`docs/EVENTS.md` adalah sumber kebenaran. Menambah event type:

1. Update `docs/EVENTS.md` (tipe + payload + contoh)
2. Update `server/eventbus.js` KNOWN_EVENTS + validator
3. Tambah golden payload di `tests/contract/`
4. Update bridge yang relevan (cloud hook / mac relay)
5. Bump minor version di package.json

## Testing

```bash
node --test tests/                 # server unit + contract
cd frontend && npm run build       # typecheck + build
```

## Before pushing

- [ ] Tidak ada token/secret di kode atau test fixtures
- [ ] sanitizeForGuest tetap hijau bila menyentuh event types
- [ ] Redaction rules tidak dilemahkan
