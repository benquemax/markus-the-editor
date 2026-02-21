/**
 * vcat renderer — emits iTerm2 Inline Image Protocol (IIP) escape sequences.
 *
 * Called by the vcat shell script with either "image" or "pdf" as the first
 * argument, followed by the file path. For images, reads the file and emits
 * it directly. For PDFs, renders each page to PNG via pdfjs-dist + @napi-rs/canvas
 * and emits each page as a separate inline image.
 *
 * IIP format: ESC ] 1337 ; File=name=<b64name>;size=<bytes>;inline=1 : <b64data> BEL
 */

import { readFileSync } from 'fs'
import { basename } from 'path'

const [,, mode, filePath] = process.argv

if (!mode || !filePath) {
  console.error('Usage: vcat-render.mjs <image|pdf> <filepath>')
  process.exit(1)
}

/**
 * Emits an iTerm2 IIP escape sequence for a chunk of image data.
 */
function emitIIP(name, data) {
  const b64Name = Buffer.from(name).toString('base64')
  const b64Data = data.toString('base64')
  // ESC ] 1337 ; File=<params> : <data> BEL
  const seq = `\x1b]1337;File=name=${b64Name};size=${data.length};inline=1:${b64Data}\x07`
  process.stdout.write(seq)
  process.stdout.write('\n')
}

if (mode === 'image') {
  try {
    const data = readFileSync(filePath)
    emitIIP(basename(filePath), data)
  } catch (err) {
    console.error(`vcat: failed to read ${filePath}: ${err.message}`)
    process.exit(1)
  }
} else if (mode === 'pdf') {
  // Dynamic import for PDF rendering — these may not be available
  try {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const { createCanvas } = await import('@napi-rs/canvas')

    const data = new Uint8Array(readFileSync(filePath))
    const doc = await pdfjs.getDocument({ data }).promise
    const pageCount = Math.min(doc.numPages, 20) // Cap at 20 pages

    console.log(`Rendering ${pageCount} page${pageCount > 1 ? 's' : ''} from ${basename(filePath)}...`)

    for (let i = 1; i <= pageCount; i++) {
      const page = await doc.getPage(i)
      const scale = 2 // 2x for retina-quality rendering
      const viewport = page.getViewport({ scale })

      const canvas = createCanvas(viewport.width, viewport.height)
      const ctx = canvas.getContext('2d')

      // pdfjs-dist expects a CanvasRenderingContext2D-like object
      await page.render({
        canvasContext: ctx,
        viewport
      }).promise

      const pngBuffer = canvas.toBuffer('image/png')
      emitIIP(`${basename(filePath)}-page${i}.png`, pngBuffer)
    }
  } catch (err) {
    console.error(`vcat: PDF rendering failed: ${err.message}`)
    console.error('Make sure pdfjs-dist and @napi-rs/canvas are installed.')
    process.exit(1)
  }
} else {
  console.error(`vcat: unknown mode "${mode}" (expected "image" or "pdf")`)
  process.exit(1)
}
