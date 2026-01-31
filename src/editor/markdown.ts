import { MarkdownParser, MarkdownSerializer, MarkdownSerializerState } from 'prosemirror-markdown'
import MarkdownIt from 'markdown-it'
import { schema } from './schema'
import { Mark, Node } from 'prosemirror-model'

// Extended type to access internal 'out' property for table cell serialization
interface MarkdownSerializerStateWithOut extends MarkdownSerializerState {
  out: string
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const md = new (MarkdownIt as any)()

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const markdownParser = new MarkdownParser(schema, md as any, {
  blockquote: { block: 'blockquote' },
  paragraph: { block: 'paragraph' },
  list_item: { block: 'list_item' },
  bullet_list: { block: 'bullet_list' },
  ordered_list: { block: 'ordered_list', getAttrs: (tok) => ({ order: +(tok.attrGet('start') || 1) }) },
  heading: { block: 'heading', getAttrs: (tok) => ({ level: +tok.tag.slice(1) }) },
  code_block: { block: 'code_block', noCloseToken: true },
  fence: { block: 'code_block', getAttrs: (tok) => ({ language: tok.info || '' }), noCloseToken: true },
  hr: { node: 'horizontal_rule' },
  image: { node: 'image', getAttrs: (tok) => ({
    src: tok.attrGet('src'),
    title: tok.attrGet('title') || null,
    alt: tok.children?.[0]?.content || null
  })},
  hardbreak: { node: 'hard_break' },
  em: { mark: 'em' },
  strong: { mark: 'strong' },
  link: { mark: 'link', getAttrs: (tok) => ({
    href: tok.attrGet('href'),
    title: tok.attrGet('title') || null
  })},
  code_inline: { mark: 'code' },
  s: { mark: 'strikethrough' },
  // Table token handlers
  table: { block: 'table' },
  thead: { block: 'table_head' },
  tbody: { block: 'table_body' },
  tr: { block: 'table_row' },
  th: { block: 'table_header', getAttrs: (tok) => ({ alignment: tok.attrGet('style')?.match(/text-align:(\w+)/)?.[1] || null }) },
  td: { block: 'table_cell', getAttrs: (tok) => ({ alignment: tok.attrGet('style')?.match(/text-align:(\w+)/)?.[1] || null }) },
  // Ignore other unsupported tokens
  html_block: { ignore: true, noCloseToken: true },
  html_inline: { ignore: true, noCloseToken: true }
})

export const markdownSerializer = new MarkdownSerializer({
  blockquote(state, node) {
    state.wrapBlock('> ', null, node, () => state.renderContent(node))
  },
  code_block(state, node) {
    const language = node.attrs.language || ''
    state.write('```' + language + '\n')
    state.text(node.textContent, false)
    state.ensureNewLine()
    state.write('```')
    state.closeBlock(node)
  },
  heading(state, node) {
    state.write(state.repeat('#', node.attrs.level) + ' ')
    state.renderInline(node)
    state.closeBlock(node)
  },
  horizontal_rule(state, node) {
    state.write(node.attrs.markup || '---')
    state.closeBlock(node)
  },
  bullet_list(state, node) {
    state.renderList(node, '  ', () => '- ')
  },
  ordered_list(state, node) {
    const start = node.attrs.order || 1
    const maxW = String(start + node.childCount - 1).length
    const space = state.repeat(' ', maxW + 2)
    state.renderList(node, space, (i) => {
      const nStr = String(start + i)
      return state.repeat(' ', maxW - nStr.length) + nStr + '. '
    })
  },
  list_item(state, node) {
    state.renderContent(node)
  },
  paragraph(state, node) {
    state.renderInline(node)
    state.closeBlock(node)
  },
  image(state, node) {
    state.write('![' + state.esc(node.attrs.alt || '') + '](' + node.attrs.src +
      (node.attrs.title ? ' "' + node.attrs.title.replace(/"/g, '\\"') + '"' : '') + ')')
  },
  hard_break(state, node, parent, index) {
    for (let i = index + 1; i < parent.childCount; i++) {
      if (parent.child(i).type !== node.type) {
        state.write('  \n')
        return
      }
    }
  },
  text(state, node) {
    state.text(node.text || '')
  },
  // Table serialization - we handle the entire table structure here
  table(state, node) {
    const rows: { cells: string[], alignments: (string | null)[] }[] = []
    let columnAlignments: (string | null)[] = []

    // Collect all rows and cells
    node.forEach(section => {
      const isHead = section.type.name === 'table_head'
      section.forEach(row => {
        const cells: string[] = []
        const alignments: (string | null)[] = []
        row.forEach(cell => {
          // Serialize cell content to markdown string
          let cellContent = ''
          cell.forEach(child => {
            if (child.isText) {
              cellContent += child.text || ''
            } else if (child.type.name === 'hard_break') {
              cellContent += '<br>'
            }
          })
          // Handle marks (bold, italic, code, etc.)
          if (cell.childCount > 0) {
            const tempState = state as MarkdownSerializerStateWithOut
            const oldOut = tempState.out
            tempState.out = ''
            state.renderInline(cell)
            cellContent = tempState.out.trim()
            tempState.out = oldOut
          }
          cells.push(cellContent)
          alignments.push(cell.attrs.alignment)
        })
        rows.push({ cells, alignments })
        // Use alignments from header row for the separator
        if (isHead && columnAlignments.length === 0) {
          columnAlignments = alignments
        }
      })
    })

    if (rows.length === 0) return

    // Calculate column widths for nice formatting
    const columnCount = Math.max(...rows.map(r => r.cells.length))
    const columnWidths: number[] = []
    for (let i = 0; i < columnCount; i++) {
      columnWidths[i] = Math.max(3, ...rows.map(r => (r.cells[i] || '').length))
    }

    // Write header row
    const headerRow = rows[0]
    state.write('|')
    for (let i = 0; i < columnCount; i++) {
      const cell = headerRow.cells[i] || ''
      state.write(' ' + cell.padEnd(columnWidths[i]) + ' |')
    }
    state.write('\n')

    // Write separator row
    state.write('|')
    for (let i = 0; i < columnCount; i++) {
      const align = columnAlignments[i]
      let sep = '-'.repeat(columnWidths[i])
      if (align === 'center') {
        sep = ':' + '-'.repeat(columnWidths[i] - 2) + ':'
      } else if (align === 'right') {
        sep = '-'.repeat(columnWidths[i] - 1) + ':'
      } else if (align === 'left') {
        sep = ':' + '-'.repeat(columnWidths[i] - 1)
      }
      state.write(' ' + sep + ' |')
    }
    state.write('\n')

    // Write body rows
    for (let rowIdx = 1; rowIdx < rows.length; rowIdx++) {
      const row = rows[rowIdx]
      state.write('|')
      for (let i = 0; i < columnCount; i++) {
        const cell = row.cells[i] || ''
        state.write(' ' + cell.padEnd(columnWidths[i]) + ' |')
      }
      state.write('\n')
    }

    state.closeBlock(node)
  },
  // These are handled by the table serializer above, but need stubs
  table_head(state, node) {
    state.renderContent(node)
  },
  table_body(state, node) {
    state.renderContent(node)
  },
  table_row(state, node) {
    state.renderContent(node)
  },
  table_cell(state, node) {
    state.renderInline(node)
  },
  table_header(state, node) {
    state.renderInline(node)
  }
}, {
  em: {
    open: '*',
    close: '*',
    mixable: true,
    expelEnclosingWhitespace: true
  },
  strong: {
    open: '**',
    close: '**',
    mixable: true,
    expelEnclosingWhitespace: true
  },
  link: {
    open(_state, mark: Mark, parent: Node, index: number) {
      return isPlainURL(mark, parent, index, 1) ? '<' : '['
    },
    close(_state, mark: Mark, parent: Node, index: number) {
      return isPlainURL(mark, parent, index, -1)
        ? '>'
        : '](' + mark.attrs.href + (mark.attrs.title ? ' "' + mark.attrs.title.replace(/"/g, '\\"') + '"' : '') + ')'
    }
  },
  code: {
    open(_state, _mark: Mark, parent: Node, index: number) {
      return backticksFor(parent.child(index), -1)
    },
    close(_state, _mark: Mark, parent: Node, index: number) {
      return backticksFor(parent.child(index - 1), 1)
    },
    escape: false
  },
  strikethrough: {
    open: '~~',
    close: '~~',
    mixable: true,
    expelEnclosingWhitespace: true
  }
})

function backticksFor(node: Node, side: number) {
  const ticks = /`+/g
  let m: RegExpExecArray | null
  let len = 0
  if (node.isText && node.text) {
    while ((m = ticks.exec(node.text))) {
      len = Math.max(len, m[0].length)
    }
  }
  let result = len > 0 && side > 0 ? ' `' : '`'
  for (let i = 0; i < len; i++) result += '`'
  if (len > 0 && side < 0) result += ' '
  return result
}

function isPlainURL(link: Mark, parent: Node, index: number, side: number) {
  if (link.attrs.title || !/^\w+:/.test(link.attrs.href)) return false
  const content = parent.child(index + (side < 0 ? -1 : 0))
  if (!content.isText || content.text !== link.attrs.href || content.marks[content.marks.length - 1] !== link) return false
  if (index === (side < 0 ? 1 : parent.childCount - 1)) return true
  const next = parent.child(index + (side < 0 ? -2 : 1))
  return !link.isInSet(next.marks)
}
