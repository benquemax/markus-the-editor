/**
 * Image Block Utilities Tests
 *
 * Tests the pre-parse/serialize roundtrip for block-level <img> tags,
 * attribute parsing, image naming logic, and path building.
 */

import { describe, it, expect } from 'vitest'
import {
  extractImageBlocks,
  parseImgAttrs,
  serializeImageBlock,
  getNextImageNumber,
  buildImagePath,
  isImagePlaceholder,
  findImageByPlaceholder
} from './imageBlock'

describe('extractImageBlocks', () => {
  it('extracts a simple <img> tag on its own line', () => {
    const md = 'Hello\n\n<img src="folder/image-1.jpg" alt="Photo" />\n\nWorld'
    const { cleaned, images } = extractImageBlocks(md)

    expect(images).toHaveLength(1)
    expect(images[0].src).toBe('folder/image-1.jpg')
    expect(images[0].alt).toBe('Photo')
    expect(images[0].width).toBe('full')
    expect(images[0].align).toBe('center')

    // The placeholder should replace the <img> line
    expect(cleaned).not.toContain('<img')
    expect(cleaned).toContain(images[0].placeholder)
  })

  it('extracts multiple <img> tags', () => {
    const md = [
      '# Title',
      '',
      '<img src="a.jpg" alt="A" />',
      '',
      'Some text',
      '',
      '<img src="b.png" alt="B" width="50%" align="left" />'
    ].join('\n')

    const { images } = extractImageBlocks(md)

    expect(images).toHaveLength(2)
    expect(images[0].src).toBe('a.jpg')
    expect(images[1].src).toBe('b.png')
    expect(images[1].width).toBe('half')
    expect(images[1].align).toBe('left')
  })

  it('does not extract inline <img> tags (not on their own line)', () => {
    const md = 'Text with <img src="inline.jpg" /> in it.'
    const { images } = extractImageBlocks(md)
    expect(images).toHaveLength(0)
  })

  it('handles markdown with no images', () => {
    const md = '# Just a heading\n\nSome paragraph text.'
    const { cleaned, images } = extractImageBlocks(md)
    expect(images).toHaveLength(0)
    expect(cleaned).toBe(md)
  })

  it('handles non-self-closing <img> tags', () => {
    const md = '<img src="photo.jpg" alt="Test">'
    const { images } = extractImageBlocks(md)
    expect(images).toHaveLength(1)
    expect(images[0].src).toBe('photo.jpg')
  })

  it('preserves surrounding content', () => {
    const md = 'Before\n\n<img src="x.jpg" />\n\nAfter'
    const { cleaned, images } = extractImageBlocks(md)

    expect(cleaned).toContain('Before')
    expect(cleaned).toContain('After')
    expect(cleaned).toContain(images[0].placeholder)
  })
})

describe('parseImgAttrs', () => {
  it('parses all attributes', () => {
    const attrs = parseImgAttrs('src="photo.jpg" alt="Alt text" title="Title" width="50%" align="right"')
    expect(attrs.src).toBe('photo.jpg')
    expect(attrs.alt).toBe('Alt text')
    expect(attrs.title).toBe('Title')
    expect(attrs.width).toBe('half')
    expect(attrs.align).toBe('right')
  })

  it('returns defaults for missing attributes', () => {
    const attrs = parseImgAttrs('src="img.png"')
    expect(attrs.alt).toBe('')
    expect(attrs.title).toBeNull()
    expect(attrs.width).toBe('full')
    expect(attrs.align).toBe('center')
  })

  it('maps width="25%" to quarter', () => {
    const attrs = parseImgAttrs('src="x.jpg" width="25%"')
    expect(attrs.width).toBe('quarter')
  })

  it('maps unknown width to full', () => {
    const attrs = parseImgAttrs('src="x.jpg" width="75%"')
    expect(attrs.width).toBe('full')
  })
})

describe('serializeImageBlock', () => {
  it('serializes full-width centered image (defaults)', () => {
    const tag = serializeImageBlock({ src: 'img/photo.jpg', alt: 'Photo' })
    expect(tag).toBe('<img src="img/photo.jpg" alt="Photo" />')
  })

  it('serializes half-width left-aligned image', () => {
    const tag = serializeImageBlock({ src: 'img.png', alt: 'A', width: 'half', align: 'left' })
    expect(tag).toBe('<img src="img.png" alt="A" width="50%" align="left" />')
  })

  it('serializes quarter-width right-aligned image with title', () => {
    const tag = serializeImageBlock({ src: 'x.jpg', alt: 'B', title: 'My Title', width: 'quarter', align: 'right' })
    expect(tag).toBe('<img src="x.jpg" alt="B" title="My Title" width="25%" align="right" />')
  })

  it('omits width and align attrs for full/center defaults', () => {
    const tag = serializeImageBlock({ src: 'a.jpg', width: 'full', align: 'center' })
    expect(tag).not.toContain('width=')
    expect(tag).not.toContain('align=')
  })
})

describe('roundtrip: extract → serialize', () => {
  it('roundtrips a simple image', () => {
    const original = '<img src="doc/doc-1.jpg" alt="Photo" />'
    const { images } = extractImageBlocks(original)
    expect(images).toHaveLength(1)

    const serialized = serializeImageBlock(images[0])
    expect(serialized).toBe(original)
  })

  it('roundtrips an image with width and align', () => {
    const original = '<img src="doc/doc-2.png" alt="Diagram" width="50%" align="left" />'
    const { images } = extractImageBlocks(original)
    const serialized = serializeImageBlock(images[0])
    expect(serialized).toBe(original)
  })
})

describe('isImagePlaceholder / findImageByPlaceholder', () => {
  it('identifies a placeholder string', () => {
    const { images } = extractImageBlocks('<img src="x.jpg" />')
    expect(images).toHaveLength(1)
    expect(isImagePlaceholder(images[0].placeholder)).toBe(true)
  })

  it('rejects non-placeholder strings', () => {
    expect(isImagePlaceholder('hello')).toBe(false)
    expect(isImagePlaceholder('')).toBe(false)
  })

  it('finds the correct image by placeholder', () => {
    const md = '<img src="a.jpg" />\n\n<img src="b.jpg" />'
    const { images } = extractImageBlocks(md)
    const found = findImageByPlaceholder(images, images[1].placeholder)
    expect(found?.src).toBe('b.jpg')
  })
})

describe('getNextImageNumber', () => {
  it('returns 1 for empty directory', () => {
    expect(getNextImageNumber([], 'doc')).toBe(1)
  })

  it('returns next number after existing images', () => {
    expect(getNextImageNumber(['doc-1.jpg', 'doc-2.png'], 'doc')).toBe(3)
  })

  it('handles gaps in numbering (uses max + 1)', () => {
    expect(getNextImageNumber(['doc-1.jpg', 'doc-5.png'], 'doc')).toBe(6)
  })

  it('ignores files that do not match the pattern', () => {
    expect(getNextImageNumber(['readme.md', 'other-1.jpg', 'doc-3.png'], 'doc')).toBe(4)
  })

  it('handles mixed extensions correctly', () => {
    expect(getNextImageNumber(['doc-1.jpg', 'doc-2.png', 'doc-3.webp'], 'doc')).toBe(4)
  })
})

describe('buildImagePath', () => {
  it('builds correct paths for a document', () => {
    const result = buildImagePath('/path/to/my-document.md', 'jpg', 1)
    expect(result.dirPath).toBe('/path/to/my-document')
    expect(result.filePath).toBe('/path/to/my-document/my-document-1.jpg')
    expect(result.relativeSrc).toBe('my-document/my-document-1.jpg')
  })

  it('handles different extensions', () => {
    const result = buildImagePath('/docs/notes.md', 'png', 5)
    expect(result.filePath).toBe('/docs/notes/notes-5.png')
    expect(result.relativeSrc).toBe('notes/notes-5.png')
  })

  it('handles document names with hyphens', () => {
    const result = buildImagePath('/a/my-long-name.md', 'webp', 2)
    expect(result.dirPath).toBe('/a/my-long-name')
    expect(result.filePath).toBe('/a/my-long-name/my-long-name-2.webp')
  })
})
