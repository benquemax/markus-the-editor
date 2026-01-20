/**
 * Image lightbox component.
 * Displays a full-screen view of an image with a dark backdrop.
 * Closes on Escape key, click outside, or close button.
 */
import { useEffect, useCallback } from 'react'

interface ImageLightboxProps {
  /** Image source URL, or null if lightbox is closed */
  src: string | null
  /** Called when lightbox should close */
  onClose: () => void
}

export function ImageLightbox({ src, onClose }: ImageLightboxProps) {
  // Handle keyboard events
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose()
    }
  }, [onClose])

  // Add/remove keyboard listener
  useEffect(() => {
    if (src) {
      document.addEventListener('keydown', handleKeyDown)
      return () => document.removeEventListener('keydown', handleKeyDown)
    }
  }, [src, handleKeyDown])

  if (!src) return null

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90"
      onClick={onClose}
    >
      {/* Close button */}
      <button
        className="absolute top-4 right-4 w-10 h-10 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
        onClick={onClose}
        title="Close (Escape)"
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>

      {/* Image */}
      <img
        src={src}
        alt=""
        className="max-w-[90vw] max-h-[90vh] object-contain"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  )
}
