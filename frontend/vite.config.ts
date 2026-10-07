/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base './' so built assets resolve under BOTH a path prefix
// (e.g. example.com/office/) and a dedicated subdomain.
const API_PORT = process.env.OFFICE_PORT || '7333'

// Every server route the browser may call in dev mode.
//
// This list has now been wrong twice. It was first hardcoded to the wrong
// port, so every API call 404'd; then /event, /health, /presence, /github and
// /auth were found missing. This time the gap was the entire Fase 1-4 surface
// — /burn, /approvals, /policy, /ledger, /dossier, /budget — which meant the
// burn HUD, the approval gate and the audit badge silently did nothing under
// `npm run dev` while working perfectly in a production build.
//
// Keeping it as one explicit list, rather than scattered entries, is what
// makes an omission visible on review.
const HTTP_ROUTES = [
  // core
  '/chat', '/roster', '/event', '/health', '/presence', '/github', '/auth',
  // Fase 1 — OTLP ingest
  '/v1',
  // Fase 2 — burn rate
  '/burn', '/budget',
  // Fase 3 — policy as floor plan
  '/policy', '/approvals', '/agents',
  // Fase 4 — flight recorder
  '/ledger', '/dossier',
]

export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    port: 3333,
    // Same-origin dev proxy to the office-server (WS + REST).
    proxy: {
      '/ws': { target: `ws://localhost:${API_PORT}`, ws: true },
      ...Object.fromEntries(
        HTTP_ROUTES.map((path) => [
          path,
          { target: `http://localhost:${API_PORT}`, changeOrigin: true },
        ])
      ),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    // The components under test are the governance surfaces; a stray network
    // call that silently resolves would hide a real regression, so fetch is
    // stubbed per-test and left undefined otherwise.
    restoreMocks: true,
    clearMocks: true,
    // CSS is stubbed out by default, which also empties `?raw` imports.
    // styles/cascade.test.ts needs the real stylesheet text to prove the
    // theme layer still wins without !important.
    css: true,
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
