import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}', 'electron/**/*.{test,spec}.{ts,tsx}'],
    server: {
      deps: {
        // defuddle/node is a Node.js-only package (Electron external). Mark it external
        // so Vitest's Vite doesn't try to resolve/transform it in the jsdom environment.
        // Tests that need it use vi.mock('defuddle/node') to provide a test double.
        external: ['defuddle', /defuddle/]
      }
    }
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  }
})
