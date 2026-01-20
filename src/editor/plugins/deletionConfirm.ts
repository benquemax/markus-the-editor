/**
 * Deletion confirmation plugin for the editor.
 * Implements a double-backspace deletion pattern for block elements like tables,
 * blockquotes, and code blocks. When the user presses backspace at a deletable
 * position, a toast notification is shown. A second backspace within the timeout
 * period will delete the element.
 */
import { Plugin, PluginKey, EditorState } from 'prosemirror-state'
import { showToast, hideToast } from '../../lib/toast'
import { schema } from '../schema'
import { isInTable, CellSelection, TableMap } from 'prosemirror-tables'

export type DeletionType = 'table' | 'blockquote' | 'code_block'

interface DeletionState {
  pendingDeletion: {
    type: DeletionType
    nodePos: number
    timestamp: number
  } | null
}

// Timeout for the double-backspace pattern (in milliseconds)
const DELETION_TIMEOUT = 2000

export const deletionConfirmPluginKey = new PluginKey<DeletionState>('deletionConfirm')

/**
 * Get human-readable name for the deletion type.
 */
function getTypeName(type: DeletionType): string {
  switch (type) {
    case 'table': return 'table'
    case 'blockquote': return 'blockquote'
    case 'code_block': return 'code block'
  }
}

/**
 * Check if cursor is in the top-left cell of a table and that cell is empty.
 * This is the position where double-backspace should delete the table.
 */
export function isInTopLeftTableCell(state: EditorState): { result: boolean; tablePos: number } {
  if (!isInTable(state)) {
    return { result: false, tablePos: -1 }
  }

  const { $from } = state.selection

  // Find the table node in the ancestor chain
  let tableNode = null
  let tablePos = -1
  for (let d = $from.depth; d >= 0; d--) {
    const node = $from.node(d)
    if (node.type === schema.nodes.table) {
      tableNode = node
      tablePos = $from.before(d)
      break
    }
  }

  if (!tableNode || tablePos < 0) {
    return { result: false, tablePos: -1 }
  }

  // Use TableMap to find the first cell
  const map = TableMap.get(tableNode)
  const firstCellPos = map.map[0] // Position of first cell relative to table start

  // Find the current cell position relative to table
  let currentCellPos = -1
  let currentCellNode = null
  for (let d = $from.depth; d >= 0; d--) {
    const node = $from.node(d)
    if (node.type === schema.nodes.table_cell || node.type === schema.nodes.table_header) {
      currentCellPos = $from.before(d) - tablePos - 1 // Relative to table content start
      currentCellNode = node
      break
    }
  }

  if (currentCellPos < 0 || !currentCellNode) {
    return { result: false, tablePos: -1 }
  }

  // Check if we're in the first cell
  const isFirstCell = currentCellPos === firstCellPos

  // Check if cursor is at the start of the cell (offset 0 within the paragraph)
  const cursorAtStart = $from.parentOffset === 0

  // Check if the cell content is empty (just an empty paragraph)
  const cellIsEmpty = currentCellNode.content.size === 2 // Empty paragraph = 2 (open + close tag)

  return {
    result: isFirstCell && cursorAtStart && cellIsEmpty,
    tablePos
  }
}

/**
 * Check if cursor is at the start of an empty blockquote.
 */
export function isAtStartOfEmptyBlockquote(state: EditorState): { result: boolean; nodePos: number } {
  const { $from } = state.selection

  // Look for blockquote in ancestors
  for (let d = $from.depth; d >= 0; d--) {
    const node = $from.node(d)
    if (node.type === schema.nodes.blockquote) {
      const nodePos = $from.before(d)

      // Check if cursor is at start (offset 0 in the first text position)
      const atStart = $from.parentOffset === 0 && d + 1 === $from.depth

      // Check if blockquote contains only a single empty paragraph
      const isEmpty = node.content.size === 2 // Just one empty paragraph

      return { result: atStart && isEmpty, nodePos }
    }
  }

  return { result: false, nodePos: -1 }
}

/**
 * Check if cursor is at the start of an empty code block.
 */
export function isAtStartOfEmptyCodeBlock(state: EditorState): { result: boolean; nodePos: number } {
  const { $from } = state.selection
  const node = $from.parent

  if (node.type === schema.nodes.code_block) {
    const nodePos = $from.before()

    // Check if cursor is at start and content is empty
    const atStart = $from.parentOffset === 0
    const isEmpty = node.content.size === 0

    return { result: atStart && isEmpty, nodePos }
  }

  return { result: false, nodePos: -1 }
}

/**
 * Check if we're in a deletable position for any supported block type.
 * Returns the type and position if deletable, null otherwise.
 */
export function getDeletableBlock(state: EditorState): { type: DeletionType; nodePos: number } | null {
  // Don't handle CellSelection (multi-cell selection)
  if (state.selection instanceof CellSelection) {
    return null
  }

  // Check table first
  const tableCheck = isInTopLeftTableCell(state)
  if (tableCheck.result) {
    return { type: 'table', nodePos: tableCheck.tablePos }
  }

  // Check blockquote
  const blockquoteCheck = isAtStartOfEmptyBlockquote(state)
  if (blockquoteCheck.result) {
    return { type: 'blockquote', nodePos: blockquoteCheck.nodePos }
  }

  // Check code block
  const codeBlockCheck = isAtStartOfEmptyCodeBlock(state)
  if (codeBlockCheck.result) {
    return { type: 'code_block', nodePos: codeBlockCheck.nodePos }
  }

  return null
}

/**
 * Create the deletion confirmation plugin.
 */
export function createDeletionConfirmPlugin(): Plugin<DeletionState> {
  return new Plugin<DeletionState>({
    key: deletionConfirmPluginKey,

    state: {
      init(): DeletionState {
        return { pendingDeletion: null }
      },

      apply(tr, value): DeletionState {
        const meta = tr.getMeta(deletionConfirmPluginKey)
        if (meta !== undefined) {
          return meta
        }

        // Clear pending deletion if document changed (user typed something)
        if (tr.docChanged && value.pendingDeletion) {
          hideToast()
          return { pendingDeletion: null }
        }

        // Check timeout - auto-clear expired pending deletions
        if (value.pendingDeletion) {
          const now = Date.now()
          if (now - value.pendingDeletion.timestamp > DELETION_TIMEOUT) {
            return { pendingDeletion: null }
          }
        }

        return value
      }
    }
  })
}

/**
 * Handle backspace at a deletable position.
 * Returns true if handled, false to let other handlers process.
 */
export function handleDeletionBackspace(state: EditorState, dispatch?: (tr: import('prosemirror-state').Transaction) => void): boolean {
  const pluginState = deletionConfirmPluginKey.getState(state)
  if (!pluginState) return false

  const deletableBlock = getDeletableBlock(state)

  // If we have a pending deletion and we're still at a deletable position of the same type
  if (pluginState.pendingDeletion) {
    const { type, nodePos, timestamp } = pluginState.pendingDeletion
    const now = Date.now()

    // Check if within timeout
    if (now - timestamp <= DELETION_TIMEOUT) {
      // Check if we're still at the same deletable block
      if (deletableBlock && deletableBlock.type === type && deletableBlock.nodePos === nodePos) {
        // Second backspace - delete the block!
        if (dispatch) {
          const node = state.doc.nodeAt(nodePos)
          if (node) {
            const tr = state.tr
              .delete(nodePos, nodePos + node.nodeSize)
              .setMeta(deletionConfirmPluginKey, { pendingDeletion: null })

            // Insert a paragraph if document would be empty
            if (tr.doc.content.size === 0) {
              tr.insert(0, schema.nodes.paragraph.create())
            }

            dispatch(tr)
            hideToast()
          }
        }
        return true
      }
    }

    // Pending deletion expired or position changed - clear it
    if (dispatch) {
      dispatch(state.tr.setMeta(deletionConfirmPluginKey, { pendingDeletion: null }))
    }
    hideToast()
  }

  // First backspace at a deletable position - show toast and mark pending
  if (deletableBlock) {
    if (dispatch) {
      const { type, nodePos } = deletableBlock
      const tr = state.tr.setMeta(deletionConfirmPluginKey, {
        pendingDeletion: {
          type,
          nodePos,
          timestamp: Date.now()
        }
      })
      dispatch(tr)
      showToast(`Press backspace again to delete ${getTypeName(type)}`, DELETION_TIMEOUT)
    }
    return true
  }

  return false
}
