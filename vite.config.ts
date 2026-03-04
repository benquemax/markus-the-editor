import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron'
import renderer from 'vite-plugin-electron-renderer'
import path from 'path'

export default defineConfig({
  plugins: [
    react(),
    electron([
      {
        entry: 'electron/main.ts',
        // Don't auto-start electron — concurrently manages it in dev:full
        onstart() { /* noop */ },
        vite: {
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              // Using rollupOptions.input instead of lib mode to avoid a double-emit
              // bug: lib mode + entryFileNames causes Rollup to write main.js twice in
              // one pass, leaving trailing bytes from the larger first write that produce
              // a SyntaxError when Electron loads the file.
              input: 'electron/main.ts',
              external: ['electron', 'electron-store', 'chokidar', 'simple-git', 'express', 'ws', 'node-pty', 'mammoth', 'word-extractor', 'turndown', 'turndown-plugin-gfm', 'html-to-docx', 'pdfjs-dist/legacy/build/pdf.mjs', 'defuddle', 'defuddle/node', 'canvas'],
              output: {
                format: 'cjs',
                entryFileNames: 'main.js'
              }
            }
          }
        }
      },
      {
        entry: 'electron/preload.ts',
        // Don't auto-start electron — concurrently manages it in dev:full
        onstart() { /* noop */ },
        vite: {
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              // Same fix as main: input instead of lib mode to avoid double-emit.
              input: 'electron/preload.ts',
              external: ['electron'],
              output: {
                format: 'cjs',
                entryFileNames: 'preload.js'
              }
            }
          }
        }
      }
    ]),
    renderer()
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  },
  // Non-default port to avoid conflicts with other Vite projects
  server: {
    port: 5183
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true
  }
})
