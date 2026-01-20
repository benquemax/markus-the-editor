/**
 * Image edit popover component.
 * Displays floating controls for editing image properties when hovering over an image.
 * Allows changing alignment (inline, left, right, center) and width (10-100%).
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import { EditorView } from 'prosemirror-view'
import { ImageHoverState, updateImageAttrs } from '../editor/plugins/imagePlugin'

interface ImageEditPopoverProps {
  /** Hover state from the image plugin */
  state: ImageHoverState
  /** The editor view */
  view: EditorView | null
  /** Container ref for positioning (must be the scroll container) */
  containerRef: React.RefObject<HTMLDivElement>
  /** Callback when image is clicked for lightbox */
  onImageClick?: (src: string) => void
}

const alignmentOptions = [
  { value: 'inline', label: 'Inline', icon: '—' },
  { value: 'left', label: 'Float Left', icon: '◧' },
  { value: 'right', label: 'Float Right', icon: '◨' },
  { value: 'center', label: 'Center', icon: '◫' }
]

// Store image state when popover is opened so we don't lose it when hover ends
interface StoredImageState {
  imagePos: number
  src: string
  align: string
  width: number
  buttonPosition: { top: number; left: number }
}

export function ImageEditPopover({ state, view, containerRef, onImageClick }: ImageEditPopoverProps) {
  const [showPopover, setShowPopover] = useState(false)
  const [storedState, setStoredState] = useState<StoredImageState | null>(null)
  const [localWidth, setLocalWidth] = useState(100)
  const popoverRef = useRef<HTMLDivElement>(null)

  // Calculate button position relative to the scroll container's content
  // This way the button scrolls with the content since it's positioned
  // relative to the scrollable container using position: absolute
  const getButtonPosition = useCallback((): { top: number; left: number } | null => {
    if (!state.imageRect || !containerRef.current) return null

    const container = containerRef.current
    const containerRect = container.getBoundingClientRect()

    // Convert viewport coords to content coords by adding scroll offset
    // imageRect is viewport-relative, we need content-relative for absolute positioning
    const top = state.imageRect.top - containerRect.top + container.scrollTop
    const left = state.imageRect.left - containerRect.left + state.imageRect.width

    return {
      top: top + 4,
      left: left - 28
    }
  }, [state.imageRect, containerRef])

  // Update local width when stored state changes
  useEffect(() => {
    if (storedState) {
      setLocalWidth(storedState.width)
    }
  }, [storedState])

  // Close popover when clicking outside
  useEffect(() => {
    if (!showPopover) return

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Element
      if (popoverRef.current && !popoverRef.current.contains(target)) {
        setShowPopover(false)
        setStoredState(null)
      }
    }

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowPopover(false)
        setStoredState(null)
      }
    }

    // Delay adding listener to avoid immediate close
    setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside)
      document.addEventListener('keydown', handleEscape)
    }, 0)

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [showPopover])

  // Handle opening the popover - store current state
  const handleOpenPopover = useCallback(() => {
    const buttonPos = getButtonPosition()
    if (!buttonPos) return

    setStoredState({
      imagePos: state.imagePos,
      src: state.src,
      align: state.align,
      width: state.width,
      buttonPosition: buttonPos
    })
    setLocalWidth(state.width)
    setShowPopover(true)
  }, [state, getButtonPosition])

  // Handle closing the popover
  const handleClosePopover = useCallback(() => {
    setShowPopover(false)
    setStoredState(null)
  }, [])

  // Handle alignment change
  const handleAlignmentChange = useCallback((align: string) => {
    if (!view || !storedState) return
    updateImageAttrs(view, storedState.imagePos, { align })
    setStoredState(prev => prev ? { ...prev, align } : null)
  }, [view, storedState])

  // Handle width change (live update)
  const handleWidthChange = useCallback((width: number) => {
    setLocalWidth(width)
  }, [])

  // Apply width change when slider is released
  const handleWidthCommit = useCallback(() => {
    if (!view || !storedState) return
    updateImageAttrs(view, storedState.imagePos, { width: localWidth })
    setStoredState(prev => prev ? { ...prev, width: localWidth } : null)
  }, [view, storedState, localWidth])

  // Handle image click for lightbox
  const handleImageClick = useCallback(() => {
    if (onImageClick && storedState?.src) {
      onImageClick(storedState.src)
    }
    handleClosePopover()
  }, [onImageClick, storedState, handleClosePopover])

  // Get current button position - use stored if popover is open, otherwise calculate from hover
  const buttonPosition = showPopover && storedState
    ? storedState.buttonPosition
    : getButtonPosition()

  // Get current state values - use stored if popover is open
  const currentAlign = showPopover && storedState ? storedState.align : state.align

  // Show button if hovering OR if popover is open
  const showButton = state.active || showPopover

  if (!showButton || !buttonPosition) {
    return null
  }

  return (
    <div ref={popoverRef}>
      {/* Edit button - appears on hover */}
      <button
        className="image-edit-btn"
        style={{
          position: 'absolute',
          top: buttonPosition.top,
          left: buttonPosition.left,
          zIndex: 40
        }}
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          if (showPopover) {
            handleClosePopover()
          } else {
            handleOpenPopover()
          }
        }}
        title="Edit image"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
        </svg>
      </button>

      {/* Popover with editing controls */}
      {showPopover && storedState && (
        <div
          className="image-edit-popover"
          style={{
            position: 'absolute',
            top: buttonPosition.top + 28,
            left: Math.max(8, buttonPosition.left - 180),
            zIndex: 50
          }}
        >
          {/* Alignment buttons */}
          <div className="mb-3">
            <label className="block text-xs font-medium text-muted-foreground mb-2">
              Alignment
            </label>
            <div className="flex gap-1">
              {alignmentOptions.map((option) => (
                <button
                  key={option.value}
                  className={`flex items-center justify-center w-8 h-8 rounded border ${
                    currentAlign === option.value
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border hover:bg-accent'
                  }`}
                  onClick={() => handleAlignmentChange(option.value)}
                  title={option.label}
                >
                  <span className="text-lg">{option.icon}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Width slider */}
          <div className="mb-3">
            <label className="block text-xs font-medium text-muted-foreground mb-2">
              Width: {localWidth}%
            </label>
            <input
              type="range"
              min="10"
              max="100"
              step="5"
              value={localWidth}
              onChange={(e) => handleWidthChange(Number(e.target.value))}
              onMouseUp={handleWidthCommit}
              onTouchEnd={handleWidthCommit}
              className="w-full h-2 bg-accent rounded-lg appearance-none cursor-pointer"
            />
          </div>

          {/* View full size button */}
          <button
            className="w-full px-3 py-1.5 text-sm border border-border rounded hover:bg-accent flex items-center justify-center gap-2"
            onClick={handleImageClick}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M15 3h6v6" />
              <path d="M9 21H3v-6" />
              <path d="M21 3l-7 7" />
              <path d="M3 21l7-7" />
            </svg>
            View Full Size
          </button>
        </div>
      )}
    </div>
  )
}
