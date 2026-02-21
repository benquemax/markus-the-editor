/**
 * Wraps a single xterm.js Terminal with fit, image, and WebGL addons.
 *
 * Mounts once and stays mounted when hidden (via CSS display:none) to
 * preserve the terminal session. The FitAddon handles resize, ImageAddon
 * renders iTerm2 IIP sequences, and WebglAddon provides GPU-accelerated
 * rendering with an automatic canvas fallback.
 */

import { useEffect, useRef, useCallback } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { ImageAddon } from '@xterm/addon-image'
import { WebglAddon } from '@xterm/addon-webgl'
import { useTerminal } from './useTerminal'

interface TerminalInstanceProps {
  visible: boolean
  cwd?: string
  onExit: () => void
  /** Called when terminal is ready so parent can manage focus */
  onReady?: (terminal: Terminal) => void
}

export function TerminalInstance({ visible, cwd, onExit, onReady }: TerminalInstanceProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const mountedRef = useRef(false)

  // Stable callback for writing PTY data to the xterm instance
  const handlePtyData = useCallback((data: string) => {
    terminalRef.current?.write(data)
  }, [])

  const handlePtyExit = useCallback(() => {
    onExit()
  }, [onExit])

  const { write, resize } = useTerminal({
    cwd,
    onData: handlePtyData,
    onExit: handlePtyExit
  })

  // Initialize xterm.js once on mount
  useEffect(() => {
    if (mountedRef.current || !containerRef.current) return
    mountedRef.current = true

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Menlo, Monaco, monospace",
      theme: {
        background: 'transparent'
      },
      allowTransparency: true,
      scrollback: 5000,
      rightClickSelectsWord: true
    })

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)

    // Image addon for iTerm2 IIP protocol (used by vcat)
    const imageAddon = new ImageAddon()
    term.loadAddon(imageAddon)

    term.open(containerRef.current)

    // Try WebGL for better performance, fall back to canvas
    try {
      const webglAddon = new WebglAddon()
      webglAddon.onContextLoss(() => {
        webglAddon.dispose()
      })
      term.loadAddon(webglAddon)
    } catch {
      // Canvas renderer fallback — no action needed
    }

    fitAddon.fit()

    // Handle Ctrl+Shift+C/V for copy/paste — xterm.js swallows all
    // keyboard input by default, so we intercept these before they
    // reach the PTY
    term.attachCustomKeyEventHandler((e: KeyboardEvent) => {
      // Ctrl+Shift+C — copy selection
      if (e.ctrlKey && e.shiftKey && e.key === 'C' && e.type === 'keydown') {
        const selection = term.getSelection()
        if (selection) {
          navigator.clipboard.writeText(selection)
        }
        return false // prevent sending to PTY
      }
      // Ctrl+Shift+V — paste from clipboard
      if (e.ctrlKey && e.shiftKey && e.key === 'V' && e.type === 'keydown') {
        navigator.clipboard.readText().then(text => {
          if (text) write(text)
        })
        return false
      }
      return true // let everything else through to PTY
    })

    // Right-click context menu for copy/paste
    containerRef.current.addEventListener('contextmenu', (e: MouseEvent) => {
      e.preventDefault()
      const selection = term.getSelection()

      // Build a simple context menu using a temporary DOM element
      const existing = document.querySelector('.terminal-context-menu')
      if (existing) existing.remove()

      const menu = document.createElement('div')
      menu.className = 'terminal-context-menu'
      menu.style.cssText = `
        position: fixed; left: ${e.clientX}px; top: ${e.clientY}px; z-index: 100;
        background: hsl(var(--popover)); color: hsl(var(--popover-foreground));
        border: 1px solid hsl(var(--border)); border-radius: 6px;
        padding: 4px; min-width: 120px; box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      `

      const addItem = (label: string, enabled: boolean, onClick: () => void) => {
        const item = document.createElement('div')
        item.textContent = label
        item.style.cssText = `
          padding: 6px 12px; border-radius: 4px; cursor: ${enabled ? 'pointer' : 'default'};
          font-size: 13px; opacity: ${enabled ? '1' : '0.4'};
        `
        if (enabled) {
          item.addEventListener('mouseenter', () => { item.style.background = 'hsl(var(--accent))' })
          item.addEventListener('mouseleave', () => { item.style.background = 'transparent' })
          item.addEventListener('click', () => { onClick(); menu.remove() })
        }
        menu.appendChild(item)
      }

      addItem('Copy', !!selection, () => {
        if (selection) navigator.clipboard.writeText(selection)
      })
      addItem('Paste', true, () => {
        navigator.clipboard.readText().then(text => { if (text) write(text) })
      })

      document.body.appendChild(menu)

      // Close on click outside or escape
      const close = () => { menu.remove(); document.removeEventListener('click', close) }
      setTimeout(() => document.addEventListener('click', close), 0)
    })

    // Forward user keystrokes to PTY
    term.onData((data) => write(data))

    terminalRef.current = term
    fitAddonRef.current = fitAddon

    onReady?.(term)

    return () => {
      term.dispose()
      mountedRef.current = false
    }
    // write and onReady are stable refs, only mount once
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Fit terminal when visibility changes or window resizes
  useEffect(() => {
    if (!visible || !fitAddonRef.current || !terminalRef.current) return

    // Small delay to let CSS transition complete before measuring
    const timer = setTimeout(() => {
      fitAddonRef.current?.fit()
      const term = terminalRef.current
      if (term) {
        resize(term.cols, term.rows)
      }
    }, 50)

    const handleResize = () => {
      fitAddonRef.current?.fit()
      const term = terminalRef.current
      if (term) {
        resize(term.cols, term.rows)
      }
    }

    window.addEventListener('resize', handleResize)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('resize', handleResize)
    }
  }, [visible, resize])

  return (
    <div
      ref={containerRef}
      className="h-full w-full"
      style={{ display: visible ? 'block' : 'none' }}
    />
  )
}
