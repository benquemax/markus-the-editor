/**
 * Hook that manages a single PTY session's lifecycle.
 *
 * Creates a PTY via IPC on mount, wires up data/exit listeners, and
 * returns helpers for writing and resizing. Destroys the PTY on unmount
 * to prevent orphaned processes.
 */

import { useEffect, useRef, useCallback, useState } from 'react'

interface UseTerminalOptions {
  cwd?: string
  onData: (data: string) => void
  onExit: (exitCode: number) => void
}

interface UseTerminalResult {
  ptyId: string | null
  write: (data: string) => void
  resize: (cols: number, rows: number) => void
}

export function useTerminal({ cwd, onData, onExit }: UseTerminalOptions): UseTerminalResult {
  const [ptyId, setPtyId] = useState<string | null>(null)
  const ptyIdRef = useRef<string | null>(null)
  const onDataRef = useRef(onData)
  const onExitRef = useRef(onExit)
  onDataRef.current = onData
  onExitRef.current = onExit

  useEffect(() => {
    let destroyed = false
    const cleanups: (() => void)[] = []

    const init = async () => {
      const id = await window.electron.terminal.create(cwd)
      if (destroyed || !id) return

      ptyIdRef.current = id
      setPtyId(id)

      // Listen for PTY output
      const unsubData = window.electron.terminal.onData((data: { id: string; data: string }) => {
        if (data.id === id) {
          onDataRef.current(data.data)
        }
      })
      cleanups.push(unsubData)

      // Listen for PTY exit
      const unsubExit = window.electron.terminal.onExit((data: { id: string; exitCode: number }) => {
        if (data.id === id) {
          onExitRef.current(data.exitCode)
        }
      })
      cleanups.push(unsubExit)
    }

    init()

    return () => {
      destroyed = true
      cleanups.forEach(fn => fn())
      if (ptyIdRef.current) {
        window.electron.terminal.destroy(ptyIdRef.current)
        ptyIdRef.current = null
      }
    }
  }, [cwd])

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

  return { ptyId, write, resize }
}
