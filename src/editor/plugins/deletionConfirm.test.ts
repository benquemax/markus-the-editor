/**
 * Tests for deletion confirmation plugin.
 * Tests the helpers that detect deletable positions for the double-backspace pattern.
 */
import { describe, it, expect } from 'vitest'
import { EditorState, TextSelection } from 'prosemirror-state'
import { schema } from '../schema'
import {
  isInTopLeftTableCell,
  isAtStartOfEmptyBlockquote,
  isAtStartOfEmptyCodeBlock,
  getDeletableBlock
} from './deletionConfirm'

/**
 * Helper to create an editor state with given document structure
 * and cursor at specified position.
 */
function createState(doc: ReturnType<typeof schema.nodes.doc.create>, cursorPos: number): EditorState {
  const state = EditorState.create({ doc, schema })
  return state.apply(
    state.tr.setSelection(TextSelection.create(state.doc, cursorPos))
  )
}

/**
 * Helper to create a table with given dimensions.
 */
function createTable(rows: number, cols: number) {
  const headerCells = []
  for (let i = 0; i < cols; i++) {
    headerCells.push(
      schema.nodes.table_header.create(null, schema.nodes.paragraph.create())
    )
  }
  const headerRow = schema.nodes.table_row.create(null, headerCells)

  const bodyRows = []
  for (let r = 1; r < rows; r++) {
    const cells = []
    for (let c = 0; c < cols; c++) {
      cells.push(
        schema.nodes.table_cell.create(null, schema.nodes.paragraph.create())
      )
    }
    bodyRows.push(schema.nodes.table_row.create(null, cells))
  }

  return schema.nodes.table.create(null, [headerRow, ...bodyRows])
}

describe('isInTopLeftTableCell', () => {
  it('should return true when cursor is at start of empty top-left cell', () => {
    const table = createTable(2, 2)
    const doc = schema.nodes.doc.create(null, [table])
    // Position breakdown for 2x2 table:
    // 0: doc start
    // 1: table start
    // 2: table_row start (header row)
    // 3: table_header start (first cell)
    // 4: paragraph start (inside first cell)
    // cursor at position 4 is at start of empty paragraph in top-left cell
    const state = createState(doc, 4)

    const result = isInTopLeftTableCell(state)
    expect(result.result).toBe(true)
    expect(result.tablePos).toBe(0)
  })

  it('should return false when cursor is in second cell (same row)', () => {
    const table = createTable(2, 2)
    const doc = schema.nodes.doc.create(null, [table])
    // Position 4 is first cell, second cell starts later
    // First cell: 3-5 (header, paragraph, /header)
    // Second cell: 6-8 (header, paragraph, /header)
    // Cursor at position 7 is in the second cell
    const state = createState(doc, 7)

    const result = isInTopLeftTableCell(state)
    expect(result.result).toBe(false)
  })

  it('should return false when cursor is in second row', () => {
    const table = createTable(2, 2)
    const doc = schema.nodes.doc.create(null, [table])
    // Second row starts after first row closes
    // First row ends, second row starts, then its first cell
    // Row 2 cell 1 paragraph would be around position 13
    const state = createState(doc, 13)

    const result = isInTopLeftTableCell(state)
    expect(result.result).toBe(false)
  })

  it('should return false when not in a table', () => {
    const para = schema.nodes.paragraph.create(null, schema.text('Hello'))
    const doc = schema.nodes.doc.create(null, [para])
    const state = createState(doc, 1)

    const result = isInTopLeftTableCell(state)
    expect(result.result).toBe(false)
    expect(result.tablePos).toBe(-1)
  })

  it('should return false when top-left cell has content', () => {
    // Create a table with content in the first cell
    const headerCells = [
      schema.nodes.table_header.create(
        null,
        schema.nodes.paragraph.create(null, schema.text('content'))
      ),
      schema.nodes.table_header.create(null, schema.nodes.paragraph.create())
    ]
    const headerRow = schema.nodes.table_row.create(null, headerCells)
    const bodyRow = schema.nodes.table_row.create(null, [
      schema.nodes.table_cell.create(null, schema.nodes.paragraph.create()),
      schema.nodes.table_cell.create(null, schema.nodes.paragraph.create())
    ])
    const table = schema.nodes.table.create(null, [headerRow, bodyRow])
    const doc = schema.nodes.doc.create(null, [table])

    // Cursor at start of non-empty cell
    const state = createState(doc, 4)

    const result = isInTopLeftTableCell(state)
    // Cell is not empty, so deletion should not trigger
    expect(result.result).toBe(false)
  })
})

describe('isAtStartOfEmptyBlockquote', () => {
  it('should return true for empty blockquote at cursor start', () => {
    const blockquote = schema.nodes.blockquote.create(
      null,
      schema.nodes.paragraph.create()
    )
    const doc = schema.nodes.doc.create(null, [blockquote])
    // Position: 0=doc, 1=blockquote, 2=paragraph, cursor at 2
    const state = createState(doc, 2)

    const result = isAtStartOfEmptyBlockquote(state)
    expect(result.result).toBe(true)
    expect(result.nodePos).toBe(0)
  })

  it('should return false when blockquote has content', () => {
    const blockquote = schema.nodes.blockquote.create(
      null,
      schema.nodes.paragraph.create(null, schema.text('content'))
    )
    const doc = schema.nodes.doc.create(null, [blockquote])
    const state = createState(doc, 2)

    const result = isAtStartOfEmptyBlockquote(state)
    expect(result.result).toBe(false)
  })

  it('should return false when not in blockquote', () => {
    const para = schema.nodes.paragraph.create()
    const doc = schema.nodes.doc.create(null, [para])
    const state = createState(doc, 1)

    const result = isAtStartOfEmptyBlockquote(state)
    expect(result.result).toBe(false)
    expect(result.nodePos).toBe(-1)
  })

  it('should return false when cursor is not at start', () => {
    const blockquote = schema.nodes.blockquote.create(
      null,
      schema.nodes.paragraph.create(null, schema.text('content'))
    )
    const doc = schema.nodes.doc.create(null, [blockquote])
    // Cursor in the middle of the content
    const state = createState(doc, 5)

    const result = isAtStartOfEmptyBlockquote(state)
    expect(result.result).toBe(false)
  })
})

describe('isAtStartOfEmptyCodeBlock', () => {
  it('should return true for empty code block at cursor start', () => {
    const codeBlock = schema.nodes.code_block.create()
    const doc = schema.nodes.doc.create(null, [codeBlock])
    // Position: 0=doc, 1=code_block content start, cursor at 1
    const state = createState(doc, 1)

    const result = isAtStartOfEmptyCodeBlock(state)
    expect(result.result).toBe(true)
    expect(result.nodePos).toBe(0)
  })

  it('should return false when code block has content', () => {
    const codeBlock = schema.nodes.code_block.create(null, schema.text('code'))
    const doc = schema.nodes.doc.create(null, [codeBlock])
    const state = createState(doc, 1)

    const result = isAtStartOfEmptyCodeBlock(state)
    expect(result.result).toBe(false)
  })

  it('should return false when not in code block', () => {
    const para = schema.nodes.paragraph.create()
    const doc = schema.nodes.doc.create(null, [para])
    const state = createState(doc, 1)

    const result = isAtStartOfEmptyCodeBlock(state)
    expect(result.result).toBe(false)
    expect(result.nodePos).toBe(-1)
  })

  it('should return false when cursor is not at start', () => {
    const codeBlock = schema.nodes.code_block.create(null, schema.text('code'))
    const doc = schema.nodes.doc.create(null, [codeBlock])
    // Cursor in the middle of code
    const state = createState(doc, 3)

    const result = isAtStartOfEmptyCodeBlock(state)
    expect(result.result).toBe(false)
  })
})

describe('getDeletableBlock', () => {
  it('should return table type for top-left cell deletion', () => {
    const table = createTable(2, 2)
    const doc = schema.nodes.doc.create(null, [table])
    const state = createState(doc, 4)

    const result = getDeletableBlock(state)
    expect(result).not.toBeNull()
    expect(result?.type).toBe('table')
  })

  it('should return blockquote type for empty blockquote deletion', () => {
    const blockquote = schema.nodes.blockquote.create(
      null,
      schema.nodes.paragraph.create()
    )
    const doc = schema.nodes.doc.create(null, [blockquote])
    const state = createState(doc, 2)

    const result = getDeletableBlock(state)
    expect(result).not.toBeNull()
    expect(result?.type).toBe('blockquote')
  })

  it('should return code_block type for empty code block deletion', () => {
    const codeBlock = schema.nodes.code_block.create()
    const doc = schema.nodes.doc.create(null, [codeBlock])
    const state = createState(doc, 1)

    const result = getDeletableBlock(state)
    expect(result).not.toBeNull()
    expect(result?.type).toBe('code_block')
  })

  it('should return null when not in deletable position', () => {
    const para = schema.nodes.paragraph.create(null, schema.text('Hello'))
    const doc = schema.nodes.doc.create(null, [para])
    const state = createState(doc, 3)

    const result = getDeletableBlock(state)
    expect(result).toBeNull()
  })
})
