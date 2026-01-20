/**
 * Utility functions for table operations in the editor.
 * Provides helper functions to create and manipulate tables using prosemirror-tables.
 */
import { EditorView } from 'prosemirror-view'
import { EditorState } from 'prosemirror-state'
import { schema } from './schema'
import {
  addRowBefore,
  addRowAfter,
  addColumnBefore,
  addColumnAfter,
  deleteRow,
  deleteColumn,
  deleteTable,
  isInTable,
  TableMap
} from 'prosemirror-tables'

/**
 * Create and insert a table at the current cursor position.
 * Creates a table with the specified dimensions (default 2x2) with a header row.
 */
export function createTable(view: EditorView, rows = 2, cols = 2): boolean {
  const { state, dispatch } = view
  const { tr } = state

  // Create header cells for the first row
  const headerCells = []
  for (let i = 0; i < cols; i++) {
    headerCells.push(
      schema.nodes.table_header.create(
        null,
        schema.nodes.paragraph.create()
      )
    )
  }
  const headerRow = schema.nodes.table_row.create(null, headerCells)

  // Create body rows with regular cells
  const bodyRows = []
  for (let r = 1; r < rows; r++) {
    const cells = []
    for (let c = 0; c < cols; c++) {
      cells.push(
        schema.nodes.table_cell.create(
          null,
          schema.nodes.paragraph.create()
        )
      )
    }
    bodyRows.push(schema.nodes.table_row.create(null, cells))
  }

  // Create the table node
  const table = schema.nodes.table.create(null, [headerRow, ...bodyRows])

  // Insert the table at the current position
  dispatch(tr.replaceSelectionWith(table).scrollIntoView())

  return true
}

/**
 * Add a row to the table.
 * @param position - 'before' adds above current row, 'after' adds below
 */
export function addTableRow(view: EditorView, position: 'before' | 'after'): boolean {
  const command = position === 'before' ? addRowBefore : addRowAfter
  return command(view.state, view.dispatch)
}

/**
 * Add a column to the table.
 * @param position - 'before' adds to the left, 'after' adds to the right
 */
export function addTableColumn(view: EditorView, position: 'before' | 'after'): boolean {
  const command = position === 'before' ? addColumnBefore : addColumnAfter
  return command(view.state, view.dispatch)
}

/**
 * Remove the current row from the table.
 */
export function removeTableRow(view: EditorView): boolean {
  return deleteRow(view.state, view.dispatch)
}

/**
 * Remove the current column from the table.
 */
export function removeTableColumn(view: EditorView): boolean {
  return deleteColumn(view.state, view.dispatch)
}

/**
 * Remove the entire table.
 */
export function removeTable(view: EditorView): boolean {
  return deleteTable(view.state, view.dispatch)
}

/**
 * Get table info at the current cursor position.
 * Returns null if not in a table.
 */
export function getTableInfo(state: EditorState): {
  tablePos: number
  rowCount: number
  colCount: number
  currentRow: number
  currentCol: number
} | null {
  if (!isInTable(state)) {
    return null
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
    return null
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
    return null
  }

  // Find row and column indices
  const cellIndex = map.map.indexOf(currentCellPos)
  if (cellIndex < 0) {
    return null
  }

  const currentRow = Math.floor(cellIndex / map.width)
  const currentCol = cellIndex % map.width

  return {
    tablePos,
    rowCount: map.height,
    colCount: map.width,
    currentRow,
    currentCol
  }
}
