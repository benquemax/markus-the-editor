#!/usr/bin/env node
/**
 * Build script for bundling the full Markus server into a single file.
 *
 * This produces dist-electron/markus-server.mjs which Electron's main process
 * can dynamically import to start the server in-process. The bundle includes
 * all server TypeScript, routes, websocket handling, and the pre-built core
 * modules (built by build-core.mjs).
 *
 * External dependencies (express, ws, etc.) are left unbundled since they'll
 * be available in node_modules at runtime.
 */

import * as esbuild from 'esbuild'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { execFileSync } from 'child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const serverRoot = join(__dirname, '..')
const projectRoot = join(serverRoot, '../..')

async function build() {
  // Step 1: Build core bundle first (server depends on it)
  console.log('[build-server] Building core bundle...')
  execFileSync('node', [join(__dirname, 'build-core.mjs')], {
    stdio: 'inherit',
    cwd: serverRoot
  })

  // Step 2: Bundle the full server
  console.log('[build-server] Bundling full server...')

  await esbuild.build({
    entryPoints: [join(serverRoot, 'src/server.ts')],
    bundle: true,
    outfile: join(projectRoot, 'dist-electron/markus-server.mjs'),
    format: 'esm',
    platform: 'node',
    target: 'node18',
    external: [
      // Node built-ins
      'fs', 'fs/promises', 'path', 'os', 'child_process', 'crypto',
      'http', 'https', 'net', 'url', 'stream', 'zlib', 'events',
      'buffer', 'querystring', 'string_decoder', 'util',
      // External npm dependencies — resolved at runtime from node_modules
      'express', 'ws', 'uuid', 'js-yaml', 'fastest-levenshtein'
    ],
    logLevel: 'info'
  })

  console.log('[build-server] Done! Output: dist-electron/markus-server.mjs')
}

build().catch(err => {
  console.error('[build-server] Failed:', err)
  process.exit(1)
})
