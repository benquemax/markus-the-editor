/**
 * Image plugin for the editor.
 * Handles:
 * - Drag and drop of image files onto the editor
 * - Paste images from clipboard (Ctrl+V)
 * - Tracking hovered image position for edit controls
 *
 * When an image is dropped or pasted, the plugin notifies the parent component
 * to show a filename dialog, allowing the user to name and save the image.
 */
import { Plugin, PluginKey } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { Node, ResolvedPos } from 'prosemirror-model'

/** Information about an image being dropped/pasted */
export interface PendingImage {
  /** The image file */
  file: File
  /** Base64-encoded image data */
  data: string
  /** MIME type of the image */
  mimeType: string
  /** Suggested filename based on original name or type */
  suggestedName: string
  /** Position in document where image should be inserted */
  insertPos: number
}

/** State for image hover/edit controls */
export interface ImageHoverState {
  /** Whether an image is being hovered */
  active: boolean
  /** Position of the hovered image node in the document */
  imagePos: number
  /** Image source URL */
  src: string
  /** Current alignment */
  align: string
  /** Current width percentage */
  width: number
  /** DOM rect of the image for positioning controls */
  imageRect: DOMRect | null
}

export const imagePluginKey = new PluginKey<ImageHoverState>('image')

const emptyHoverState: ImageHoverState = {
  active: false,
  imagePos: -1,
  src: '',
  align: 'inline',
  width: 100,
  imageRect: null
}

/**
 * Convert a File to base64 data URL.
 */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      // Extract base64 data without the data URL prefix
      const base64 = result.split(',')[1]
      resolve(base64)
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

/**
 * Generate a suggested filename for an image based on the document name.
 * Format: documentname-X.ext (e.g., "my-article-1.png", "my-article-2.jpg")
 * @param file - The image file being added
 * @param existingFiles - List of existing image filenames in the folder
 * @param docBaseName - Base name of the document (without extension), or null for unsaved docs
 */
function suggestFilename(file: File, existingFiles: string[], docBaseName: string | null): string {
  // Determine file extension from MIME type
  const mimeExt = file.type.split('/')[1]
  // Normalize extension (jpeg -> jpg)
  const ext = mimeExt === 'jpeg' ? 'jpg' : (mimeExt || 'png')

  // Use document name as base, or 'image' for unsaved documents
  const baseName = docBaseName || 'image'

  // Find the next available number
  let counter = 1
  while (existingFiles.includes(`${baseName}-${counter}.${ext}`)) {
    counter++
  }
  return `${baseName}-${counter}.${ext}`
}

/**
 * Check if a file is an image.
 */
function isImageFile(file: File): boolean {
  return file.type.startsWith('image/')
}

/**
 * Get image files from a DataTransfer object.
 */
function getImageFiles(dataTransfer: DataTransfer): File[] {
  const files: File[] = []
  for (let i = 0; i < dataTransfer.files.length; i++) {
    const file = dataTransfer.files[i]
    if (isImageFile(file)) {
      files.push(file)
    }
  }
  return files
}

/**
 * Find an image node under the mouse cursor.
 * Returns the node and position if found, null otherwise.
 */
function findImageAtMouse(
  $pos: ResolvedPos,
  event: MouseEvent,
  view: EditorView
): { node: Node; pos: number } | null {
  if ($pos.parent.type.name !== 'paragraph') {
    return null
  }

  // Look for image in the paragraph
  let result: { node: Node; pos: number } | null = null

  $pos.parent.forEach((child, offset) => {
    if (child.type.name === 'image') {
      const childPos = $pos.before() + offset + 1
      // Check if mouse is over this image's DOM element
      try {
        const dom = view.nodeDOM(childPos)
        if (dom instanceof HTMLImageElement) {
          const rect = dom.getBoundingClientRect()
          if (
            event.clientX >= rect.left &&
            event.clientX <= rect.right &&
            event.clientY >= rect.top &&
            event.clientY <= rect.bottom
          ) {
            result = { node: child, pos: childPos }
          }
        }
      } catch {
        // Ignore DOM access errors
      }
    }
  })

  return result
}

/**
 * Find the closest block boundary position for dropping an image.
 * Returns the position at the end of the nearest block above or below the cursor.
 */
function findBlockBoundary(view: EditorView, coords: { left: number; top: number }): number {
  const pos = view.posAtCoords(coords)
  if (!pos) return 0

  const doc = view.state.doc
  const $pos = doc.resolve(pos.pos)

  // Find the block-level parent (direct child of doc)
  let blockDepth = 1
  while (blockDepth < $pos.depth && $pos.node(blockDepth).type.name !== 'doc') {
    blockDepth++
  }
  // Go back one level to get the actual block
  if (blockDepth > 1) blockDepth--

  const blockStart = $pos.before(blockDepth)
  const blockEnd = $pos.after(blockDepth)

  // Get the DOM elements for the block to determine if we're in top or bottom half
  try {
    const blockDom = view.nodeDOM(blockStart)
    if (blockDom instanceof HTMLElement) {
      const rect = blockDom.getBoundingClientRect()
      const midY = rect.top + rect.height / 2

      // If cursor is in top half, insert before this block
      // If cursor is in bottom half, insert after this block
      if (coords.top < midY) {
        return blockStart
      } else {
        return blockEnd
      }
    }
  } catch {
    // Fall back to end of block
  }

  return blockEnd
}

/**
 * Create the image plugin.
 * @param onImageDrop - Callback when an image is dropped or pasted
 * @param onHoverChange - Callback when image hover state changes
 * @param getImageContext - Function to get existing files and document base name
 * @param onDropIndicatorChange - Callback to show/hide drop indicator
 */
export function createImagePlugin(
  onImageDrop: (image: PendingImage) => void,
  onHoverChange: (state: ImageHoverState) => void,
  getImageContext: () => Promise<{ files: string[]; docBaseName: string | null }>,
  onDropIndicatorChange?: (position: { top: number; left: number; width: number } | null) => void
): Plugin<ImageHoverState> {
  let currentView: EditorView | null = null
  let hoveredImagePos: number = -1

  return new Plugin<ImageHoverState>({
    key: imagePluginKey,

    state: {
      init(): ImageHoverState {
        return emptyHoverState
      },

      apply(_tr, value): ImageHoverState {
        // State is managed via DOM events, not transactions
        return value
      }
    },

    props: {
      // Handle dragover to show drop indicator
      handleDOMEvents: {
        dragover(view, event) {
          const dataTransfer = event.dataTransfer
          if (!dataTransfer) return false

          // Check if dragging image files
          const hasImages = Array.from(dataTransfer.types).includes('Files')
          if (!hasImages) {
            onDropIndicatorChange?.(null)
            return false
          }

          event.preventDefault()

          // Find the block boundary and show indicator
          const blockPos = findBlockBoundary(view, { left: event.clientX, top: event.clientY })

          try {
            // Get the position of the drop line
            const coords = view.coordsAtPos(blockPos)
            const editorRect = view.dom.getBoundingClientRect()

            onDropIndicatorChange?.({
              top: coords.top - editorRect.top,
              left: 0,
              width: editorRect.width
            })
          } catch {
            onDropIndicatorChange?.(null)
          }

          return false
        },

        dragleave(view, event) {
          // Only hide if leaving the editor entirely
          const relatedTarget = event.relatedTarget as Element | null
          if (!relatedTarget || !view.dom.contains(relatedTarget)) {
            onDropIndicatorChange?.(null)
          }
          return false
        },

        drop() {
          // Hide indicator on drop
          onDropIndicatorChange?.(null)
          return false // Let handleDrop process it
        }
      },

      // Handle drop events
      handleDrop(view, event, _slice, moved) {
        // Don't handle if this is a move within the document
        if (moved) return false

        const dataTransfer = event.dataTransfer
        if (!dataTransfer) return false

        const imageFiles = getImageFiles(dataTransfer)
        if (imageFiles.length === 0) return false

        // Prevent default handling
        event.preventDefault()

        // Find the block boundary for insertion
        const insertPos = findBlockBoundary(view, { left: event.clientX, top: event.clientY })

        // Process each image file
        imageFiles.forEach(async (file) => {
          const { files, docBaseName } = await getImageContext()
          const data = await fileToBase64(file)
          const pendingImage: PendingImage = {
            file,
            data,
            mimeType: file.type,
            suggestedName: suggestFilename(file, files, docBaseName),
            insertPos
          }
          onImageDrop(pendingImage)
        })

        return true
      },

      // Handle paste events
      handlePaste(view, event) {
        const clipboardData = event.clipboardData
        if (!clipboardData) return false

        const imageFiles = getImageFiles(clipboardData)
        if (imageFiles.length === 0) return false

        // Prevent default handling
        event.preventDefault()

        // Get current cursor position for insertion
        const { from } = view.state.selection

        // Process each image file
        imageFiles.forEach(async (file) => {
          const { files, docBaseName } = await getImageContext()
          const data = await fileToBase64(file)
          const pendingImage: PendingImage = {
            file,
            data,
            mimeType: file.type,
            suggestedName: suggestFilename(file, files, docBaseName),
            insertPos: from
          }
          onImageDrop(pendingImage)
        })

        return true
      }
    },

    view(view) {
      currentView = view

      // Track mouse movement for image hover detection
      function handleMouseMove(event: MouseEvent) {
        const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })
        if (!pos) {
          if (hoveredImagePos !== -1) {
            hoveredImagePos = -1
            onHoverChange(emptyHoverState)
          }
          return
        }

        // Check if we're over an image
        const $pos = view.state.doc.resolve(pos.pos)
        const foundImage = findImageAtMouse($pos, event, view)

        if (foundImage) {
          if (hoveredImagePos !== foundImage.pos) {
            hoveredImagePos = foundImage.pos
            const dom = view.nodeDOM(foundImage.pos) as HTMLImageElement | null
            onHoverChange({
              active: true,
              imagePos: foundImage.pos,
              src: foundImage.node.attrs.src,
              align: foundImage.node.attrs.align || 'inline',
              width: foundImage.node.attrs.width || 100,
              imageRect: dom?.getBoundingClientRect() || null
            })
          }
        } else if (hoveredImagePos !== -1) {
          hoveredImagePos = -1
          onHoverChange(emptyHoverState)
        }
      }

      // Add event listeners
      const editorDom = view.dom
      editorDom.addEventListener('mousemove', handleMouseMove)

      return {
        update() {
          // Re-check hover state after updates
          if (hoveredImagePos >= 0 && currentView) {
            try {
              const node = view.state.doc.nodeAt(hoveredImagePos)
              if (!node || node.type.name !== 'image') {
                hoveredImagePos = -1
                onHoverChange(emptyHoverState)
              }
            } catch {
              hoveredImagePos = -1
              onHoverChange(emptyHoverState)
            }
          }
        },
        destroy() {
          editorDom.removeEventListener('mousemove', handleMouseMove)
          currentView = null
          onHoverChange(emptyHoverState)
        }
      }
    }
  })
}

/**
 * Insert an image node at the specified position.
 * If there's a paragraph at the position, insert the image at the start of that paragraph
 * so it flows with the text (no extra empty line). Otherwise, create a new paragraph.
 * @param src - The displayable source (can be file:// URL for local files)
 * @param relativeSrc - Optional relative path for markdown serialization
 */
export function insertImage(
  view: EditorView,
  pos: number,
  src: string,
  relativeSrc?: string,
  alt?: string,
  align?: string,
  width?: number
): void {
  const { schema } = view.state
  const imageNode = schema.nodes.image.create({
    src,
    relativeSrc: relativeSrc || null,
    alt: alt || '',
    align: align || 'inline',
    width: width || 100
  })

  // Check if there's a paragraph at this position
  const $pos = view.state.doc.resolve(pos)
  const nodeAfter = $pos.nodeAfter

  if (nodeAfter && nodeAfter.type.name === 'paragraph') {
    // Insert image at the start of the existing paragraph (pos + 1 to get inside)
    const tr = view.state.tr.insert(pos + 1, imageNode)
    view.dispatch(tr)
  } else {
    // No paragraph after, create a new one with the image
    const paragraph = schema.nodes.paragraph.create(null, imageNode)
    const tr = view.state.tr.insert(pos, paragraph)
    view.dispatch(tr)
  }
}

/**
 * Update an image node's attributes.
 */
export function updateImageAttrs(
  view: EditorView,
  pos: number,
  attrs: { align?: string; width?: number }
): void {
  const node = view.state.doc.nodeAt(pos)
  if (!node || node.type.name !== 'image') return

  const tr = view.state.tr.setNodeMarkup(pos, undefined, {
    ...node.attrs,
    ...attrs
  })
  view.dispatch(tr)
}
