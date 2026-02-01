/**
 * JSON Editor Component
 *
 * Split view with Monaco editor on the left and JSON tree view on the right.
 * Provides bi-directional sync between the raw JSON editor and the tree view.
 */

import { useState, useEffect, useCallback, useMemo } from 'react'
import { JSONTree } from 'react-json-tree'
import { MonacoWrapper } from './MonacoWrapper'
import { AlertCircle } from 'lucide-react'

interface JsonEditorProps {
  content: string
  onChange: (content: string) => void
  onSave: () => void
}

// Theme for JSONTree that matches our app styling
const jsonTreeTheme = {
  scheme: 'markus',
  author: 'markus',
  // Light theme colors (will be swapped in dark mode via CSS)
  base00: 'transparent',      // Background
  base01: '#f5f5f5',         // Lighter background (status bars)
  base02: '#e0e0e0',         // Selection background
  base03: '#8e8e8e',         // Comments, line numbers
  base04: '#969696',         // Dark foreground (status bars)
  base05: '#333333',         // Default foreground
  base06: '#2a2a2a',         // Light foreground
  base07: '#1a1a1a',         // Lighter foreground
  base08: '#e53935',         // Variables, null, undefined
  base09: '#fb8c00',         // Integers, Booleans
  base0A: '#fdd835',         // Classes, markup bold
  base0B: '#43a047',         // Strings, inherited class
  base0C: '#00acc1',         // Regular expressions
  base0D: '#1e88e5',         // Functions, methods
  base0E: '#8e24aa',         // Keywords
  base0F: '#6d4c41'          // Deprecated
}

// Dark theme for JSONTree
const jsonTreeDarkTheme = {
  ...jsonTreeTheme,
  base00: 'transparent',
  base01: '#262626',
  base02: '#3a3a3a',
  base03: '#888888',
  base04: '#b4b4b4',
  base05: '#e0e0e0',
  base06: '#f0f0f0',
  base07: '#ffffff',
  base08: '#ef5350',
  base09: '#ffb74d',
  base0A: '#fff176',
  base0B: '#66bb6a',
  base0C: '#4dd0e1',
  base0D: '#42a5f5',
  base0E: '#ce93d8',
  base0F: '#a1887f'
}

export function JsonEditor({ content, onChange, onSave }: JsonEditorProps) {
  const [parseError, setParseError] = useState<string | null>(null)

  // Detect if we're in dark mode
  const isDarkMode = document.documentElement.classList.contains('dark')

  // Parse JSON for tree view, with error handling
  const jsonData = useMemo(() => {
    if (!content.trim()) {
      setParseError(null)
      return null
    }

    try {
      const parsed = JSON.parse(content)
      setParseError(null)
      return parsed
    } catch (e) {
      setParseError((e as Error).message)
      return null
    }
  }, [content])

  // Listen for dark mode changes
  useEffect(() => {
    const observer = new MutationObserver(() => {
      // Force re-render when dark mode changes
    })
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class']
    })
    return () => observer.disconnect()
  }, [])

  const handleEditorChange = useCallback((value: string) => {
    onChange(value)
  }, [onChange])

  // Custom label renderer for the tree
  const labelRenderer = useCallback((keyPath: readonly (string | number)[]) => {
    const key = keyPath[0]
    return <span className="font-medium">{String(key)}</span>
  }, [])

  // Custom value renderer for the tree
  const valueRenderer = useCallback((
    valueAsString: unknown,
    value: unknown
  ) => {
    if (typeof value === 'string') {
      return <span className="text-green-600 dark:text-green-400">&quot;{String(valueAsString)}&quot;</span>
    }
    if (typeof value === 'number') {
      return <span className="text-orange-600 dark:text-orange-400">{String(valueAsString)}</span>
    }
    if (typeof value === 'boolean') {
      return <span className="text-blue-600 dark:text-blue-400">{String(valueAsString)}</span>
    }
    if (value === null) {
      return <span className="text-red-600 dark:text-red-400">null</span>
    }
    return <span>{String(valueAsString)}</span>
  }, [])

  return (
    <div className="h-full flex">
      {/* Left pane: Monaco editor */}
      <div className="flex-1 min-w-0 border-r border-border">
        <MonacoWrapper
          value={content}
          language="json"
          onChange={handleEditorChange}
          onSave={onSave}
        />
      </div>

      {/* Right pane: JSON tree view */}
      <div className="w-1/2 min-w-0 overflow-auto bg-background">
        {parseError ? (
          // Error state
          <div className="p-4 flex items-start gap-3 text-destructive">
            <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-medium">Invalid JSON</p>
              <p className="text-sm mt-1 opacity-80">{parseError}</p>
            </div>
          </div>
        ) : jsonData === null ? (
          // Empty state
          <div className="p-4 text-muted-foreground text-sm">
            Enter JSON on the left to see the tree view
          </div>
        ) : (
          // Tree view
          <div className="p-4">
            <JSONTree
              data={jsonData}
              theme={isDarkMode ? jsonTreeDarkTheme : jsonTreeTheme}
              invertTheme={false}
              hideRoot={false}
              shouldExpandNodeInitially={() => true}
              labelRenderer={labelRenderer}
              valueRenderer={valueRenderer}
            />
          </div>
        )}
      </div>
    </div>
  )
}
