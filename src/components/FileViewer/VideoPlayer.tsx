/**
 * Video Player Component
 *
 * Displays videos using the native HTML5 video element with controls.
 * Supports common video formats: mp4, webm, mov.
 * Uses base64 data URLs for binary video data.
 */

import { getMimeType } from '../../lib/fileTypes'

interface VideoPlayerProps {
  data: string           // Base64 encoded video data
  filePath: string       // File path for MIME type detection
}

export function VideoPlayer({ data, filePath }: VideoPlayerProps) {
  const mimeType = getMimeType(filePath)
  const dataUrl = `data:${mimeType};base64,${data}`

  return (
    <div className="h-full flex flex-col bg-background">
      {/* Video container */}
      <div className="flex-1 flex items-center justify-center p-4 bg-black/90">
        <video
          src={dataUrl}
          controls
          className="max-w-full max-h-full"
          title={filePath.split('/').pop() || 'Video'}
        >
          Your browser does not support the video tag.
        </video>
      </div>

      {/* Footer with file info */}
      <div className="px-4 py-2 border-t border-border bg-muted/30">
        <span className="text-sm text-muted-foreground">
          {filePath.split('/').pop()}
        </span>
      </div>
    </div>
  )
}
