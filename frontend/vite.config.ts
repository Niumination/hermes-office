import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base './' so built assets resolve under BOTH a path prefix
// (e.g. example.com/office/) and a dedicated subdomain.
export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    port: 3333,
    // Same-origin dev proxy to the office-server (WS + chat API).
    proxy: {
      '/ws': { target: 'ws://localhost:3334', ws: true },
      '/chat': { target: 'http://localhost:3334', changeOrigin: true },
      '/roster': { target: 'http://localhost:3334', changeOrigin: true },
    },
  },
})
