/**
 * File Type Detection Utilities
 *
 * Provides file type classification for the multi-file viewer system.
 * Each file type gets an appropriate viewer/editor:
 * - markdown: ProseMirror WYSIWYG editor
 * - image: Image viewer with zoom controls
 * - video: HTML5 video player
 * - json: Split view with Monaco + tree editor
 * - html: Split view with Monaco + rendered preview
 */

export type FileType = 'markdown' | 'image' | 'video' | 'json' | 'html' | 'unknown'

/**
 * Extension mappings for each file type.
 */
const MARKDOWN_EXTENSIONS = ['md', 'markdown']
const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'ico']
const VIDEO_EXTENSIONS = ['mp4', 'webm', 'mov', 'avi', 'mkv', 'ogg']
const JSON_EXTENSIONS = ['json']
const HTML_EXTENSIONS = ['html', 'htm']

/**
 * Detects the file type from a file path based on extension.
 */
export function getFileType(filePath: string): FileType {
  const ext = filePath.toLowerCase().split('.').pop() || ''

  if (MARKDOWN_EXTENSIONS.includes(ext)) return 'markdown'
  if (IMAGE_EXTENSIONS.includes(ext)) return 'image'
  if (VIDEO_EXTENSIONS.includes(ext)) return 'video'
  if (JSON_EXTENSIONS.includes(ext)) return 'json'
  if (HTML_EXTENSIONS.includes(ext)) return 'html'

  return 'unknown'
}

/**
 * Returns true if the file type supports editing (has editable content).
 * Unknown files are editable via the code editor fallback.
 */
export function isEditableFile(fileType: FileType): boolean {
  return fileType === 'markdown' || fileType === 'json' || fileType === 'html' || fileType === 'unknown'
}

/**
 * Returns true if the file is binary (should be read as base64).
 */
export function isBinaryFile(fileType: FileType): boolean {
  return fileType === 'image' || fileType === 'video'
}

/**
 * Returns true if the file type is supported by the application.
 * All non-binary files are supported via the code editor fallback.
 */
export function isSupportedFile(_fileType: FileType): boolean {
  // All file types are now supported - binary files have viewers,
  // known text files have specialized editors, and unknown files
  // fall back to the code editor
  return true
}

/**
 * Gets the MIME type for a file path (used for binary data URLs).
 */
export function getMimeType(filePath: string): string {
  const ext = filePath.toLowerCase().split('.').pop() || ''

  const mimeTypes: Record<string, string> = {
    // Images
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    svg: 'image/svg+xml',
    webp: 'image/webp',
    bmp: 'image/bmp',
    ico: 'image/x-icon',
    // Videos
    mp4: 'video/mp4',
    webm: 'video/webm',
    mov: 'video/quicktime',
    avi: 'video/x-msvideo',
    mkv: 'video/x-matroska',
    ogg: 'video/ogg'
  }

  return mimeTypes[ext] || 'application/octet-stream'
}

/**
 * Gets a human-readable label for the file type.
 */
export function getFileTypeLabel(fileType: FileType): string {
  switch (fileType) {
    case 'markdown': return 'Markdown'
    case 'image': return 'Image'
    case 'video': return 'Video'
    case 'json': return 'JSON'
    case 'html': return 'HTML'
    default: return 'Unknown'
  }
}
