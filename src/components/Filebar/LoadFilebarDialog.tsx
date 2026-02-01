/**
 * LoadFilebarDialog Component
 *
 * Modal for loading saved filebar configurations.
 * Shows a list of available filebars with options to load or delete them.
 */

import { useState, useCallback, useEffect } from 'react'
import { X, Trash2, FolderOpen, Loader2 } from 'lucide-react'
import { cn } from '../../lib/utils'

interface FilebarEntry {
  name: string
  fileName: string
  folderCount: number
}

interface LoadFilebarDialogProps {
  isOpen: boolean
  onClose: () => void
  onLoad: (fileName: string) => Promise<void>
}

export function LoadFilebarDialog({ isOpen, onClose, onLoad }: LoadFilebarDialogProps) {
  const [filebars, setFilebars] = useState<FilebarEntry[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [loadingFileName, setLoadingFileName] = useState<string | null>(null)
  const [deletingFileName, setDeletingFileName] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  /**
   * Fetches the list of available filebars.
   */
  const fetchFilebars = useCallback(async () => {
    setIsLoading(true)
    setError(null)

    try {
      const result = await window.electron.filebar.list()
      if (result.success) {
        setFilebars(result.filebars)
      } else {
        setError(result.error || 'Failed to load filebars')
      }
    } catch (err) {
      setError(String(err))
    } finally {
      setIsLoading(false)
    }
  }, [])

  // Fetch filebars when dialog opens
  useEffect(() => {
    if (isOpen) {
      fetchFilebars()
    }
  }, [isOpen, fetchFilebars])

  const handleLoad = useCallback(async (fileName: string) => {
    setLoadingFileName(fileName)
    setError(null)

    try {
      await onLoad(fileName)
      onClose()
    } catch (err) {
      setError(String(err))
    } finally {
      setLoadingFileName(null)
    }
  }, [onLoad, onClose])

  const handleDelete = useCallback(async (fileName: string, name: string) => {
    const confirmed = await window.electron.dialog.showMessage({
      type: 'question',
      title: 'Delete Filebar',
      message: `Are you sure you want to delete "${name}"?`,
      buttons: ['Delete', 'Cancel']
    })

    if (confirmed.response !== 0) return

    setDeletingFileName(fileName)
    setError(null)

    try {
      const result = await window.electron.filebar.delete(fileName)
      if (result.success) {
        setFilebars(prev => prev.filter(f => f.fileName !== fileName))
      } else {
        setError(result.error || 'Failed to delete filebar')
      }
    } catch (err) {
      setError(String(err))
    } finally {
      setDeletingFileName(null)
    }
  }, [])

  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
      />

      {/* Dialog */}
      <div className="relative bg-background border border-border rounded-lg shadow-lg w-full max-w-md mx-4 max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border flex-shrink-0">
          <h2 className="text-sm font-semibold">Load Filebar</h2>
          <button
            onClick={onClose}
            className="p-1 hover:bg-accent rounded"
          >
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-2 filebar-scroll">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : filebars.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              No saved filebars found
            </div>
          ) : (
            <div className="space-y-1">
              {filebars.map((filebar) => (
                <div
                  key={filebar.fileName}
                  className={cn(
                    'flex items-center gap-2 px-3 py-2 rounded',
                    'hover:bg-accent/50 group'
                  )}
                >
                  <FolderOpen className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{filebar.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {filebar.folderCount} {filebar.folderCount === 1 ? 'folder' : 'folders'}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handleLoad(filebar.fileName)}
                      disabled={loadingFileName !== null || deletingFileName !== null}
                      className={cn(
                        'px-2 py-1 text-xs rounded',
                        'bg-primary text-primary-foreground',
                        'hover:bg-primary/90',
                        'disabled:opacity-50 disabled:cursor-not-allowed'
                      )}
                    >
                      {loadingFileName === filebar.fileName ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        'Load'
                      )}
                    </button>
                    <button
                      onClick={() => handleDelete(filebar.fileName, filebar.name)}
                      disabled={loadingFileName !== null || deletingFileName !== null}
                      className={cn(
                        'p-1 rounded',
                        'hover:bg-destructive/20 text-muted-foreground hover:text-destructive',
                        'opacity-0 group-hover:opacity-100 transition-opacity',
                        'disabled:opacity-50 disabled:cursor-not-allowed'
                      )}
                      title="Delete"
                    >
                      {deletingFileName === filebar.fileName ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {error && (
            <p className="mt-2 px-3 text-sm text-destructive">{error}</p>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end px-4 py-3 border-t border-border flex-shrink-0">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-sm rounded border border-border hover:bg-accent"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
