/**
 * Image filename dialog component.
 * Displays a modal dialog for saving dropped/pasted images.
 * Shows an image preview, allows editing the filename, and saves the image
 * to the appropriate folder.
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import { PendingImage } from '../editor/plugins/imagePlugin'

interface ImageFilenameDialogProps {
  /** The pending image to save, or null if dialog is closed */
  image: PendingImage | null
  /** Called when image is saved successfully with both display path and markdown path */
  onSave: (displaySrc: string, relativePath: string) => void
  /** Called when dialog is cancelled */
  onCancel: () => void
}

export function ImageFilenameDialog({ image, onSave, onCancel }: ImageFilenameDialogProps) {
  const [filename, setFilename] = useState('')
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Update filename and preview when image changes
  useEffect(() => {
    if (image) {
      setFilename(image.suggestedName)
      setError(null)

      // Create preview URL from base64 data
      const dataUrl = `data:${image.mimeType};base64,${image.data}`
      setPreviewUrl(dataUrl)

      // Focus and select the filename (without extension)
      setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.focus()
          const dotIndex = image.suggestedName.lastIndexOf('.')
          if (dotIndex > 0) {
            inputRef.current.setSelectionRange(0, dotIndex)
          } else {
            inputRef.current.select()
          }
        }
      }, 50)
    } else {
      setPreviewUrl(null)
    }
  }, [image])

  // Handle save
  const handleSave = useCallback(async () => {
    if (!image || !filename.trim()) return

    setSaving(true)
    setError(null)

    try {
      const result = await window.electron.image.save({
        imageName: filename.trim(),
        imageData: image.data,
        mimeType: image.mimeType
      })

      if (result.success && result.absolutePath && result.relativePath) {
        // Use local-image:// custom protocol for display in the editor
        // This bypasses Electron's file:// security restrictions
        // Relative path is used for markdown serialization
        const displaySrc = `local-image://${result.absolutePath}`
        onSave(displaySrc, result.relativePath)
      } else {
        setError(result.error || 'Failed to save image')
      }
    } catch (err) {
      setError(String(err))
    } finally {
      setSaving(false)
    }
  }, [image, filename, onSave])

  // Handle key events
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !saving) {
      e.preventDefault()
      handleSave()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onCancel()
    }
  }, [handleSave, onCancel, saving])

  if (!image) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel()
      }}
    >
      <div
        className="bg-popover border border-border rounded-lg shadow-xl p-6 max-w-md w-full mx-4"
        onKeyDown={handleKeyDown}
      >
        <h2 className="text-lg font-semibold mb-4">Save Image</h2>

        {/* Image preview */}
        {previewUrl && (
          <div className="mb-4 flex justify-center">
            <img
              src={previewUrl}
              alt="Preview"
              className="max-h-48 max-w-full rounded border border-border"
            />
          </div>
        )}

        {/* Filename input */}
        <div className="mb-4">
          <label htmlFor="image-filename" className="block text-sm font-medium mb-2">
            Filename
          </label>
          <input
            ref={inputRef}
            id="image-filename"
            type="text"
            value={filename}
            onChange={(e) => setFilename(e.target.value)}
            className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            disabled={saving}
          />
        </div>

        {/* Error message */}
        {error && (
          <div className="mb-4 text-sm text-destructive">
            {error}
          </div>
        )}

        {/* Action buttons */}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-sm border border-input rounded-md hover:bg-accent"
            disabled={saving}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90"
            disabled={saving || !filename.trim()}
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
