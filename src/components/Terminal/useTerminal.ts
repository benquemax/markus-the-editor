/**
 * Hook that manages a single PTY session's lifecycle.
 *
 * Defers PTY creation until the caller provides initial dimensions
 * (via `start(cols, rows)`), so the shell's first prompt renders at
 * the correct width. Wires up data/exit listeners and returns helpers
 * for writing and resizing. Destroys the PTY on unmount.
 */

import { useEffect, useRef, useCallback, useState } from 'react'

interface UseTerminalOptions {
  cwd?: string
  onData: (data: string) => void
  onExit: (exitCode: number) => void
}

interface UseTerminalResult {
  ptyId: string | null
  /** Call once after xterm has been fitted to create the PTY at the right size */
  start: (cols: number, rows: number) => void
  write: (data: string) => void
  resize: (cols: number, rows: number) => void
}

export function useTerminal({ cwd, onData, onExit }: UseTerminalOptions): UseTerminalResult {
  const [ptyId, setPtyId] = useState<string | null>(null)
  const ptyIdRef = useRef<string | null>(null)
  const destroyedRef = useRef(false)
  const cleanupsRef = useRef<(() => void)[]>([])
  const onDataRef = useRef(onData)
  const onExitRef = useRef(onExit)
  const cwdRef = useRef(cwd)
  onDataRef.current = onData
  onExitRef.current = onExit
  cwdRef.current = cwd

  // Cleanup on unmount
  useEffect(() => {
    destroyedRef.current = false
    return () => {
      destroyedRef.current = true
      cleanupsRef.current.forEach(fn => fn())
      cleanupsRef.current = []
      if (ptyIdRef.current) {
        window.electron.terminal.destroy(ptyIdRef.current)
        ptyIdRef.current = null
      }
    }
  }, [])

  const start = useCallback(async (cols: number, rows: number) => {
    // Don't create twice
    if (ptyIdRef.current || destroyedRef.current) return

    const id = await window.electron.terminal.create(cwdRef.current, cols, rows)
    if (destroyedRef.current || !id) return

    ptyIdRef.current = id
    setPtyId(id)

    const unsubData = window.electron.terminal.onData((data: { id: string; data: string }) => {
      if (data.id === id) {
        onDataRef.current(data.data)
      }
    })
    cleanupsRef.current.push(unsubData)

    const unsubExit = window.electron.terminal.onExit((data: { id: string; exitCode: number }) => {
      if (data.id === id) {
        onExitRef.current(data.exitCode)
      }
    })
    cleanupsRef.current.push(unsubExit)
  }, [])

  const write = useCallback((data: string) => {
    if (ptyIdRef.current) {
      window.electron.terminal.write(ptyIdRef.current, data)
    }
  }, [])

  const resize = useCallback((cols: number, rows: number) => {
    if (ptyIdRef.current) {
      window.electron.terminal.resize(ptyIdRef.current, cols, rows)
    }
  }, [])

  return { ptyId, start, write, resize }
}
