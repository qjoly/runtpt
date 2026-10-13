import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const src = (pkg: string) => fileURLToPath(new URL(`../${pkg}/src/index.ts`, import.meta.url))
const repoRoot = fileURLToPath(new URL('../..', import.meta.url))

// Aliased to sources so `npm run dev` works without building the workspace first.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@runtpt/core': src('core'),
      '@runtpt/format': src('format'),
      '@runtpt/protocol': src('protocol'),
    },
  },
  server: { fs: { allow: [repoRoot] } },
  build: { target: 'es2022' },
})
