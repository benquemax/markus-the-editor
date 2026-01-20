/**
 * Table controls plugin for the editor.
 * Tracks which table (if any) the cursor is in, providing the necessary state
 * for the TableControls React component to render manipulation buttons.
 */
import { Plugin, PluginKey, EditorState } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { isInTable, TableMap } from 'prosemirror-tables'
import { schema } from '../schema'

export interface TableControlsState {
  /** Whether the cursor is currently in a table */
  active: boolean
  /** The absolute document position where the table node starts */
  tablePos: number
  /** Number of rows in the table */
  rowCount: number
  /** Number of columns in the table */
  colCount: number
  /** Current row index (0-based) */
  currentRow: number
  /** Current column index (0-based) */
  currentCol: number
  /** DOM rect of the table element for positioning controls */
  tableRect: DOMRect | null
  /** Array of row positions (top offset relative to table) */
  rowPositions: number[]
  /** Array of column positions (left offset relative to table) */
  colPositions: number[]
}

export const tableControlsPluginKey = new PluginKey<TableControlsState>('tableControls')

const emptyState: TableControlsState = {
  active: false,
  tablePos: -1,
  rowCount: 0,
  colCount: 0,
  currentRow: -1,
  currentCol: -1,
  tableRect: null,
  rowPositions: [],
  colPositions: []
}

/**
 * Get table state from the current editor state.
 */
function getTableState(state: EditorState, view?: EditorView): TableControlsState {
  if (!isInTable(state)) {
    return emptyState
  }

  const { $from } = state.selection

  // Find the table node
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
    return emptyState
  }

  const map = TableMap.get(tableNode)

  // Find current cell position
  let currentCellPos = -1
  for (let d = $from.depth; d >= 0; d--) {
    const node = $from.node(d)
    if (node.type === schema.nodes.table_cell || node.type === schema.nodes.table_header) {
      currentCellPos = $from.before(d) - tablePos - 1
      break
    }
  }

  if (currentCellPos < 0) {
    return emptyState
  }

  // Find row and column indices
  const cellIndex = map.map.indexOf(currentCellPos)
  if (cellIndex < 0) {
    return emptyState
  }

  const currentRow = Math.floor(cellIndex / map.width)
  const currentCol = cellIndex % map.width

  // Get DOM positions if view is available
  let tableRect: DOMRect | null = null
  const rowPositions: number[] = []
  const colPositions: number[] = []

  if (view) {
    try {
      // Get the table's DOM element
      const tableDom = view.nodeDOM(tablePos)
      if (tableDom instanceof HTMLElement) {
        // Find the actual table element (might be wrapped in a tableWrapper div)
        const tableElement = tableDom.tagName === 'TABLE' ? tableDom : tableDom.querySelector('table')
        if (tableElement) {
          tableRect = tableElement.getBoundingClientRect()

          // Get row positions from table rows
          const rows = tableElement.querySelectorAll('tr')
          const tableTop = tableRect.top
          rows.forEach(row => {
            const rowRect = row.getBoundingClientRect()
            rowPositions.push(rowRect.top - tableTop)
          })

          // Get column positions from first row's cells
          if (rows.length > 0) {
            const cells = rows[0].querySelectorAll('th, td')
            const tableLeft = tableRect.left
            cells.forEach(cell => {
              const cellRect = cell.getBoundingClientRect()
              colPositions.push(cellRect.left - tableLeft)
            })
          }
        }
      }
    } catch {
      // DOM access can fail during state transitions
    }
  }

  return {
    active: true,
    tablePos,
    rowCount: map.height,
    colCount: map.width,
    currentRow,
    currentCol,
    tableRect,
    rowPositions,
    colPositions
  }
}

/**
 * Create the table controls plugin.
 * @param onStateChange - Callback invoked when table state changes (for React integration)
 */
export function createTableControlsPlugin(
  onStateChange: (state: TableControlsState) => void
): Plugin<TableControlsState> {
  let currentView: EditorView | null = null

  return new Plugin<TableControlsState>({
    key: tableControlsPluginKey,

    state: {
      init(): TableControlsState {
        return emptyState
      },

      apply(tr, value, _oldState, newState): TableControlsState {
        // We need to recompute on any document or selection change
        if (tr.docChanged || tr.selectionSet) {
          return getTableState(newState, currentView || undefined)
        }
        return value
      }
    },

    view(view) {
      currentView = view

      // Initial state notification
      const initialState = getTableState(view.state, view)
      onStateChange(initialState)

      return {
        update(view, prevState) {
          const pluginState = tableControlsPluginKey.getState(view.state)
          const prevPluginState = tableControlsPluginKey.getState(prevState)

          // Only notify if state actually changed
          if (pluginState !== prevPluginState) {
            // Recompute with fresh DOM info
            const freshState = getTableState(view.state, view)
            onStateChange(freshState)
          }
        },
        destroy() {
          currentView = null
          onStateChange(emptyState)
        }
      }
    }
  })
}
