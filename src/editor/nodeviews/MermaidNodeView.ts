/**
 * ProseMirror NodeView for rendering Mermaid diagrams.
 *
 * Provides an interactive view/edit experience for mermaid code blocks:
 * - Default: Renders beautiful SVG diagram with edit button
 * - Edit mode: Shows source code textarea for modification
 * - Error state: Shows error message with source visible for fixing
 *
 * Integrated into the ProseMirror editor through the nodeViews option.
 */

import { Node as ProseMirrorNode } from 'prosemirror-model'
import { EditorView, NodeView } from 'prosemirror-view'
import { renderMermaid, reinitializeMermaidForTheme } from './mermaidRenderer'

// Counter for generating unique diagram IDs (mermaid requires unique IDs)
let diagramIdCounter = 0

/**
 * Creates a unique ID for each mermaid diagram render.
 * Mermaid uses these IDs internally and requires uniqueness.
 */
function generateDiagramId(): string {
  return `mermaid-diagram-${++diagramIdCounter}`
}

export class MermaidNodeView implements NodeView {
  // The outer container element
  dom: HTMLElement

  // Reference to the ProseMirror node
  private node: ProseMirrorNode

  // Reference to the EditorView
  private view: EditorView

  // Position getter function (node position can change)
  private getPos: () => number | undefined

  // Current mode: view (rendered diagram) or edit (code textarea)
  private isEditMode = false

  // Last rendered code (to avoid re-rendering identical content)
  private lastRenderedCode = ''

  // Container for the rendered diagram
  private diagramContainer: HTMLElement

  // Container for the source code in edit mode
  private sourceContainer: HTMLElement

  // The textarea element for editing
  private textarea: HTMLTextAreaElement | null = null

  // Edit button element
  private editButton: HTMLElement

  // Error message container
  private errorContainer: HTMLElement

  constructor(
    node: ProseMirrorNode,
    view: EditorView,
    getPos: () => number | undefined
  ) {
    this.node = node
    this.view = view
    this.getPos = getPos

    // Create the main container
    this.dom = document.createElement('div')
    this.dom.className = 'mermaid-nodeview'

    // Create toolbar with edit button
    const toolbar = document.createElement('div')
    toolbar.className = 'mermaid-toolbar'

    this.editButton = document.createElement('button')
    this.editButton.className = 'mermaid-edit-btn'
    this.editButton.textContent = 'Edit'
    this.editButton.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()
      this.enterEditMode()
    })
    toolbar.appendChild(this.editButton)

    // Create diagram container
    this.diagramContainer = document.createElement('div')
    this.diagramContainer.className = 'mermaid-diagram'
    this.diagramContainer.addEventListener('dblclick', (e) => {
      e.preventDefault()
      this.enterEditMode()
    })

    // Create error container
    this.errorContainer = document.createElement('div')
    this.errorContainer.className = 'mermaid-error'
    this.errorContainer.style.display = 'none'

    // Create source code container (for edit mode)
    this.sourceContainer = document.createElement('div')
    this.sourceContainer.className = 'mermaid-source'
    this.sourceContainer.style.display = 'none'

    // Assemble the DOM
    this.dom.appendChild(toolbar)
    this.dom.appendChild(this.errorContainer)
    this.dom.appendChild(this.diagramContainer)
    this.dom.appendChild(this.sourceContainer)

    // Initial render
    this.render()
  }

  /**
   * Renders the mermaid diagram from the node's text content.
   */
  private async render(): Promise<void> {
    const code = this.node.textContent

    // Skip if already rendering identical content
    if (code === this.lastRenderedCode && this.diagramContainer.innerHTML) {
      return
    }

    this.lastRenderedCode = code
    this.diagramContainer.innerHTML = '<div class="mermaid-loading">Rendering diagram...</div>'
    this.errorContainer.style.display = 'none'

    const id = generateDiagramId()
    const result = await renderMermaid(code, id)

    if (result.svg) {
      this.diagramContainer.innerHTML = result.svg
      this.errorContainer.style.display = 'none'
      this.dom.classList.remove('mermaid-has-error')
    } else {
      this.diagramContainer.innerHTML = ''
      this.errorContainer.textContent = result.error || 'Failed to render diagram'
      this.errorContainer.style.display = 'block'
      this.dom.classList.add('mermaid-has-error')
    }
  }

  /**
   * Enters edit mode - shows textarea for code editing.
   */
  private enterEditMode(): void {
    if (this.isEditMode) return

    this.isEditMode = true
    this.dom.classList.add('mermaid-editing')
    this.diagramContainer.style.display = 'none'
    this.sourceContainer.style.display = 'block'
    this.editButton.textContent = 'Done'

    // Create textarea if not exists
    if (!this.textarea) {
      this.textarea = document.createElement('textarea')
      this.textarea.className = 'mermaid-textarea'
      this.textarea.spellcheck = false
      this.sourceContainer.appendChild(this.textarea)
    }

    // Set the current content
    this.textarea.value = this.node.textContent

    // Focus the textarea
    this.textarea.focus()

    // Handle key events
    this.textarea.onkeydown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        this.exitEditMode()
      }
      // Allow Tab to insert actual tab character
      if (e.key === 'Tab') {
        e.preventDefault()
        const start = this.textarea!.selectionStart
        const end = this.textarea!.selectionEnd
        this.textarea!.value =
          this.textarea!.value.substring(0, start) +
          '  ' +
          this.textarea!.value.substring(end)
        this.textarea!.selectionStart = this.textarea!.selectionEnd = start + 2
      }
    }

    // Handle blur (clicking outside)
    this.textarea.onblur = (e) => {
      // Don't exit if clicking on the edit/done button
      const relatedTarget = e.relatedTarget as HTMLElement
      if (relatedTarget === this.editButton) {
        return
      }
      // Small delay to allow button clicks to register
      setTimeout(() => {
        if (this.isEditMode && document.activeElement !== this.textarea) {
          this.exitEditMode()
        }
      }, 100)
    }

    // Update edit button click handler for "Done" mode
    this.editButton.onclick = (e) => {
      e.preventDefault()
      e.stopPropagation()
      if (this.isEditMode) {
        this.exitEditMode()
      } else {
        this.enterEditMode()
      }
    }
  }

  /**
   * Exits edit mode - saves changes and re-renders the diagram.
   */
  private exitEditMode(): void {
    if (!this.isEditMode || !this.textarea) return

    this.isEditMode = false
    this.dom.classList.remove('mermaid-editing')
    this.diagramContainer.style.display = 'block'
    this.sourceContainer.style.display = 'none'
    this.editButton.textContent = 'Edit'

    // Get the new content
    const newContent = this.textarea.value

    // Only update if content changed
    if (newContent !== this.node.textContent) {
      const pos = this.getPos()
      if (pos !== undefined) {
        const tr = this.view.state.tr

        // Replace the entire node content
        const start = pos + 1
        const end = pos + 1 + this.node.content.size

        // Delete old content and insert new
        tr.delete(start, end)
        if (newContent) {
          tr.insertText(newContent, start)
        }

        this.view.dispatch(tr)
      }
    }

    // Re-render with potentially new content
    this.lastRenderedCode = ''
    this.render()

    // Return focus to the editor
    this.view.focus()
  }

  /**
   * Called when the node is updated. Re-renders if content changed.
   */
  update(node: ProseMirrorNode): boolean {
    // Only handle updates to the same node type with mermaid language
    if (node.type !== this.node.type) return false
    if (node.attrs.language !== 'mermaid') return false

    this.node = node

    // If in edit mode, update textarea
    if (this.isEditMode && this.textarea) {
      // Only update if the change came from outside (e.g., undo/redo)
      if (this.textarea.value !== node.textContent) {
        this.textarea.value = node.textContent
      }
    } else {
      // In view mode, re-render if content changed
      if (node.textContent !== this.lastRenderedCode) {
        this.render()
      }
    }

    return true
  }

  /**
   * Called when the editor selection changes.
   */
  selectNode(): void {
    this.dom.classList.add('ProseMirror-selectednode')
  }

  deselectNode(): void {
    this.dom.classList.remove('ProseMirror-selectednode')
  }

  /**
   * Don't let ProseMirror handle mutations inside our custom DOM.
   */
  ignoreMutation(): boolean {
    return true
  }

  /**
   * Prevent ProseMirror from managing content.
   */
  stopEvent(event: Event): boolean {
    // Stop all events when in edit mode to prevent ProseMirror interference
    if (this.isEditMode) {
      return true
    }
    // Allow click and double-click for entering edit mode
    if (event.type === 'click' || event.type === 'dblclick') {
      return true
    }
    return false
  }

  /**
   * Cleanup when the NodeView is destroyed.
   */
  destroy(): void {
    // Clean up event listeners
    if (this.textarea) {
      this.textarea.onkeydown = null
      this.textarea.onblur = null
    }
    this.editButton.onclick = null
  }

  /**
   * Re-renders the diagram with the current theme.
   * Called when theme changes are detected.
   */
  reRenderForTheme(): void {
    if (!this.isEditMode) {
      reinitializeMermaidForTheme()
      this.lastRenderedCode = ''
      this.render()
    }
  }
}

/**
 * Factory function to create MermaidNodeView instances.
 * Used in EditorView's nodeViews configuration.
 *
 * Only creates a MermaidNodeView for code blocks with language="mermaid".
 * Returns null for other code blocks to use default rendering.
 */
export function createMermaidNodeView(
  node: ProseMirrorNode,
  view: EditorView,
  getPos: () => number | undefined
): MermaidNodeView | null {
  // Only handle mermaid code blocks
  if (node.attrs.language !== 'mermaid') {
    return null
  }

  return new MermaidNodeView(node, view, getPos)
}
