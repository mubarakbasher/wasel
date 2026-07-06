import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    // Do not emit source maps in production: they expose readable
    // original sources to anyone with access to the deployed bundle.
    sourcemap: false,
  },
  server: {
    // Fixed port so it never collides with the admin dev server (5173).
    port: 5174,
  },
})
