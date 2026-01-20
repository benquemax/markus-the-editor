/**
 * Table controls component.
 * Renders floating buttons around the currently focused table for adding/removing
 * rows and columns, and deleting the entire table.
 *
 * Button placement:
 * - Add row (+): bottom center of table
 * - Add column (+): right center of table
 * - Delete table (trash): top-right corner
 */
import { useEffect, useState, useCallback } from 'react'
import { EditorView } from 'prosemirror-view'
import { TableControlsState } from '../editor/plugins/tableControls'
import {
  addTableRow,
  addTableColumn,
  removeTable
} from '../editor/tableUtils'

interface TableControlsProps {
  state: TableControlsState
  view: EditorView | null
  containerRef: React.RefObject<HTMLDivElement>
}

interface Position {
  top: number
  left: number
}

export function TableControls({ state, view, containerRef }: TableControlsProps) {
  const [positions, setPositions] = useState<{
    addRow: Position | null
    addCol: Position | null
    deleteTable: Position | null
  }>({ addRow: null, addCol: null, deleteTable: null })

  // Get fresh table rect from DOM
  const getTableRect = useCallback((): DOMRect | null => {
    if (!view || !state.active || state.tablePos < 0) return null

    try {
      const tableDom = view.nodeDOM(state.tablePos)
      if (tableDom instanceof HTMLElement) {
        // Handle both cases: table directly or wrapped in tableWrapper div
        const tableElement = tableDom.tagName === 'TABLE'
          ? tableDom
          : tableDom.querySelector('table')
        if (tableElement) {
          return tableElement.getBoundingClientRect()
        }
      }
    } catch {
      // Can fail during state transitions
    }
    return null
  }, [view, state.active, state.tablePos])

  // Update button positions
  const updatePositions = useCallback(() => {
    if (!containerRef.current) {
      setPositions({ addRow: null, addCol: null, deleteTable: null })
      return
    }

    const tableRect = getTableRect()
    if (!tableRect) {
      setPositions({ addRow: null, addCol: null, deleteTable: null })
      return
    }

    const containerRect = containerRef.current.getBoundingClientRect()

    // Position is: table viewport position - container viewport position
    const relativeTop = tableRect.top - containerRect.top
    const relativeLeft = tableRect.left - containerRect.left

    // Button dimensions
    const btnSize = 20

    // Calculate positions - buttons centered ON the border (border splits them in half)
    // Add row: centered on bottom border
    const addRowTop = relativeTop + tableRect.height - btnSize / 2
    let addRowLeft = relativeLeft + tableRect.width / 2 - btnSize / 2

    // Add column: centered on right border
    const addColTop = relativeTop + tableRect.height / 2 - btnSize / 2
    let addColLeft = relativeLeft + tableRect.width - btnSize / 2

    // Delete table button: top-right corner, above the table
    let deleteLeft = relativeLeft + tableRect.width - 24

    // Constrain to container bounds (with some padding)
    const maxLeft = containerRect.width - btnSize - 4

    if (addColLeft > maxLeft) {
      addColLeft = maxLeft
    }
    if (deleteLeft > maxLeft) {
      deleteLeft = maxLeft
    }
    if (addRowLeft > maxLeft) {
      addRowLeft = maxLeft
    }

    setPositions({
      // Add row button: centered on bottom border
      addRow: {
        top: addRowTop,
        left: addRowLeft
      },
      // Add column button: centered on right border
      addCol: {
        top: addColTop,
        left: addColLeft
      },
      // Delete table button: top-right corner
      deleteTable: {
        top: relativeTop - 30,
        left: deleteLeft
      }
    })
  }, [containerRef, getTableRect])

  // Calculate button positions and update on scroll/resize
  // Dependencies include rowCount/colCount so positions update when table structure changes
  useEffect(() => {
    if (!state.active) {
      setPositions({ addRow: null, addCol: null, deleteTable: null })
      return
    }

    // Small delay to let DOM update after row/column changes
    const timeoutId = setTimeout(updatePositions, 0)

    // Find the scrollable container (the editor div with overflow-auto)
    const scrollContainer = containerRef.current?.querySelector('.ProseMirror')?.parentElement
    if (scrollContainer) {
      scrollContainer.addEventListener('scroll', updatePositions)
      window.addEventListener('resize', updatePositions)
      return () => {
        clearTimeout(timeoutId)
        scrollContainer.removeEventListener('scroll', updatePositions)
        window.removeEventListener('resize', updatePositions)
      }
    }

    return () => clearTimeout(timeoutId)
  }, [state.active, state.tablePos, state.rowCount, state.colCount, containerRef, updatePositions])

  // Handlers for table operations
  const handleAddRow = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (!view) return
    addTableRow(view, 'after')
    view.focus()
  }

  const handleAddCol = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (!view) return
    addTableColumn(view, 'after')
    view.focus()
  }

  const handleDeleteTable = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (!view) return
    removeTable(view)
    view.focus()
  }

  if (!state.active || !view) {
    return null
  }

  return (
    <>
      {/* Add row button (bottom center of table) */}
      {positions.addRow && (
        <button
          className="table-control-btn"
          style={{
            position: 'absolute',
            top: positions.addRow.top,
            left: positions.addRow.left
          }}
          onClick={handleAddRow}
          title="Add row"
        >
          +
        </button>
      )}

      {/* Add column button (right center of table) */}
      {positions.addCol && (
        <button
          className="table-control-btn"
          style={{
            position: 'absolute',
            top: positions.addCol.top,
            left: positions.addCol.left
          }}
          onClick={handleAddCol}
          title="Add column"
        >
          +
        </button>
      )}

      {/* Delete table button (top-right corner) */}
      {positions.deleteTable && (
        <button
          className="table-control-btn table-delete-btn"
          style={{
            position: 'absolute',
            top: positions.deleteTable.top,
            left: positions.deleteTable.left,
            width: '24px',
            height: '24px'
          }}
          onClick={handleDeleteTable}
          title="Delete table"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M3 6h18" />
            <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
            <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
          </svg>
        </button>
      )}
    </>
  )
}
