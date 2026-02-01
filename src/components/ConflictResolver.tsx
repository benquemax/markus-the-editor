/**
 * Conflict Resolver Component
 *
 * A full-screen modal for resolving Git merge conflicts. Displays conflicting
 * sections side-by-side with resolution options including AI-powered merging.
 * Designed to be user-friendly for writers who may not be familiar with Git.
 */

import { useState, useCallback, useEffect } from 'react'
import { X, ChevronLeft, ChevronRight, Check, Sparkles, Loader2, Settings, Eye } from 'lucide-react'
import { FileConflict, resolveSection, allConflictsResolved, rebuildFromConflicts } from '../lib/conflictParser'
import { cn } from '../lib/utils'

interface ConflictResolverProps {
  conflict: FileConflict
  onResolve: (resolvedContent: string) => void
  onCancel: () => void
}

interface AiSettings {
  enabled: boolean
  apiEndpoint: string
  apiKey: string
  model: string
}

export function ConflictResolver({ conflict: initialConflict, onResolve, onCancel }: ConflictResolverProps) {
  const [conflict, setConflict] = useState(initialConflict)
  const [currentIndex, setCurrentIndex] = useState(0)
  const [showPreview, setShowPreview] = useState(false)
  const [aiLoading, setAiLoading] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)
  const [showAiSettings, setShowAiSettings] = useState(false)
  const [aiSettings, setAiSettings] = useState<AiSettings | null>(null)
  const [testingConnection, setTestingConnection] = useState(false)

  const currentSection = conflict.sections[currentIndex]
  const isResolved = allConflictsResolved(conflict)
  const resolvedCount = conflict.sections.filter(s => s.resolvedContent !== null).length

  // Load AI settings
  useEffect(() => {
    window.electron.ai.getSettings().then(setAiSettings)
  }, [])

  const handleResolve = useCallback((sectionId: string, content: string) => {
    setConflict(prev => resolveSection(prev, sectionId, content))
    setAiError(null)
  }, [])

  const handleKeepLocal = useCallback(() => {
    handleResolve(currentSection.id, currentSection.localContent)
  }, [currentSection, handleResolve])

  const handleKeepRemote = useCallback(() => {
    handleResolve(currentSection.id, currentSection.remoteContent)
  }, [currentSection, handleResolve])

  const handleKeepBoth = useCallback(() => {
    const combined = currentSection.localContent + '\n\n' + currentSection.remoteContent
    handleResolve(currentSection.id, combined)
  }, [currentSection, handleResolve])

  const handleAiMerge = useCallback(async () => {
    if (!aiSettings?.apiKey) {
      setShowAiSettings(true)
      return
    }

    setAiLoading(true)
    setAiError(null)

    try {
      const result = await window.electron.ai.merge(
        currentSection.localContent,
        currentSection.remoteContent
      )

      if (result.success && result.merged) {
        handleResolve(currentSection.id, result.merged)
      } else {
        setAiError(result.error || 'Failed to merge with AI')
      }
    } catch (err) {
      setAiError(String(err))
    } finally {
      setAiLoading(false)
    }
  }, [currentSection, aiSettings, handleResolve])

  const handleSaveAll = useCallback(() => {
    if (!isResolved) return
    const resolvedContent = rebuildFromConflicts(conflict)
    onResolve(resolvedContent)
  }, [conflict, isResolved, onResolve])

  const handlePrevious = useCallback(() => {
    setCurrentIndex(prev => Math.max(0, prev - 1))
  }, [])

  const handleNext = useCallback(() => {
    setCurrentIndex(prev => Math.min(conflict.sections.length - 1, prev + 1))
  }, [conflict.sections.length])

  const handleSaveAiSettings = useCallback(async (settings: Partial<AiSettings>) => {
    const updated = await window.electron.ai.setSettings(settings)
    setAiSettings(updated)
  }, [])

  const handleTestConnection = useCallback(async () => {
    setTestingConnection(true)
    try {
      const result = await window.electron.ai.testConnection()
      if (result.success) {
        setAiError(null)
        setShowAiSettings(false)
      } else {
        setAiError(result.error || 'Connection test failed')
      }
    } catch (err) {
      setAiError(String(err))
    } finally {
      setTestingConnection(false)
    }
  }, [])

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showAiSettings) {
          setShowAiSettings(false)
        } else if (showPreview) {
          setShowPreview(false)
        } else {
          onCancel()
        }
      } else if (e.key === 'ArrowLeft' && !showAiSettings) {
        handlePrevious()
      } else if (e.key === 'ArrowRight' && !showAiSettings) {
        handleNext()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [showAiSettings, showPreview, onCancel, handlePrevious, handleNext])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/95">
      <div className="w-full h-full max-w-6xl max-h-[90vh] m-4 bg-popover border border-border rounded-lg shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div>
            <h2 className="text-lg font-semibold">Resolve Differences</h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              {resolvedCount} of {conflict.sections.length} resolved
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowPreview(!showPreview)}
              className={cn(
                "p-2 rounded hover:bg-muted transition-colors",
                showPreview && "bg-muted"
              )}
              title="Preview result"
            >
              <Eye className="w-4 h-4" />
            </button>
            <button
              onClick={() => setShowAiSettings(!showAiSettings)}
              className={cn(
                "p-2 rounded hover:bg-muted transition-colors",
                showAiSettings && "bg-muted"
              )}
              title="AI settings"
            >
              <Settings className="w-4 h-4" />
            </button>
            <button
              onClick={onCancel}
              className="p-2 rounded hover:bg-muted transition-colors"
              title="Cancel (Esc)"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* AI Settings Panel */}
        {showAiSettings && aiSettings && (
          <div className="px-6 py-4 border-b border-border bg-muted/50">
            <h3 className="text-sm font-medium mb-3">AI Merge Settings</h3>
            <div className="grid gap-3 max-w-xl">
              <div>
                <label className="text-xs text-muted-foreground block mb-1">API Endpoint</label>
                <input
                  type="text"
                  value={aiSettings.apiEndpoint}
                  onChange={e => handleSaveAiSettings({ apiEndpoint: e.target.value })}
                  placeholder="https://api.openai.com/v1/chat/completions"
                  className="w-full px-3 py-1.5 bg-background border border-input rounded text-sm outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">API Key</label>
                <input
                  type="password"
                  value={aiSettings.apiKey}
                  onChange={e => handleSaveAiSettings({ apiKey: e.target.value })}
                  placeholder="sk-..."
                  className="w-full px-3 py-1.5 bg-background border border-input rounded text-sm outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Model</label>
                <input
                  type="text"
                  value={aiSettings.model}
                  onChange={e => handleSaveAiSettings({ model: e.target.value })}
                  placeholder="gpt-4o-mini"
                  className="w-full px-3 py-1.5 bg-background border border-input rounded text-sm outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
              <div className="flex items-center gap-2 mt-1">
                <button
                  onClick={handleTestConnection}
                  disabled={testingConnection || !aiSettings.apiKey}
                  className="px-3 py-1.5 bg-primary text-primary-foreground rounded text-sm font-medium disabled:opacity-50 flex items-center gap-1.5"
                >
                  {testingConnection ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Testing...
                    </>
                  ) : (
                    'Test connection'
                  )}
                </button>
                {aiError && showAiSettings && (
                  <span className="text-xs text-destructive">{aiError}</span>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Preview Panel */}
        {showPreview && (
          <div className="flex-1 overflow-auto px-6 py-4 bg-muted/30">
            <h3 className="text-sm font-medium mb-3">Preview of Resolved File</h3>
            <pre className="text-sm whitespace-pre-wrap font-mono bg-background p-4 rounded border border-border max-h-[60vh] overflow-auto">
              {rebuildFromConflicts(conflict)}
            </pre>
          </div>
        )}

        {/* Main Content - Side by side comparison */}
        {!showPreview && (
          <>
            <div className="px-6 py-2 bg-muted/30 border-b border-border">
              <span className="text-sm text-muted-foreground">
                Section {currentIndex + 1} of {conflict.sections.length}
                {currentSection.resolvedContent !== null && (
                  <span className="ml-2 text-green-600 dark:text-green-400">
                    <Check className="w-3.5 h-3.5 inline mr-0.5" />
                    Resolved
                  </span>
                )}
              </span>
            </div>

            <div className="flex-1 flex overflow-hidden">
              {/* Left pane - Local version */}
              <div className="flex-1 flex flex-col border-r border-border">
                <div className="px-4 py-2 bg-blue-100 dark:bg-blue-900/30 border-b border-border">
                  <span className="text-sm font-medium text-blue-800 dark:text-blue-200">
                    Your Version
                  </span>
                </div>
                <div className="flex-1 overflow-auto p-4">
                  <pre className={cn(
                    "text-sm whitespace-pre-wrap font-mono",
                    currentSection.resolvedContent === currentSection.localContent && "bg-green-100 dark:bg-green-900/20 p-2 rounded"
                  )}>
                    {currentSection.localContent || <span className="text-muted-foreground italic">(empty)</span>}
                  </pre>
                </div>
              </div>

              {/* Right pane - Remote version */}
              <div className="flex-1 flex flex-col">
                <div className="px-4 py-2 bg-purple-100 dark:bg-purple-900/30 border-b border-border">
                  <span className="text-sm font-medium text-purple-800 dark:text-purple-200">
                    Updated Version
                  </span>
                </div>
                <div className="flex-1 overflow-auto p-4">
                  <pre className={cn(
                    "text-sm whitespace-pre-wrap font-mono",
                    currentSection.resolvedContent === currentSection.remoteContent && "bg-green-100 dark:bg-green-900/20 p-2 rounded"
                  )}>
                    {currentSection.remoteContent || <span className="text-muted-foreground italic">(empty)</span>}
                  </pre>
                </div>
              </div>
            </div>

            {/* Resolution Preview */}
            {currentSection.resolvedContent !== null &&
             currentSection.resolvedContent !== currentSection.localContent &&
             currentSection.resolvedContent !== currentSection.remoteContent && (
              <div className="px-6 py-3 border-t border-border bg-green-50 dark:bg-green-900/10">
                <div className="text-xs font-medium text-green-800 dark:text-green-300 mb-1">
                  Resolved as:
                </div>
                <pre className="text-sm whitespace-pre-wrap font-mono text-green-900 dark:text-green-100 max-h-24 overflow-auto">
                  {currentSection.resolvedContent}
                </pre>
              </div>
            )}

            {/* Error display */}
            {aiError && !showAiSettings && (
              <div className="px-6 py-2 bg-destructive/10 border-t border-destructive/20">
                <span className="text-sm text-destructive">{aiError}</span>
              </div>
            )}

            {/* Resolution buttons */}
            <div className="px-6 py-4 border-t border-border bg-muted/30">
              <div className="flex items-center justify-center gap-2 flex-wrap">
                <button
                  onClick={handleKeepLocal}
                  className="px-4 py-2 bg-blue-100 dark:bg-blue-900/50 hover:bg-blue-200 dark:hover:bg-blue-800/50 text-blue-800 dark:text-blue-200 rounded text-sm font-medium transition-colors"
                >
                  Keep yours
                </button>
                <button
                  onClick={handleKeepRemote}
                  className="px-4 py-2 bg-purple-100 dark:bg-purple-900/50 hover:bg-purple-200 dark:hover:bg-purple-800/50 text-purple-800 dark:text-purple-200 rounded text-sm font-medium transition-colors"
                >
                  Use updated
                </button>
                <button
                  onClick={handleKeepBoth}
                  className="px-4 py-2 bg-muted hover:bg-muted/80 rounded text-sm font-medium transition-colors"
                >
                  Keep both
                </button>
                <button
                  onClick={handleAiMerge}
                  disabled={aiLoading}
                  className="px-4 py-2 bg-gradient-to-r from-violet-500 to-purple-500 hover:from-violet-600 hover:to-purple-600 text-white rounded text-sm font-medium transition-colors disabled:opacity-50 flex items-center gap-1.5"
                >
                  {aiLoading ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Merging...
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-3.5 h-3.5" />
                      Combine with AI
                    </>
                  )}
                </button>
              </div>
            </div>
          </>
        )}

        {/* Footer with navigation and save */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-border">
          <div className="flex items-center gap-2">
            <button
              onClick={handlePrevious}
              disabled={currentIndex === 0}
              className="p-2 rounded hover:bg-muted disabled:opacity-30 transition-colors"
              title="Previous section (←)"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-sm text-muted-foreground">
              {currentIndex + 1} / {conflict.sections.length}
            </span>
            <button
              onClick={handleNext}
              disabled={currentIndex === conflict.sections.length - 1}
              className="p-2 rounded hover:bg-muted disabled:opacity-30 transition-colors"
              title="Next section (→)"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={onCancel}
              className="px-4 py-2 hover:bg-muted rounded text-sm font-medium transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSaveAll}
              disabled={!isResolved}
              className="px-4 py-2 bg-primary text-primary-foreground hover:bg-primary/90 rounded text-sm font-medium disabled:opacity-50 transition-colors flex items-center gap-1.5"
            >
              <Check className="w-4 h-4" />
              Save All Changes
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
