/**
 * Progress Plugin
 *
 * A ProseMirror plugin that provides two layers of git diff visualisation:
 *
 * 1. **Gutter lines** (always active when a committed doc is set) — thin
 *    coloured left-border lines on modified and added blocks, similar to
 *    VS Code's gutter indicators.
 *
 * 2. **Side-by-side widgets** (only when `showWidgets` is true, i.e. the
 *    user toggles "Progress Mode") — read-only committed blocks shown
 *    beside the current version in a CSS Grid layout, with word-level
 *    diff highlighting and Revert/Restore buttons.
 *
 * The editor remains fully editable at all times; only the committed
 * widget elements are contentEditable=false.
 */

import { Plugin, PluginKey } from 'prosemirror-state'
import { Decoration, DecorationSet, EditorView } from 'prosemirror-view'
import { Node as ProseMirrorNode, DOMSerializer } from 'prosemirror-model'
import { schema } from '../../schema'
import { computeBlockDiff, BlockAlignment } from './blockDiff'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProgressPluginState {
  committedDoc: ProseMirrorNode | null
  alignments: BlockAlignment[]
  showWidgets: boolean
  decorations: DecorationSet
}

export interface ProgressPluginMeta {
  committedDoc?: ProseMirrorNode | null
  showWidgets?: boolean
}

export const progressPluginKey = new PluginKey<ProgressPluginState>('progress')

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

/**
 * Computes the document position where top-level block at `index` starts.
 */
function blockPos(doc: ProseMirrorNode, index: number): number {
  let pos = 0
  for (let i = 0; i < index; i++) {
    pos += doc.child(i).nodeSize
  }
  return pos
}

/**
 * Renders a ProseMirror node to a DOM element using DOMSerializer.
 */
function renderNodeToDOM(node: ProseMirrorNode): HTMLElement {
  const serializer = DOMSerializer.fromSchema(schema)
  const fragment = serializer.serializeNode(node)
  if (fragment instanceof HTMLElement) return fragment
  const wrapper = document.createElement('div')
  wrapper.appendChild(fragment)
  return wrapper
}

/**
 * Creates a revert/restore button element.
 */
function createActionButton(
  label: string,
  className: string,
  onClick: () => void
): HTMLElement {
  const btn = document.createElement('button')
  btn.textContent = label
  btn.className = className
  btn.addEventListener('click', (e) => {
    e.preventDefault()
    e.stopPropagation()
    onClick()
  })
  btn.contentEditable = 'false'
  return btn
}

/**
 * Creates a widget element showing the committed version of a block.
 * The widget is contentEditable=false so it acts as a read-only block.
 */
function createCommittedWidget(
  committedNode: ProseMirrorNode,
  cssClass: string,
  actionBtn?: HTMLElement
): HTMLElement {
  const container = document.createElement('div')
  container.className = cssClass
  container.contentEditable = 'false'

  const content = renderNodeToDOM(committedNode)
  container.appendChild(content)

  if (actionBtn) {
    container.appendChild(actionBtn)
  }

  return container
}

// ---------------------------------------------------------------------------
// Decoration generation
// ---------------------------------------------------------------------------

/**
 * Generates decorations based on block alignments.
 *
 * Always creates:
 *   - Node decorations for gutter lines on modified/added blocks
 *
 * When `showWidgets` is true, additionally creates:
 *   - Widget decorations for committed blocks (side-by-side left column)
 *   - Widget decorations for deleted blocks
 */
function createProgressDecorations(
  doc: ProseMirrorNode,
  committedDoc: ProseMirrorNode,
  alignments: BlockAlignment[],
  showWidgets: boolean,
  view: EditorView | null
): DecorationSet {
  const decorations: Decoration[] = []

  for (const alignment of alignments) {
    switch (alignment.status) {
      case 'unchanged':
        // No decoration — unchanged blocks look and behave normally
        break

      case 'modified': {
        if (alignment.currentIndex === null || alignment.committedIndex === null) break
        const from = blockPos(doc, alignment.currentIndex)
        const to = from + doc.child(alignment.currentIndex).nodeSize
        const committedNode = committedDoc.child(alignment.committedIndex)

        // Gutter line (always visible)
        decorations.push(
          Decoration.node(from, to, { class: 'progress-modified' })
        )

        if (showWidgets) {
          // Revert button — lives inside the committed widget but CSS
          // positions it absolutely at the top-right of the edited block
          const revertBtn = createActionButton(
            '\u21a9',
            'progress-revert-btn',
            () => {
              if (view && alignment.currentIndex !== null && alignment.committedIndex !== null) {
                revertBlock(view, alignment.currentIndex, alignment.committedIndex)
              }
            }
          )

          const committedWidget = createCommittedWidget(
            committedNode,
            'progress-committed',
            revertBtn
          )

          decorations.push(
            Decoration.widget(from, committedWidget, {
              side: -1,
              key: `progress-committed-${alignment.committedIndex}`
            })
          )
        }
        break
      }

      case 'added': {
        if (alignment.currentIndex === null) break
        const from = blockPos(doc, alignment.currentIndex)
        const to = from + doc.child(alignment.currentIndex).nodeSize
        // Gutter line (always visible)
        decorations.push(
          Decoration.node(from, to, { class: 'progress-added' })
        )
        break
      }

      case 'deleted': {
        // Deleted blocks are only shown as widgets in side-by-side mode
        if (!showWidgets || alignment.committedIndex === null) break
        const committedNode = committedDoc.child(alignment.committedIndex)

        // Determine insertion position
        let insertPos: number
        if (alignment.currentIndex !== null) {
          insertPos = blockPos(doc, alignment.currentIndex)
        } else {
          const idx = alignments.indexOf(alignment)
          let nextCurrentIdx: number | null = null
          for (let i = idx + 1; i < alignments.length; i++) {
            if (alignments[i].currentIndex !== null) {
              nextCurrentIdx = alignments[i].currentIndex
              break
            }
          }
          insertPos = nextCurrentIdx !== null
            ? blockPos(doc, nextCurrentIdx)
            : doc.content.size
        }

        const restoreBtn = createActionButton(
          '\u21a9 Restore',
          'progress-restore-btn',
          () => {
            if (view && alignment.committedIndex !== null) {
              restoreDeletedBlock(view, insertPos, alignment.committedIndex)
            }
          }
        )
        const widget = createCommittedWidget(
          committedNode,
          'progress-deleted',
          restoreBtn
        )
        decorations.push(
          Decoration.widget(insertPos, widget, {
            side: -1,
            key: `progress-deleted-${alignment.committedIndex}`
          })
        )
        break
      }
    }
  }

  return DecorationSet.create(doc, decorations)
}

// ---------------------------------------------------------------------------
// Revert / Restore
// ---------------------------------------------------------------------------

/**
 * Reverts a modified block to its committed version.
 */
export function revertBlock(
  view: EditorView,
  currentBlockIndex: number,
  committedBlockIndex: number
): void {
  const pluginState = progressPluginKey.getState(view.state)
  if (!pluginState?.committedDoc) return

  const committedBlock = pluginState.committedDoc.child(committedBlockIndex)
  const from = blockPos(view.state.doc, currentBlockIndex)
  const to = from + view.state.doc.child(currentBlockIndex).nodeSize

  const tr = view.state.tr.replaceWith(from, to, committedBlock)
  view.dispatch(tr)
}

/**
 * Restores a deleted block by inserting the committed version.
 */
export function restoreDeletedBlock(
  view: EditorView,
  insertPos: number,
  committedBlockIndex: number
): void {
  const pluginState = progressPluginKey.getState(view.state)
  if (!pluginState?.committedDoc) return

  const committedBlock = pluginState.committedDoc.child(committedBlockIndex)
  const tr = view.state.tr.insert(insertPos, committedBlock)
  view.dispatch(tr)
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

/**
 * Creates the Progress plugin.
 *
 * Set the committed doc:  tr.setMeta(progressPluginKey, { committedDoc })
 *   → gutter lines appear on modified/added blocks
 *
 * Toggle side-by-side:    tr.setMeta(progressPluginKey, { showWidgets: true })
 *   → committed blocks appear beside modified blocks in a CSS Grid
 *
 * Clear committed doc:    tr.setMeta(progressPluginKey, { committedDoc: null })
 *   → all decorations removed
 */
export function createProgressPlugin() {
  let viewRef: EditorView | null = null

  return new Plugin<ProgressPluginState>({
    key: progressPluginKey,

    state: {
      init() {
        return {
          committedDoc: null,
          alignments: [],
          showWidgets: false,
          decorations: DecorationSet.empty
        }
      },

      apply(tr, pluginState, _oldState, newState) {
        const meta = tr.getMeta(progressPluginKey) as ProgressPluginMeta | undefined

        if (meta !== undefined) {
          // Merge meta into current state
          const committedDoc = meta.committedDoc !== undefined
            ? meta.committedDoc
            : pluginState.committedDoc
          const showWidgets = meta.showWidgets !== undefined
            ? meta.showWidgets
            : pluginState.showWidgets

          if (!committedDoc) {
            return {
              committedDoc: null,
              alignments: [],
              showWidgets,
              decorations: DecorationSet.empty
            }
          }

          const alignments = computeBlockDiff(newState.doc, committedDoc)
          return {
            committedDoc,
            alignments,
            showWidgets,
            decorations: createProgressDecorations(
              newState.doc, committedDoc, alignments, showWidgets, viewRef
            )
          }
        }

        // No meta — recompute decorations if the document changed
        if (!pluginState.committedDoc) return pluginState

        if (tr.docChanged) {
          const alignments = computeBlockDiff(newState.doc, pluginState.committedDoc)
          return {
            ...pluginState,
            alignments,
            decorations: createProgressDecorations(
              newState.doc, pluginState.committedDoc, alignments,
              pluginState.showWidgets, viewRef
            )
          }
        }

        return pluginState
      }
    },

    props: {
      decorations(state) {
        return this.getState(state)?.decorations ?? DecorationSet.empty
      }
    },

    // No filterTransaction — all blocks are fully editable.
    // Only committed widget elements are contentEditable=false.

    view(editorView) {
      viewRef = editorView
      return {
        update(view) {
          viewRef = view
        },
        destroy() {
          viewRef = null
        }
      }
    }
  })
}
