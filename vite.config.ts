import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Hosts allowed to reach the dev server, supplied per-run by the environment.
const extraHosts = (process.env.VITE_ALLOWED_HOSTS ?? '')
  .split(',')
  .map((host) => host.trim())
  .filter(Boolean)

export default defineConfig({
  plugins: [react()],
  server: extraHosts.length > 0 ? { allowedHosts: extraHosts } : {},
})
