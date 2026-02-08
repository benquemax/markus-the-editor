#!/usr/bin/env node

/**
 * Markus Server CLI
 *
 * Starts the Markus standalone API server.
 *
 * Usage:
 *   markus-server [options]
 *
 * Environment variables:
 *   MARKUS_PORT - Server port (default: 3847)
 *   MARKUS_HOST - Server host (default: localhost)
 *   MARKUS_DEBUG - Enable debug logging (default: false)
 *   MARKUS_CORS - Enable CORS (default: false)
 */

import { spawn } from 'child_process'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const serverDir = join(__dirname, '..')

// Run with tsx
const child = spawn('npx', ['tsx', '--tsconfig', 'tsconfig.json', 'src/index.ts'], {
  cwd: serverDir,
  stdio: 'inherit',
  shell: true
})

child.on('error', (err) => {
  console.error('Failed to start Markus server:', err)
  process.exit(1)
})

child.on('exit', (code) => {
  process.exit(code || 0)
})
