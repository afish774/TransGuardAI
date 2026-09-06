import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Allow tunnelled/preview hosts (e.g. *.e2b.app) in addition to localhost,
    // so the dev server can be reached through a proxied preview URL.
    allowedHosts: ['.e2b.app', 'localhost', '127.0.0.1'],
    proxy: {
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
      },
    },
  },
})

