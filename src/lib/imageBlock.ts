/**
 * Image Block Utilities
 *
 * Handles pre-parsing and serialization of block-level <img> tags in markdown.
 * Block images use HTML <img> tags (valid markdown) with optional width/align
 * attributes for layout control:
 *
 *   <img src="folder/image-1.jpg" alt="Photo" />
 *   <img src="folder/image-2.png" alt="Diagram" width="50%" align="left" />
 *
 * The pre-parse step (extractImageBlocks) runs before markdown-it parsing
 * to capture <img> tags that would otherwise be ignored. It replaces them
 * with unique placeholder text. After parsing, the placeholders are swapped
 * for image_block ProseMirror nodes.
 *
 * Follows the same extract/inject pattern used by comments.ts.
 */

// ============================================================================
// Types
// ============================================================================

export type ImageWidth = 'full' | 'half' | 'quarter'
export type ImageAlign = 'center' | 'left' | 'right'

export interface ParsedImageBlock {
  src: string
  alt: string
  title: string | null
  width: ImageWidth
  align: ImageAlign
  /** Unique placeholder string inserted into the cleaned markdown */
  placeholder: string
}

// ============================================================================
// Constants
// ============================================================================

// Prefix for placeholder text — unlikely to appear in real markdown
const PLACEHOLDER_PREFIX = '\u200B__IMG_BLOCK_'
const PLACEHOLDER_SUFFIX = '__\u200B'

// ============================================================================
// Extraction: Markdown → cleaned markdown + image metadata
// ============================================================================

/**
 * Matches standalone <img .../> tags on their own line.
 * Captures the full tag content between < and >.
 * Handles both self-closing (<img ... />) and non-self-closing (<img ...>) forms.
 */
const IMG_TAG_REGEX = /^[ \t]*<img\s([^>]*?)\s*\/?>[ \t]*$/gm

/**
 * Extracts block-level <img> tags from raw markdown.
 *
 * Returns cleaned markdown (img tags replaced with placeholder paragraphs)
 * and a list of parsed image blocks with their placeholder strings.
 */
export function extractImageBlocks(markdown: string): { cleaned: string; images: ParsedImageBlock[] } {
  const images: ParsedImageBlock[] = []
  let counter = 0

  const cleaned = markdown.replace(IMG_TAG_REGEX, (_fullMatch, attrsStr: string) => {
    const attrs = parseImgAttrs(attrsStr)

    const placeholder = `${PLACEHOLDER_PREFIX}${counter}${PLACEHOLDER_SUFFIX}`
    counter++

    images.push({ ...attrs, placeholder })

    // Replace the <img> tag with the placeholder text on its own line.
    // This becomes a paragraph node after markdown-it parsing.
    return placeholder
  })

  return { cleaned, images }
}

/**
 * Checks if a given text is an image block placeholder.
 */
export function isImagePlaceholder(text: string): boolean {
  return text.startsWith(PLACEHOLDER_PREFIX) && text.endsWith(PLACEHOLDER_SUFFIX)
}

/**
 * Finds the ParsedImageBlock for a given placeholder text.
 */
export function findImageByPlaceholder(
  images: ParsedImageBlock[],
  placeholder: string
): ParsedImageBlock | undefined {
  return images.find(img => img.placeholder === placeholder)
}

// ============================================================================
// Attribute parsing
// ============================================================================

/**
 * Parses HTML attributes from the content of an <img> tag.
 * Extracts src, alt, title, width, and align.
 */
export function parseImgAttrs(attrsStr: string): {
  src: string
  alt: string
  title: string | null
  width: ImageWidth
  align: ImageAlign
} {
  const src = getAttr(attrsStr, 'src') || ''
  const alt = getAttr(attrsStr, 'alt') || ''
  const title = getAttr(attrsStr, 'title') || null
  const rawWidth = getAttr(attrsStr, 'width')
  const rawAlign = getAttr(attrsStr, 'align')

  return {
    src,
    alt,
    title,
    width: widthFromAttr(rawWidth),
    align: alignFromAttr(rawAlign)
  }
}

/** Extracts a single HTML attribute value by name */
function getAttr(str: string, name: string): string | null {
  // Match name="value" or name='value'
  const regex = new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`)
  const match = regex.exec(str)
  return match ? match[1] : null
}

/** Maps a width attribute string to our ImageWidth type */
function widthFromAttr(raw: string | null): ImageWidth {
  if (raw === '50%') return 'half'
  if (raw === '25%') return 'quarter'
  return 'full'
}

/** Maps an align attribute string to our ImageAlign type */
function alignFromAttr(raw: string | null): ImageAlign {
  if (raw === 'left') return 'left'
  if (raw === 'right') return 'right'
  return 'center'
}

// ============================================================================
// Serialization: image_block attrs → <img> tag
// ============================================================================

/** Maps ImageWidth to the HTML width attribute value (or null for full) */
function widthToAttr(width: ImageWidth): string | null {
  if (width === 'half') return '50%'
  if (width === 'quarter') return '25%'
  return null
}

/** Maps ImageAlign to the HTML align attribute value (or null for center) */
function alignToAttr(align: ImageAlign): string | null {
  if (align === 'left') return 'left'
  if (align === 'right') return 'right'
  return null
}

/**
 * Serializes image_block node attributes to an <img> HTML tag string.
 */
export function serializeImageBlock(attrs: {
  src: string
  alt?: string
  title?: string | null
  width?: ImageWidth
  align?: ImageAlign
}): string {
  const parts: string[] = ['<img']

  parts.push(`src="${attrs.src}"`)

  if (attrs.alt) {
    parts.push(`alt="${attrs.alt}"`)
  }

  if (attrs.title) {
    parts.push(`title="${attrs.title}"`)
  }

  const widthVal = widthToAttr(attrs.width || 'full')
  if (widthVal) {
    parts.push(`width="${widthVal}"`)
  }

  const alignVal = alignToAttr(attrs.align || 'center')
  if (alignVal) {
    parts.push(`align="${alignVal}"`)
  }

  parts.push('/>')
  return parts.join(' ')
}

// ============================================================================
// Image naming utilities
// ============================================================================

/**
 * Computes the next sequential image number from a list of existing filenames.
 * Looks for the pattern `{baseName}-{N}.{ext}` and returns max(N) + 1.
 */
export function getNextImageNumber(existingFiles: string[], baseName: string): number {
  let max = 0

  // Match: baseName-N.ext where N is one or more digits
  const regex = new RegExp(`^${escapeRegex(baseName)}-(\\d+)\\.\\w+$`)

  for (const file of existingFiles) {
    const match = regex.exec(file)
    if (match) {
      const n = parseInt(match[1], 10)
      if (n > max) max = n
    }
  }

  return max + 1
}

/**
 * Builds the full image file path for saving a dropped image.
 *
 * For a document at `/path/to/my-document.md` and image number 2 with extension 'png':
 * → `/path/to/my-document/my-document-2.png`
 */
export function buildImagePath(
  docFilePath: string,
  extension: string,
  imageNumber: number
): { dirPath: string; filePath: string; relativeSrc: string } {
  // Remove .md extension to get base name
  const docDir = docFilePath.substring(0, docFilePath.lastIndexOf('/'))
  const docFileName = docFilePath.substring(docFilePath.lastIndexOf('/') + 1)
  const baseName = docFileName.replace(/\.md$/i, '')

  const dirPath = `${docDir}/${baseName}`
  const fileName = `${baseName}-${imageNumber}.${extension}`
  const filePath = `${dirPath}/${fileName}`
  // Relative src for the <img> tag (relative to the markdown file)
  const relativeSrc = `${baseName}/${fileName}`

  return { dirPath, filePath, relativeSrc }
}

/** Escapes special regex characters in a string */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
