/**
 * Diff Highlight Plugin
 *
 * A ProseMirror plugin that highlights lines changed since the last git commit.
 * Shows a colored left border on modified/added lines, similar to VS Code's gutter indicators.
 */

import { Plugin, PluginKey, EditorState } from 'prosemirror-state'
import { Decoration, DecorationSet, EditorView } from 'prosemirror-view'
import { Node as ProseMirrorNode } from 'prosemirror-model'

export interface DiffHunk {
  startLine: number
  endLine: number
  type: 'added' | 'modified'
}

export const diffHighlightPluginKey = new PluginKey<DiffHighlightState>('diffHighlight')

interface DiffHighlightState {
  hunks: DiffHunk[]
  decorations: DecorationSet
}

/**
 * Creates decorations for diff hunks.
 * Each hunk gets a line decoration with a colored left border.
 */
function createDecorations(doc: ProseMirrorNode, hunks: DiffHunk[]): DecorationSet {
  if (hunks.length === 0) {
    return DecorationSet.empty
  }

  const decorations: Decoration[] = []

  // Map line numbers to positions
  // ProseMirror doesn't have line numbers, so we need to count paragraphs/blocks
  let currentLine = 1
  const linePositions: Map<number, { from: number; to: number }> = new Map()

  doc.nodesBetween(0, doc.content.size, (node: ProseMirrorNode, pos: number) => {
    if (node.isBlock) {
      linePositions.set(currentLine, {
        from: pos,
        to: pos + node.nodeSize
      })
      currentLine++
    }
  })

  // Create decorations for each hunk
  for (const hunk of hunks) {
    for (let line = hunk.startLine; line <= hunk.endLine; line++) {
      const linePos = linePositions.get(line)
      if (linePos) {
        const className = hunk.type === 'added' ? 'diff-added' : 'diff-modified'
        decorations.push(
          Decoration.node(linePos.from, linePos.to, {
            class: className
          })
        )
      }
    }
  }

  return DecorationSet.create(doc, decorations)
}

/**
 * Creates the diff highlight plugin.
 */
export function createDiffHighlightPlugin() {
  return new Plugin<DiffHighlightState>({
    key: diffHighlightPluginKey,

    state: {
      init() {
        return {
          hunks: [],
          decorations: DecorationSet.empty
        }
      },

      apply(tr, pluginState, _oldState, newState: EditorState) {
        // Check for new diff data in transaction metadata
        const newHunks = tr.getMeta(diffHighlightPluginKey) as DiffHunk[] | undefined

        if (newHunks !== undefined) {
          // New diff data provided
          return {
            hunks: newHunks,
            decorations: createDecorations(newState.doc, newHunks)
          }
        }

        if (tr.docChanged) {
          // Document changed, clear decorations as they may be invalid
          // The editor will need to re-fetch diff data after changes
          return {
            hunks: [],
            decorations: DecorationSet.empty
          }
        }

        // No changes
        return pluginState
      }
    },

    props: {
      decorations(state) {
        return this.getState(state)?.decorations ?? DecorationSet.empty
      }
    }
  })
}

/**
 * Updates the diff hunks in the editor.
 * Call this after loading a file or saving to refresh the diff highlighting.
 */
export function setDiffHunks(view: EditorView, hunks: DiffHunk[]) {
  const tr = view.state.tr.setMeta(diffHighlightPluginKey, hunks)
  view.dispatch(tr)
}
