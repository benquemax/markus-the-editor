/**
 * Quake-style dropdown terminal panel.
 *
 * Slides down from the top of the editor area with a 200ms CSS transition.
 * Stays alive when hidden (PTY sessions persist via CSS display:none in
 * TerminalInstance). Supports multiple tabs, each with its own PTY.
 * Slightly transparent with backdrop blur for that classic quake look.
 */

import { useState, useCallback, useRef, useEffect } from 'react'
import { Terminal } from '@xterm/xterm'
import { GripHorizontal } from 'lucide-react'
import { cn } from '../../lib/utils'
import { TerminalTabs, TerminalTab } from './TerminalTabs'
import { TerminalInstance } from './TerminalInstance'

interface QuakeTerminalProps {
  visible: boolean
  height: number
  onHeightChange: (height: number) => void
  /** Called when visibility should toggle (e.g., last tab closed) */
  onToggle: () => void
  /** Default working directory for new terminals */
  cwd?: string
}

let tabCounter = 0

function createTab(): TerminalTab {
  tabCounter++
  return {
    id: `term-${tabCounter}`,
    title: `Terminal ${tabCounter}`
  }
}

export function QuakeTerminal({ visible, height, onHeightChange, onToggle, cwd }: QuakeTerminalProps) {
  const [tabs, setTabs] = useState<TerminalTab[]>(() => [createTab()])
  const [activeTabId, setActiveTabId] = useState<string>(() => tabs[0].id)
  const [isResizing, setIsResizing] = useState(false)
  const terminalRefs = useRef<Map<string, Terminal>>(new Map())

  // Focus the active terminal when the panel becomes visible
  useEffect(() => {
    if (visible) {
      // Small delay to let transition/layout complete
      const timer = setTimeout(() => {
        const term = terminalRefs.current.get(activeTabId)
        term?.focus()
      }, 220)
      return () => clearTimeout(timer)
    }
  }, [visible, activeTabId])

  const handleNewTab = useCallback(() => {
    const tab = createTab()
    setTabs(prev => [...prev, tab])
    setActiveTabId(tab.id)
  }, [])

  const handleCloseTab = useCallback((id: string) => {
    setTabs(prev => {
      const remaining = prev.filter(t => t.id !== id)
      if (remaining.length === 0) {
        // Last tab closed — hide the terminal panel
        onToggle()
        // Create a fresh tab for next time it opens
        const fresh = createTab()
        setActiveTabId(fresh.id)
        return [fresh]
      }

      // Switch to adjacent tab if closing active
      if (id === activeTabId) {
        const idx = prev.findIndex(t => t.id === id)
        const newIdx = Math.min(idx, remaining.length - 1)
        setActiveTabId(remaining[newIdx].id)
      }

      return remaining
    })
    terminalRefs.current.delete(id)
  }, [activeTabId, onToggle])

  const handleTabExit = useCallback((id: string) => {
    handleCloseTab(id)
  }, [handleCloseTab])

  const handleTerminalReady = useCallback((id: string, terminal: Terminal) => {
    terminalRefs.current.set(id, terminal)
  }, [])

  // Resize handle drag
  const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setIsResizing(true)
    const startY = e.clientY
    const startHeight = height

    const handleMouseMove = (e: MouseEvent) => {
      // Dragging down increases height
      const delta = e.clientY - startY
      const newHeight = Math.max(150, Math.min(600, startHeight + delta))
      onHeightChange(newHeight)
    }

    const handleMouseUp = () => {
      setIsResizing(false)
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }, [height, onHeightChange])

  return (
    <div
      className={cn(
        "absolute top-0 left-0 right-0 z-30 flex flex-col",
        "bg-background/95 backdrop-blur-sm border-b border-border",
        "transition-transform duration-200 ease-in-out",
        visible ? "translate-y-0" : "-translate-y-full"
      )}
      style={{ height }}
    >
      <TerminalTabs
        tabs={tabs}
        activeTabId={activeTabId}
        onTabClick={setActiveTabId}
        onTabClose={handleCloseTab}
        onNewTab={handleNewTab}
      />

      {/* Terminal instances — all stay mounted, only active one is visible */}
      <div className="flex-1 overflow-hidden relative">
        {tabs.map(tab => (
          <div key={tab.id} className="absolute inset-0">
            <TerminalInstance
              visible={visible && tab.id === activeTabId}
              cwd={cwd}
              onExit={() => handleTabExit(tab.id)}
              onReady={(terminal) => handleTerminalReady(tab.id, terminal)}
            />
          </div>
        ))}
      </div>

      {/* Resize handle at bottom */}
      <div
        className={cn(
          "h-1.5 cursor-row-resize flex items-center justify-center",
          "hover:bg-primary/30 active:bg-primary/50 transition-colors",
          isResizing && "bg-primary/50"
        )}
        onMouseDown={handleResizeMouseDown}
      >
        <GripHorizontal className="w-4 h-4 text-muted-foreground/50" />
      </div>
    </div>
  )
}
