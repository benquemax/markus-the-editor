/**
 * Resolves paths for the vcat command in both dev and production builds.
 *
 * vcat needs two things to work:
 * 1. A Node.js binary (uses Electron's bundled one so it works without
 *    Node installed on the user's system)
 * 2. The vcat-render.mjs script path
 *
 * These are passed as environment variables to the PTY process so the
 * vcat shell script can find them.
 */

import path from 'path'
import { app } from 'electron'

export interface VcatEnv {
  MARKUS_NODE_BINARY: string
  MARKUS_VCAT_RENDERER: string
  MARKUS_VCAT_BIN_DIR: string
}

/**
 * Finds a usable Node.js binary path.
 *
 * process.execPath in Electron points to the Electron binary, which
 * opens a GUI window and doesn't exit cleanly when used to run scripts.
 * In production we can use `electron.exe --no-window` workarounds, but
 * the simplest approach is to find the system's Node binary, which is
 * fine since vcat is a developer-facing tool.
 */
function findNodeBinary(): string {
  // In dev, Node is always available (we're running in it)
  // In production, look for node in common locations
  const candidates = [
    process.env.NODE_PATH_OVERRIDE, // explicit override
    '/usr/bin/node',
    '/usr/local/bin/node',
  ].filter(Boolean) as string[]

  // Check PATH — most reliable cross-platform approach
  const { execFileSync } = require('child_process')
  try {
    const found = execFileSync('which', ['node'], { encoding: 'utf-8' }).trim()
    if (found) return found
  } catch {
    // which not available or node not in PATH
  }

  // Fallback to known locations
  const fs = require('fs')
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate
  }

  // Last resort — maybe it'll work
  return 'node'
}

export function getVcatEnv(): VcatEnv {
  const isPackaged = app.isPackaged
  const nodeBinary = findNodeBinary()

  let vcatDir: string
  if (isPackaged) {
    // In production, vcat is in extraResources
    vcatDir = path.join(process.resourcesPath, 'vcat')
  } else {
    // In dev, __dirname is dist-electron/ (compiled output), so we resolve
    // relative to the project root to find the source tree vcat directory
    vcatDir = path.join(__dirname, '..', 'electron', 'terminal', 'vcat')
  }

  return {
    MARKUS_NODE_BINARY: nodeBinary,
    MARKUS_VCAT_RENDERER: path.join(vcatDir, 'vcat-render.mjs'),
    MARKUS_VCAT_BIN_DIR: path.join(vcatDir, 'bin')
  }
}
