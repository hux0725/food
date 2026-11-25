import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    // The API server (server/) runs on 3001 in development. Same-origin /api calls avoid CORS.
    proxy: {
      '/api': 'http://127.0.0.1:3001',
    },
  },
  preview: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
  },
})
