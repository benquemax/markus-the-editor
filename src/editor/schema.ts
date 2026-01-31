import { Schema, NodeSpec, MarkSpec } from 'prosemirror-model'

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

  // Table nodes for markdown table support
  table: {
    content: 'table_head? table_body',
    group: 'block',
    parseDOM: [{ tag: 'table' }],
    toDOM() {
      return ['table', 0]
    }
  },

  table_head: {
    content: 'table_row+',
    parseDOM: [{ tag: 'thead' }],
    toDOM() {
      return ['thead', 0]
    }
  },

  table_body: {
    content: 'table_row+',
    parseDOM: [{ tag: 'tbody' }],
    toDOM() {
      return ['tbody', 0]
    }
  },

  table_row: {
    content: '(table_cell | table_header)+',
    parseDOM: [{ tag: 'tr' }],
    toDOM() {
      return ['tr', 0]
    }
  },

  table_cell: {
    content: 'inline*',
    attrs: { alignment: { default: null } },
    parseDOM: [{
      tag: 'td',
      getAttrs(node) {
        const element = node as HTMLElement
        const style = element.style.textAlign
        return { alignment: style || null }
      }
    }],
    toDOM(node) {
      const attrs: Record<string, string> = {}
      if (node.attrs.alignment) {
        attrs.style = `text-align: ${node.attrs.alignment}`
      }
      return ['td', attrs, 0]
    }
  },

  table_header: {
    content: 'inline*',
    attrs: { alignment: { default: null } },
    parseDOM: [{
      tag: 'th',
      getAttrs(node) {
        const element = node as HTMLElement
        const style = element.style.textAlign
        return { alignment: style || null }
      }
    }],
    toDOM(node) {
      const attrs: Record<string, string> = {}
      if (node.attrs.alignment) {
        attrs.style = `text-align: ${node.attrs.alignment}`
      }
      return ['th', attrs, 0]
    }
  },

  image: {
    inline: true,
    attrs: {
      src: {},
      alt: { default: null },
      title: { default: null }
    },
    group: 'inline',
    draggable: true,
    parseDOM: [{
      tag: 'img[src]',
      getAttrs(node) {
        const element = node as HTMLElement
        return {
          src: element.getAttribute('src'),
          alt: element.getAttribute('alt'),
          title: element.getAttribute('title')
        }
      }
    }],
    toDOM(node) {
      const { src, alt, title } = node.attrs
      return ['img', { src, alt, title }]
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
  }
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
