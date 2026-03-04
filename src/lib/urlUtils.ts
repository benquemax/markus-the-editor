/**
 * URL Utilities
 *
 * Shared helpers for URL validation and extraction from drag-and-drop events.
 * Used by drop handlers (App.tsx, FileTreeItem) and the URL input dialog
 * to avoid duplicating the same URL detection logic.
 */

const HTTP_URL_PATTERN = /^https?:\/\/.+/i

/**
 * Returns true if the string is an HTTP or HTTPS URL.
 */
export function isHttpUrl(str: string): boolean {
  return HTTP_URL_PATTERN.test(str)
}

/**
 * Extracts an HTTP(S) URL from a drag-and-drop DataTransfer object.
 * Browsers provide dropped links via 'text/uri-list' (one URL per line)
 * or 'text/plain'. Returns the first valid HTTP URL, or null if none.
 */
export function extractDroppedUrl(dataTransfer: DataTransfer | null): string | null {
  if (!dataTransfer) return null

  const raw = dataTransfer.getData('text/uri-list')
    || dataTransfer.getData('text/plain')
    || ''
  const firstLine = raw.trim().split('\n')[0]
  return isHttpUrl(firstLine) ? firstLine : null
}
