/**
 * Image Drop & Paste Plugin for ProseMirror
 *
 * Handles dropping and pasting image files onto the editor. When an image
 * is dropped/pasted:
 * 1. Reads the image as base64 via FileReader
 * 2. Computes the next sequential image number from the document's image folder
 * 3. Saves the image file via the explorer IPC bridge
 * 4. Inserts an image_block node at the drop/cursor position
 *
 * Images are saved alongside the markdown document in a folder matching the
 * document name (e.g., `my-doc/my-doc-1.jpg`).
 */

import { Plugin, PluginKey } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { schema } from '../schema'
import { getNextImageNumber, buildImagePath } from '../../lib/imageBlock'

export const imageDropPluginKey = new PluginKey('imageDropPlugin')

interface ImageDropPluginOptions {
  /** Returns the current document file path, or null if untitled */
  getFilePath: () => string | null
}

/**
 * Reads a File as base64 data (without the data: URL prefix).
 */
function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      // Strip the "data:image/png;base64," prefix
      const base64 = result.split(',')[1]
      resolve(base64)
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

/**
 * Extracts the file extension from a filename or MIME type.
 */
function getImageExtension(file: File): string {
  // Try to get extension from filename
  const name = file.name
  if (name) {
    const dot = name.lastIndexOf('.')
    if (dot !== -1) {
      return name.slice(dot + 1).toLowerCase()
    }
  }

  // Fall back to MIME type
  const mimeMap: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/svg+xml': 'svg',
    'image/bmp': 'bmp',
    'image/tiff': 'tiff'
  }

  return mimeMap[file.type] || 'png'
}

/**
 * Processes a single image file: saves it and inserts an image_block node.
 */
async function processImageFile(
  file: File,
  view: EditorView,
  insertPos: number,
  filePath: string
): Promise<void> {
  const base64Data = await readFileAsBase64(file)
  const extension = getImageExtension(file)

  // Get the document's base name for the image folder
  const docFileName = filePath.substring(filePath.lastIndexOf('/') + 1)
  const baseName = docFileName.replace(/\.md$/i, '')

  // List existing files to determine next number
  const { dirPath } = buildImagePath(filePath, extension, 1)
  const listResult = await window.electron.explorer.listFiles(dirPath)
  const existingFiles = listResult.success && listResult.files ? listResult.files : []
  const nextNum = getNextImageNumber(existingFiles, baseName)

  // Build the full path and save
  const imagePath = buildImagePath(filePath, extension, nextNum)
  const saveResult = await window.electron.explorer.saveBinaryFile(imagePath.filePath, base64Data)

  if (!saveResult.success) {
    console.error('Failed to save image:', saveResult.error)
    return
  }

  // Insert image_block node at the drop position
  const imageNode = schema.nodes.image_block.create({
    src: imagePath.relativeSrc,
    alt: file.name ? file.name.replace(/\.[^.]+$/, '') : '',
    width: 'full',
    align: 'center'
  })

  const tr = view.state.tr.insert(insertPos, imageNode)
  view.dispatch(tr)
}

/**
 * Creates the image drop/paste plugin.
 */
export function createImageDropPlugin(options: ImageDropPluginOptions): Plugin {
  return new Plugin({
    key: imageDropPluginKey,

    props: {
      handleDrop(view, event) {
        const dragEvent = event as DragEvent
        if (!dragEvent.dataTransfer) return false

        const files = Array.from(dragEvent.dataTransfer.files)
        const imageFiles = files.filter(f => f.type.startsWith('image/'))
        if (imageFiles.length === 0) return false

        const filePath = options.getFilePath()
        if (!filePath) {
          // Can't save images without a document file path
          window.electron.dialog.showMessage({
            type: 'info',
            title: 'Save Document First',
            message: 'Please save the document before adding images. Images are stored in a folder next to the document.',
            buttons: ['OK']
          })
          return true
        }

        dragEvent.preventDefault()
        dragEvent.stopPropagation()

        // Get drop position in the document
        const coords = { left: dragEvent.clientX, top: dragEvent.clientY }
        const pos = view.posAtCoords(coords)
        const insertPos = pos ? pos.pos : view.state.doc.content.size

        // Process each image file
        for (const file of imageFiles) {
          processImageFile(file, view, insertPos, filePath)
        }

        return true
      },

      handlePaste(view, event) {
        const clipboardEvent = event as ClipboardEvent
        if (!clipboardEvent.clipboardData) return false

        // Check for image items in clipboard
        const items = Array.from(clipboardEvent.clipboardData.items)
        const imageItems = items.filter(item => item.type.startsWith('image/'))
        if (imageItems.length === 0) return false

        const filePath = options.getFilePath()
        if (!filePath) {
          window.electron.dialog.showMessage({
            type: 'info',
            title: 'Save Document First',
            message: 'Please save the document before pasting images. Images are stored in a folder next to the document.',
            buttons: ['OK']
          })
          return true
        }

        clipboardEvent.preventDefault()

        // Get current cursor position
        const insertPos = view.state.selection.from

        for (const item of imageItems) {
          const file = item.getAsFile()
          if (file) {
            processImageFile(file, view, insertPos, filePath)
          }
        }

        return true
      }
    }
  })
}
