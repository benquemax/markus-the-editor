#!/usr/bin/env node
/**
 * Build script for bundling core Markus modules.
 *
 * This bundles the electron/markus core modules into a single file
 * that the standalone server can import. This bypasses the module
 * resolution issues between bundler-style imports and Node's ESM.
 */

import * as esbuild from 'esbuild'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const projectRoot = join(__dirname, '../../..')
const serverRoot = join(__dirname, '..')

async function build() {
  console.log('[build-core] Bundling core modules...')

  await esbuild.build({
    entryPoints: [join(projectRoot, 'electron/markus/index-standalone.ts')],
    bundle: true,
    outfile: join(serverRoot, 'src/core/bundle.mjs'),
    format: 'esm',
    platform: 'node',
    target: 'node18',
    external: [
      // Node built-ins
      'fs', 'fs/promises', 'path', 'os', 'child_process', 'crypto',
      // External dependencies that should be resolved at runtime
      'js-yaml', 'fastest-levenshtein'
    ],
    // Handle electron shim
    alias: {
      'electron': join(serverRoot, 'src/shims/electron.ts')
    },
    logLevel: 'info'
  })

  console.log('[build-core] Done! Output: src/core/bundle.mjs')
}

build().catch(err => {
  console.error('[build-core] Failed:', err)
  process.exit(1)
})
