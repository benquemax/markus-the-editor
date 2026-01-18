import { describe, it, expect } from 'vitest'
import { markdownParser, markdownSerializer } from './markdown'
import { schema } from './schema'

describe('Markdown Parser', () => {
  it('should parse plain text', () => {
    const doc = markdownParser.parse('Hello world')
    expect(doc).toBeDefined()
    expect(doc?.textContent).toBe('Hello world')
  })

  it('should parse headings', () => {
    const doc = markdownParser.parse('# Heading 1\n\n## Heading 2')
    expect(doc).toBeDefined()
    const h1 = doc?.firstChild
    expect(h1?.type.name).toBe('heading')
    expect(h1?.attrs.level).toBe(1)
  })

  it('should parse bold text', () => {
    const doc = markdownParser.parse('**bold text**')
    expect(doc).toBeDefined()
    const paragraph = doc?.firstChild
    const text = paragraph?.firstChild
    expect(text?.marks.some(m => m.type.name === 'strong')).toBe(true)
  })

  it('should parse italic text', () => {
    const doc = markdownParser.parse('*italic text*')
    expect(doc).toBeDefined()
    const paragraph = doc?.firstChild
    const text = paragraph?.firstChild
    expect(text?.marks.some(m => m.type.name === 'em')).toBe(true)
  })

  it('should parse code blocks', () => {
    const doc = markdownParser.parse('```javascript\nconst x = 1;\n```')
    expect(doc).toBeDefined()
    const codeBlock = doc?.firstChild
    expect(codeBlock?.type.name).toBe('code_block')
    expect(codeBlock?.attrs.language).toBe('javascript')
  })

  it('should parse bullet lists', () => {
    const doc = markdownParser.parse('- Item 1\n- Item 2')
    expect(doc).toBeDefined()
    const list = doc?.firstChild
    expect(list?.type.name).toBe('bullet_list')
  })

  it('should parse ordered lists', () => {
    const doc = markdownParser.parse('1. Item 1\n2. Item 2')
    expect(doc).toBeDefined()
    const list = doc?.firstChild
    expect(list?.type.name).toBe('ordered_list')
  })

  it('should parse blockquotes', () => {
    const doc = markdownParser.parse('> Quote text')
    expect(doc).toBeDefined()
    const quote = doc?.firstChild
    expect(quote?.type.name).toBe('blockquote')
  })

  it('should parse links', () => {
    const doc = markdownParser.parse('[Link text](https://example.com)')
    expect(doc).toBeDefined()
    const paragraph = doc?.firstChild
    const text = paragraph?.firstChild
    const linkMark = text?.marks.find(m => m.type.name === 'link')
    expect(linkMark).toBeDefined()
    expect(linkMark?.attrs.href).toBe('https://example.com')
  })

  it('should parse inline code', () => {
    const doc = markdownParser.parse('Use `code` here')
    expect(doc).toBeDefined()
    const paragraph = doc?.firstChild
    // Find the code text
    let foundCode = false
    paragraph?.forEach(node => {
      if (node.marks.some(m => m.type.name === 'code')) {
        foundCode = true
        expect(node.text).toBe('code')
      }
    })
    expect(foundCode).toBe(true)
  })
})

describe('Markdown Serializer', () => {
  it('should serialize headings', () => {
    const doc = schema.nodes.doc.create(null, [
      schema.nodes.heading.create({ level: 1 }, schema.text('Heading 1')),
      schema.nodes.heading.create({ level: 2 }, schema.text('Heading 2'))
    ])
    const markdown = markdownSerializer.serialize(doc)
    expect(markdown).toContain('# Heading 1')
    expect(markdown).toContain('## Heading 2')
  })

  it('should serialize bold text', () => {
    const doc = schema.nodes.doc.create(null, [
      schema.nodes.paragraph.create(null, [
        schema.text('bold', [schema.marks.strong.create()])
      ])
    ])
    const markdown = markdownSerializer.serialize(doc)
    expect(markdown).toContain('**bold**')
  })

  it('should serialize italic text', () => {
    const doc = schema.nodes.doc.create(null, [
      schema.nodes.paragraph.create(null, [
        schema.text('italic', [schema.marks.em.create()])
      ])
    ])
    const markdown = markdownSerializer.serialize(doc)
    expect(markdown).toContain('*italic*')
  })

  it('should serialize code blocks', () => {
    const doc = schema.nodes.doc.create(null, [
      schema.nodes.code_block.create({ language: 'typescript' }, schema.text('const x = 1'))
    ])
    const markdown = markdownSerializer.serialize(doc)
    expect(markdown).toContain('```typescript')
    expect(markdown).toContain('const x = 1')
    expect(markdown).toContain('```')
  })

  it('should serialize bullet lists', () => {
    const doc = schema.nodes.doc.create(null, [
      schema.nodes.bullet_list.create(null, [
        schema.nodes.list_item.create(null, [
          schema.nodes.paragraph.create(null, schema.text('Item 1'))
        ]),
        schema.nodes.list_item.create(null, [
          schema.nodes.paragraph.create(null, schema.text('Item 2'))
        ])
      ])
    ])
    const markdown = markdownSerializer.serialize(doc)
    expect(markdown).toContain('- Item 1')
    expect(markdown).toContain('- Item 2')
  })

  it('should serialize blockquotes', () => {
    const doc = schema.nodes.doc.create(null, [
      schema.nodes.blockquote.create(null, [
        schema.nodes.paragraph.create(null, schema.text('Quote'))
      ])
    ])
    const markdown = markdownSerializer.serialize(doc)
    expect(markdown).toContain('> Quote')
  })
})
