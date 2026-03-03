import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron'
import renderer from 'vite-plugin-electron-renderer'
import path from 'path'
import fs from 'fs'

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
            lib: {
              entry: 'electron/main.ts',
              formats: ['cjs']
            },
            rollupOptions: {
              external: ['electron', 'electron-store', 'chokidar', 'simple-git', 'express', 'ws', 'node-pty', 'mammoth', 'word-extractor', 'turndown', 'turndown-plugin-gfm', 'html-to-docx', 'pdfjs-dist/legacy/build/pdf.mjs', 'defuddle', 'defuddle/node', 'canvas'],
              output: {
                entryFileNames: 'main.js'
              },
              // Truncate stale output before each rebuild. Without this, the dev
              // watcher can leave trailing bytes from a previous larger build,
              // producing a SyntaxError on load. Writing an empty file (not just
              // unlinking) is more reliable: it avoids race conditions where Rollup
              // opens the file with a non-truncating mode on some platforms.
              plugins: [{
                name: 'clean-main',
                buildStart() {
                  try { fs.writeFileSync('dist-electron/main.js', '') } catch { /* ignore */ }
                }
              }]
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
            lib: {
              entry: 'electron/preload.ts',
              formats: ['cjs']
            },
            rollupOptions: {
              external: ['electron'],
              output: {
                entryFileNames: 'preload.js'
              },
              plugins: [{
                name: 'clean-preload',
                buildStart() {
                  try { fs.writeFileSync('dist-electron/preload.js', '') } catch { /* ignore */ }
                }
              }]
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
