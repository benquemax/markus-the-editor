/**
 * ProseMirror NodeView for block-level images with layout controls.
 *
 * Renders images with a hover toolbar for controlling width (full/half/quarter)
 * and alignment (left/center/right). Clicking the image dispatches a
 * CustomEvent on window to open the lightbox.
 *
 * DOM structure:
 *   figure.image-block-view[data-width][data-align]
 *     div.image-block-toolbar  (visible on hover)
 *       [Full] [Half] [Quarter]  |  [Left] [Center] [Right]
 *     img[src][alt]              (click → lightbox event)
 */

import { Node as ProseMirrorNode } from 'prosemirror-model'
import { EditorView, NodeView } from 'prosemirror-view'
import type { ImageWidth, ImageAlign } from '../../lib/imageBlock'

export class ImageBlockView implements NodeView {
  dom: HTMLElement
  private node: ProseMirrorNode
  private view: EditorView
  private getPos: () => number | undefined
  private img: HTMLImageElement
  private toolbar: HTMLElement
  private filePath: string | null

  // Width and align button references for active state
  private widthButtons: Map<ImageWidth, HTMLButtonElement> = new Map()
  private alignButtons: Map<ImageAlign, HTMLButtonElement> = new Map()

  constructor(
    node: ProseMirrorNode,
    view: EditorView,
    getPos: () => number | undefined,
    filePath: string | null
  ) {
    this.node = node
    this.view = view
    this.getPos = getPos
    this.filePath = filePath

    // Create the figure container
    this.dom = document.createElement('figure')
    this.dom.className = 'image-block-view'
    this.dom.setAttribute('data-image-block', '')

    // Create hover toolbar
    this.toolbar = document.createElement('div')
    this.toolbar.className = 'image-block-toolbar'
    this.toolbar.contentEditable = 'false'
    this.buildToolbar()

    // Create the image element
    this.img = document.createElement('img')
    this.img.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()
      this.openLightbox()
    })

    // Assemble DOM
    this.dom.appendChild(this.toolbar)
    this.dom.appendChild(this.img)

    // Initial render
    this.syncFromNode()
  }

  /** Syncs the DOM state from the ProseMirror node attributes */
  private syncFromNode(): void {
    const { src, alt, width, align } = this.node.attrs

    // Resolve relative paths to file:// URLs for display
    this.img.src = this.resolveSrc(src)
    this.img.alt = alt || ''

    // Set data attributes for CSS styling
    this.dom.setAttribute('data-width', width || 'full')
    this.dom.setAttribute('data-align', align || 'center')

    // Update active button states
    this.updateButtonStates(width || 'full', align || 'center')
  }

  /**
   * Resolves a relative image src to an absolute file:// URL.
   * Relative paths are resolved against the document's directory.
   */
  private resolveSrc(src: string): string {
    // Already absolute or protocol URL
    if (src.startsWith('/') || src.startsWith('file://') || src.startsWith('http')) {
      return src.startsWith('/') ? `file://${src}` : src
    }

    // Relative path — resolve against document directory
    if (this.filePath) {
      const docDir = this.filePath.substring(0, this.filePath.lastIndexOf('/'))
      return `file://${docDir}/${src}`
    }

    return src
  }

  /** Builds the hover toolbar with width and alignment controls */
  private buildToolbar(): void {
    // Width buttons
    const widthGroup = document.createElement('div')
    widthGroup.className = 'image-block-btn-group'

    const widths: { value: ImageWidth; label: string }[] = [
      { value: 'full', label: 'Full' },
      { value: 'half', label: 'Half' },
      { value: 'quarter', label: '¼' }
    ]

    for (const { value, label } of widths) {
      const btn = document.createElement('button')
      btn.className = 'image-block-btn'
      btn.textContent = label
      btn.addEventListener('click', (e) => {
        e.preventDefault()
        e.stopPropagation()
        this.setAttr('width', value)
        // When switching to full width, reset alignment to center
        if (value === 'full') {
          this.setAttr('align', 'center')
        }
      })
      widthGroup.appendChild(btn)
      this.widthButtons.set(value, btn)
    }

    // Separator
    const sep = document.createElement('span')
    sep.className = 'image-block-separator'
    sep.textContent = '|'

    // Alignment buttons
    const alignGroup = document.createElement('div')
    alignGroup.className = 'image-block-btn-group'

    const aligns: { value: ImageAlign; label: string }[] = [
      { value: 'left', label: 'Left' },
      { value: 'center', label: 'Center' },
      { value: 'right', label: 'Right' }
    ]

    for (const { value, label } of aligns) {
      const btn = document.createElement('button')
      btn.className = 'image-block-btn'
      btn.textContent = label
      btn.addEventListener('click', (e) => {
        e.preventDefault()
        e.stopPropagation()
        this.setAttr('align', value)
      })
      alignGroup.appendChild(btn)
      this.alignButtons.set(value, btn)
    }

    this.toolbar.appendChild(widthGroup)
    this.toolbar.appendChild(sep)
    this.toolbar.appendChild(alignGroup)
  }

  /** Updates button active states based on current width/align */
  private updateButtonStates(width: ImageWidth, align: ImageAlign): void {
    // Width buttons
    for (const [val, btn] of this.widthButtons) {
      btn.classList.toggle('active', val === width)
    }

    // Alignment buttons — disabled when width is full
    const isFull = width === 'full'
    for (const [val, btn] of this.alignButtons) {
      btn.classList.toggle('active', val === align)
      btn.disabled = isFull && val !== 'center'
      btn.classList.toggle('disabled', isFull && val !== 'center')
    }
  }

  /** Updates a node attribute via ProseMirror transaction */
  private setAttr(attr: string, value: string): void {
    const pos = this.getPos()
    if (pos === undefined) return

    const tr = this.view.state.tr.setNodeMarkup(pos, undefined, {
      ...this.node.attrs,
      [attr]: value
    })
    this.view.dispatch(tr)
  }

  /** Dispatches a lightbox event on window for the Lightbox component to catch */
  private openLightbox(): void {
    window.dispatchEvent(new CustomEvent('image-lightbox', {
      detail: {
        src: this.resolveSrc(this.node.attrs.src),
        alt: this.node.attrs.alt || ''
      }
    }))
  }

  /** Called when the node is updated */
  update(node: ProseMirrorNode): boolean {
    if (node.type !== this.node.type) return false
    this.node = node
    this.syncFromNode()
    return true
  }

  selectNode(): void {
    this.dom.classList.add('ProseMirror-selectednode')
  }

  deselectNode(): void {
    this.dom.classList.remove('ProseMirror-selectednode')
  }

  ignoreMutation(): boolean {
    return true
  }

  stopEvent(event: Event): boolean {
    // Stop click events on toolbar buttons and image
    if (event.type === 'click' || event.type === 'mousedown') {
      return true
    }
    return false
  }

  destroy(): void {
    // No active timers or listeners to clean up
  }
}

/**
 * Factory function to create ImageBlockView instances.
 * Used in EditorView's nodeViews configuration.
 */
export function createImageBlockNodeView(
  node: ProseMirrorNode,
  view: EditorView,
  getPos: () => number | undefined,
  filePath: string | null
): ImageBlockView {
  return new ImageBlockView(node, view, getPos, filePath)
}
