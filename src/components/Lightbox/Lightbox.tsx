/**
 * Lightbox Component
 *
 * Fullscreen image overlay triggered by clicking an image in the editor.
 * Uses a React portal to render on top of everything else.
 *
 * Closes on:
 * - Escape key press
 * - Clicking the backdrop (outside the image)
 * - Clicking the X close button
 */

import { useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

interface LightboxProps {
  src: string
  alt?: string
  onClose: () => void
}

export function Lightbox({ src, alt = '', onClose }: LightboxProps) {
  // Close on Escape key
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose()
    }
  }, [onClose])

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  // Prevent scroll when lightbox is open
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])

  return createPortal(
    <div
      className="lightbox-overlay"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={alt || 'Image preview'}
    >
      {/* Close button */}
      <button
        className="lightbox-close"
        onClick={onClose}
        aria-label="Close lightbox"
      >
        <X size={24} />
      </button>

      {/* Image — click on image does NOT close */}
      <img
        src={src}
        alt={alt}
        className="lightbox-image"
        onClick={(e) => e.stopPropagation()}
      />
    </div>,
    document.body
  )
}
