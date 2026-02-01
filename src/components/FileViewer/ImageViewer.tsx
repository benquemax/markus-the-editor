/**
 * Image Viewer Component
 *
 * Displays images with zoom controls and centered layout.
 * Supports common image formats: png, jpg, gif, svg, webp, bmp, ico.
 * Uses base64 data URLs for binary image data.
 */

import { useState, useCallback, useRef, useEffect } from 'react'
import { ZoomIn, ZoomOut, RotateCw, Maximize2 } from 'lucide-react'
import { getMimeType } from '../../lib/fileTypes'
import { cn } from '../../lib/utils'

interface ImageViewerProps {
  data: string           // Base64 encoded image data
  filePath: string       // File path for MIME type detection
}

const ZOOM_STEP = 0.25
const MIN_ZOOM = 0.1
const MAX_ZOOM = 5

export function ImageViewer({ data, filePath }: ImageViewerProps) {
  const [zoom, setZoom] = useState(1)
  const [rotation, setRotation] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const imageRef = useRef<HTMLImageElement>(null)

  const mimeType = getMimeType(filePath)
  const dataUrl = `data:${mimeType};base64,${data}`

  const handleZoomIn = useCallback(() => {
    setZoom(z => Math.min(z + ZOOM_STEP, MAX_ZOOM))
  }, [])

  const handleZoomOut = useCallback(() => {
    setZoom(z => Math.max(z - ZOOM_STEP, MIN_ZOOM))
  }, [])

  const handleRotate = useCallback(() => {
    setRotation(r => (r + 90) % 360)
  }, [])

  const handleFitToWindow = useCallback(() => {
    if (!containerRef.current || !imageRef.current) return

    const container = containerRef.current
    const image = imageRef.current

    // Calculate the zoom level to fit the image in the container
    const containerWidth = container.clientWidth - 40 // padding
    const containerHeight = container.clientHeight - 80 // padding + toolbar
    const imageWidth = image.naturalWidth
    const imageHeight = image.naturalHeight

    if (imageWidth === 0 || imageHeight === 0) return

    const widthRatio = containerWidth / imageWidth
    const heightRatio = containerHeight / imageHeight
    const fitZoom = Math.min(widthRatio, heightRatio, 1)

    setZoom(fitZoom)
    setRotation(0)
  }, [])

  // Handle mouse wheel zoom
  const handleWheel = useCallback((e: WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault()
      const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP
      setZoom(z => Math.max(MIN_ZOOM, Math.min(z + delta, MAX_ZOOM)))
    }
  }, [])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    container.addEventListener('wheel', handleWheel, { passive: false })
    return () => container.removeEventListener('wheel', handleWheel)
  }, [handleWheel])

  // Format zoom percentage for display
  const zoomPercentage = Math.round(zoom * 100)

  return (
    <div ref={containerRef} className="h-full flex flex-col bg-background">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-muted/30">
        <button
          onClick={handleZoomOut}
          className="p-1.5 hover:bg-accent rounded"
          title="Zoom Out"
          disabled={zoom <= MIN_ZOOM}
        >
          <ZoomOut className="w-4 h-4" />
        </button>
        <span className="text-sm text-muted-foreground min-w-[4rem] text-center">
          {zoomPercentage}%
        </span>
        <button
          onClick={handleZoomIn}
          className="p-1.5 hover:bg-accent rounded"
          title="Zoom In"
          disabled={zoom >= MAX_ZOOM}
        >
          <ZoomIn className="w-4 h-4" />
        </button>
        <div className="w-px h-4 bg-border mx-1" />
        <button
          onClick={handleRotate}
          className="p-1.5 hover:bg-accent rounded"
          title="Rotate 90°"
        >
          <RotateCw className="w-4 h-4" />
        </button>
        <button
          onClick={handleFitToWindow}
          className="p-1.5 hover:bg-accent rounded"
          title="Fit to Window"
        >
          <Maximize2 className="w-4 h-4" />
        </button>
      </div>

      {/* Image container */}
      <div className="flex-1 overflow-auto flex items-center justify-center p-4">
        <img
          ref={imageRef}
          src={dataUrl}
          alt={filePath.split('/').pop() || 'Image'}
          className={cn(
            'max-w-none transition-transform duration-200',
            // Checkerboard background for transparent images
            'bg-[repeating-conic-gradient(#80808020_0%_25%,transparent_0%_50%)]',
            'bg-[length:16px_16px]'
          )}
          style={{
            transform: `scale(${zoom}) rotate(${rotation}deg)`,
            transformOrigin: 'center center'
          }}
          draggable={false}
        />
      </div>
    </div>
  )
}
