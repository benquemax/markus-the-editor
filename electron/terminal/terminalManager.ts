/**
 * Terminal Manager — manages node-pty pseudo-terminal instances.
 *
 * Each terminal gets a unique ID and its own PTY process. The manager handles
 * spawning, writing, resizing, and killing PTYs. It also injects the `vcat`
 * command into PATH via environment variables so users can view images/PDFs
 * inline without installing anything globally.
 */

import * as pty from 'node-pty'
import { getVcatEnv } from './vcatPath'

interface ManagedTerminal {
  pty: pty.IPty
  onData: (data: string) => void
  onExit: (exitCode: number) => void
}

const terminals = new Map<string, ManagedTerminal>()
let nextId = 1

/**
 * Spawns a new PTY process with the user's default shell.
 * Injects vcat into PATH so `vcat <file>` works out of the box.
 */
export function createTerminal(
  cwd: string,
  cols: number,
  rows: number,
  onData: (data: string) => void,
  onExit: (exitCode: number) => void
): string {
  const id = `pty-${nextId++}`
  const shell = process.env.SHELL || '/bin/bash'
  const vcatEnv = getVcatEnv()

  // Prepend vcat's bin directory to PATH so the shell can find it
  const env = {
    ...process.env,
    ...vcatEnv,
    PATH: vcatEnv.MARKUS_VCAT_BIN_DIR
      ? `${vcatEnv.MARKUS_VCAT_BIN_DIR}:${process.env.PATH}`
      : process.env.PATH
  } as Record<string, string>

  const terminal = pty.spawn(shell, [], {
    name: 'xterm-256color',
    cols,
    rows,
    cwd,
    env
  })

  terminal.onData((data: string) => onData(data))
  terminal.onExit(({ exitCode }) => {
    terminals.delete(id)
    onExit(exitCode)
  })

  terminals.set(id, { pty: terminal, onData, onExit })
  return id
}

export function writeTerminal(id: string, data: string): void {
  terminals.get(id)?.pty.write(data)
}

export function resizeTerminal(id: string, cols: number, rows: number): void {
  terminals.get(id)?.pty.resize(cols, rows)
}

export function destroyTerminal(id: string): void {
  const t = terminals.get(id)
  if (t) {
    t.pty.kill()
    terminals.delete(id)
  }
}

export function destroyAllTerminals(): void {
  for (const [id, t] of terminals) {
    t.pty.kill()
    terminals.delete(id)
  }
}
