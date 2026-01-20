/**
 * ProseMirror schema definition for the editor.
 * Defines all node types (blocks, inline elements) and marks (text formatting)
 * that can exist in the document. This is the foundation of the editor's
 * document model.
 */
import { Schema, NodeSpec, MarkSpec } from 'prosemirror-model'
import { tableNodes } from 'prosemirror-tables'

// Get table node specs from prosemirror-tables
// These provide robust table editing with cell navigation and selection
const tableNodeSpecs = tableNodes({
  tableGroup: 'block',
  cellContent: 'block+',
  cellAttributes: {}
})

const nodes: Record<string, NodeSpec> = {
  doc: {
    content: 'block+'
  },

  paragraph: {
    content: 'inline*',
    group: 'block',
    parseDOM: [{ tag: 'p' }],
    toDOM() {
      return ['p', 0]
    }
  },

  heading: {
    attrs: { level: { default: 1 } },
    content: 'inline*',
    group: 'block',
    defining: true,
    parseDOM: [
      { tag: 'h1', attrs: { level: 1 } },
      { tag: 'h2', attrs: { level: 2 } },
      { tag: 'h3', attrs: { level: 3 } },
      { tag: 'h4', attrs: { level: 4 } },
      { tag: 'h5', attrs: { level: 5 } },
      { tag: 'h6', attrs: { level: 6 } }
    ],
    toDOM(node) {
      return ['h' + node.attrs.level, 0]
    }
  },

  blockquote: {
    content: 'block+',
    group: 'block',
    defining: true,
    parseDOM: [{ tag: 'blockquote' }],
    toDOM() {
      return ['blockquote', 0]
    }
  },

  code_block: {
    content: 'text*',
    marks: '',
    group: 'block',
    code: true,
    defining: true,
    attrs: { language: { default: '' } },
    parseDOM: [{
      tag: 'pre',
      preserveWhitespace: 'full',
      getAttrs(node) {
        const element = node as HTMLElement
        const code = element.querySelector('code')
        const className = code?.className || ''
        const match = className.match(/language-(\w+)/)
        return { language: match ? match[1] : '' }
      }
    }],
    toDOM(node) {
      return ['pre', { class: node.attrs.language ? `language-${node.attrs.language}` : '' }, ['code', 0]]
    }
  },

  horizontal_rule: {
    group: 'block',
    parseDOM: [{ tag: 'hr' }],
    toDOM() {
      return ['hr']
    }
  },

  bullet_list: {
    content: 'list_item+',
    group: 'block',
    parseDOM: [{ tag: 'ul' }],
    toDOM() {
      return ['ul', 0]
    }
  },

  ordered_list: {
    content: 'list_item+',
    group: 'block',
    attrs: { order: { default: 1 } },
    parseDOM: [{
      tag: 'ol',
      getAttrs(node) {
        const element = node as HTMLElement
        return { order: element.hasAttribute('start') ? +element.getAttribute('start')! : 1 }
      }
    }],
    toDOM(node) {
      return node.attrs.order === 1 ? ['ol', 0] : ['ol', { start: node.attrs.order }, 0]
    }
  },

  list_item: {
    content: 'paragraph block*',
    parseDOM: [{ tag: 'li' }],
    toDOM() {
      return ['li', 0]
    },
    defining: true
  },

  image: {
    inline: true,
    attrs: {
      src: {},
      alt: { default: null },
      title: { default: null },
      // Alignment: 'inline' (default, flows with text), 'left'/'right' (float), 'center' (block)
      align: { default: 'inline' },
      // Width as percentage (1-100), 100 means full width
      width: { default: 100 },
      // Relative source path for markdown serialization (optional)
      // When set, this is used in markdown output instead of src
      // This allows src to be a file:// URL for display while preserving relative paths
      relativeSrc: { default: null }
    },
    group: 'inline',
    draggable: true,
    parseDOM: [{
      tag: 'img[src]',
      getAttrs(node) {
        const element = node as HTMLElement
        const alignAttr = element.getAttribute('align') || element.getAttribute('data-align')
        const widthAttr = element.getAttribute('width') || element.getAttribute('data-width')

        // Parse width - handle both "50%" and "50" formats
        let width = 100
        if (widthAttr) {
          const parsed = parseInt(widthAttr.replace('%', ''), 10)
          if (!isNaN(parsed) && parsed >= 1 && parsed <= 100) {
            width = parsed
          }
        }

        return {
          src: element.getAttribute('src'),
          alt: element.getAttribute('alt'),
          title: element.getAttribute('title'),
          align: alignAttr || 'inline',
          width
        }
      }
    }],
    toDOM(node) {
      const { src, alt, title, align, width } = node.attrs
      const attrs: Record<string, string> = { src }
      if (alt) attrs.alt = alt
      if (title) attrs.title = title
      // Add data attributes for CSS styling
      if (align && align !== 'inline') attrs['data-align'] = align
      if (width && width !== 100) {
        attrs['data-width'] = String(width)
        attrs.style = `width: ${width}%`
      }
      return ['img', attrs]
    }
  },

  hard_break: {
    inline: true,
    group: 'inline',
    selectable: false,
    parseDOM: [{ tag: 'br' }],
    toDOM() {
      return ['br']
    }
  },

  text: {
    group: 'inline'
  },

  // Table nodes from prosemirror-tables
  // Spread the specs directly to include table, table_row, table_cell, table_header
  ...tableNodeSpecs
}

const marks: Record<string, MarkSpec> = {
  strong: {
    parseDOM: [
      { tag: 'strong' },
      { tag: 'b', getAttrs: (node) => (node as HTMLElement).style.fontWeight !== 'normal' && null },
      { style: 'font-weight', getAttrs: (value) => /^(bold(er)?|[5-9]\d{2,})$/.test(value as string) && null }
    ],
    toDOM() {
      return ['strong', 0]
    }
  },

  em: {
    parseDOM: [
      { tag: 'i' },
      { tag: 'em' },
      { style: 'font-style=italic' }
    ],
    toDOM() {
      return ['em', 0]
    }
  },

  code: {
    parseDOM: [{ tag: 'code' }],
    toDOM() {
      return ['code', 0]
    }
  },

  link: {
    attrs: {
      href: {},
      title: { default: null }
    },
    inclusive: false,
    parseDOM: [{
      tag: 'a[href]',
      getAttrs(node) {
        const element = node as HTMLElement
        return {
          href: element.getAttribute('href'),
          title: element.getAttribute('title')
        }
      }
    }],
    toDOM(node) {
      const { href, title } = node.attrs
      return ['a', { href, title }, 0]
    }
  },

  strikethrough: {
    parseDOM: [
      { tag: 's' },
      { tag: 'del' },
      { tag: 'strike' },
      { style: 'text-decoration', getAttrs: (value) => (value as string).includes('line-through') && null }
    ],
    toDOM() {
      return ['s', 0]
    }
  }
}

export const schema = new Schema({ nodes, marks })
