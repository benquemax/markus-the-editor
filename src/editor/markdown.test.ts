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

  it('should parse tables', () => {
    const markdown = `| Header 1 | Header 2 |
| --- | --- |
| Cell 1 | Cell 2 |`
    const doc = markdownParser.parse(markdown)
    expect(doc).toBeDefined()
    const table = doc?.firstChild
    expect(table?.type.name).toBe('table')

    // Table should have rows (2 rows: header + data)
    expect(table?.childCount).toBe(2)

    // Check first row
    const firstRow = table?.firstChild
    expect(firstRow?.type.name).toBe('table_row')

    // Get header row's first cell
    expect(firstRow?.childCount).toBeGreaterThan(0)
    const firstCell = firstRow?.firstChild
    expect(firstCell?.type.name).toBe('table_header')
  })

  it('should parse tables with multiple rows', () => {
    const markdown = `| A | B | C |
| --- | --- | --- |
| 1 | 2 | 3 |
| 4 | 5 | 6 |
| 7 | 8 | 9 |`
    const doc = markdownParser.parse(markdown)
    expect(doc).toBeDefined()
    const table = doc?.firstChild
    expect(table?.type.name).toBe('table')
    // 4 rows: 1 header + 3 data rows
    expect(table?.childCount).toBe(4)

    // Verify each row has 3 cells
    table?.forEach((row) => {
      expect(row.childCount).toBe(3)
    })
  })

  it('should parse table cell content correctly', () => {
    const markdown = `| Name | Value |
| --- | --- |
| foo | 123 |`
    const doc = markdownParser.parse(markdown)
    const table = doc?.firstChild

    // Get the data row (second row)
    const dataRow = table?.child(1)
    expect(dataRow?.type.name).toBe('table_row')

    // First cell should contain "foo"
    const firstCell = dataRow?.firstChild
    expect(firstCell?.textContent).toBe('foo')

    // Second cell should contain "123"
    const secondCell = dataRow?.child(1)
    expect(secondCell?.textContent).toBe('123')
  })

  it('should parse table mixed with other content', () => {
    const markdown = `# Title

Some paragraph text.

| Col 1 | Col 2 |
| --- | --- |
| A | B |

More text after the table.`
    const doc = markdownParser.parse(markdown)
    expect(doc).toBeDefined()

    // Should have: heading, paragraph, table, paragraph
    expect(doc?.childCount).toBe(4)
    expect(doc?.child(0)?.type.name).toBe('heading')
    expect(doc?.child(1)?.type.name).toBe('paragraph')
    expect(doc?.child(2)?.type.name).toBe('table')
    expect(doc?.child(3)?.type.name).toBe('paragraph')
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

  it('should serialize tables', () => {
    const doc = schema.nodes.doc.create(null, [
      schema.nodes.table.create(null, [
        schema.nodes.table_row.create(null, [
          schema.nodes.table_header.create(null, [
            schema.nodes.paragraph.create(null, schema.text('Header 1'))
          ]),
          schema.nodes.table_header.create(null, [
            schema.nodes.paragraph.create(null, schema.text('Header 2'))
          ])
        ]),
        schema.nodes.table_row.create(null, [
          schema.nodes.table_cell.create(null, [
            schema.nodes.paragraph.create(null, schema.text('Cell 1'))
          ]),
          schema.nodes.table_cell.create(null, [
            schema.nodes.paragraph.create(null, schema.text('Cell 2'))
          ])
        ])
      ])
    ])
    const markdown = markdownSerializer.serialize(doc)
    expect(markdown).toContain('| Header 1')
    expect(markdown).toContain('| Header 2')
    expect(markdown).toContain('| Cell 1')
    expect(markdown).toContain('| Cell 2')
    // Should have separator row (with padding)
    expect(markdown).toContain('| ----')
  })

  it('should serialize tables with multiple rows', () => {
    const doc = schema.nodes.doc.create(null, [
      schema.nodes.table.create(null, [
        schema.nodes.table_row.create(null, [
          schema.nodes.table_header.create(null, [
            schema.nodes.paragraph.create(null, schema.text('A'))
          ]),
          schema.nodes.table_header.create(null, [
            schema.nodes.paragraph.create(null, schema.text('B'))
          ])
        ]),
        schema.nodes.table_row.create(null, [
          schema.nodes.table_cell.create(null, [
            schema.nodes.paragraph.create(null, schema.text('1'))
          ]),
          schema.nodes.table_cell.create(null, [
            schema.nodes.paragraph.create(null, schema.text('2'))
          ])
        ]),
        schema.nodes.table_row.create(null, [
          schema.nodes.table_cell.create(null, [
            schema.nodes.paragraph.create(null, schema.text('3'))
          ]),
          schema.nodes.table_cell.create(null, [
            schema.nodes.paragraph.create(null, schema.text('4'))
          ])
        ])
      ])
    ])
    const markdown = markdownSerializer.serialize(doc)

    // Check structure - should have 3 content rows + 1 separator
    const lines = markdown.trim().split('\n')
    expect(lines.length).toBe(4) // header, separator, row1, row2

    // Verify separator line
    expect(lines[1]).toMatch(/^\|[\s-]+\|[\s-]+\|$/)
  })

  it('should serialize empty cells', () => {
    const doc = schema.nodes.doc.create(null, [
      schema.nodes.table.create(null, [
        schema.nodes.table_row.create(null, [
          schema.nodes.table_header.create(null, [
            schema.nodes.paragraph.create()
          ]),
          schema.nodes.table_header.create(null, [
            schema.nodes.paragraph.create(null, schema.text('Header'))
          ])
        ]),
        schema.nodes.table_row.create(null, [
          schema.nodes.table_cell.create(null, [
            schema.nodes.paragraph.create(null, schema.text('Data'))
          ]),
          schema.nodes.table_cell.create(null, [
            schema.nodes.paragraph.create()
          ])
        ])
      ])
    ])
    const markdown = markdownSerializer.serialize(doc)
    // Should still have valid table structure with empty cells
    expect(markdown).toContain('|')
    expect(markdown).toContain('Header')
    expect(markdown).toContain('Data')
  })
})

describe('Image Parser', () => {
  it('should parse standard markdown images', () => {
    const doc = markdownParser.parse('![alt text](image.png)')
    expect(doc).toBeDefined()
    const paragraph = doc?.firstChild
    expect(paragraph?.type.name).toBe('paragraph')
    const image = paragraph?.firstChild
    expect(image?.type.name).toBe('image')
    expect(image?.attrs.src).toBe('image.png')
    expect(image?.attrs.alt).toBe('alt text')
  })

  it('should parse markdown images with title', () => {
    const doc = markdownParser.parse('![alt](image.png "title text")')
    expect(doc).toBeDefined()
    const paragraph = doc?.firstChild
    const image = paragraph?.firstChild
    expect(image?.attrs.src).toBe('image.png')
    expect(image?.attrs.title).toBe('title text')
  })

  it('should parse HTML img tags with align attribute', () => {
    const doc = markdownParser.parse('<img src="image.png" align="center" />')
    expect(doc).toBeDefined()
    const paragraph = doc?.firstChild
    const image = paragraph?.firstChild
    expect(image?.type.name).toBe('image')
    expect(image?.attrs.src).toBe('image.png')
    expect(image?.attrs.align).toBe('center')
  })

  it('should parse HTML img tags with width attribute', () => {
    const doc = markdownParser.parse('<img src="image.png" width="50%" />')
    expect(doc).toBeDefined()
    const paragraph = doc?.firstChild
    const image = paragraph?.firstChild
    expect(image?.type.name).toBe('image')
    expect(image?.attrs.width).toBe(50)
  })

  it('should parse HTML img tags with both align and width', () => {
    const doc = markdownParser.parse('<img src="image.png" alt="my image" align="left" width="75%" />')
    expect(doc).toBeDefined()
    const paragraph = doc?.firstChild
    const image = paragraph?.firstChild
    expect(image?.attrs.src).toBe('image.png')
    expect(image?.attrs.alt).toBe('my image')
    expect(image?.attrs.align).toBe('left')
    expect(image?.attrs.width).toBe(75)
  })

  it('should parse HTML img tags with data-align attribute', () => {
    const doc = markdownParser.parse('<img src="image.png" data-align="right" />')
    expect(doc).toBeDefined()
    const paragraph = doc?.firstChild
    const image = paragraph?.firstChild
    expect(image?.attrs.align).toBe('right')
  })
})

describe('Image Serializer', () => {
  it('should serialize standard images to markdown syntax', () => {
    const doc = schema.nodes.doc.create(null, [
      schema.nodes.paragraph.create(null, [
        schema.nodes.image.create({ src: 'image.png', alt: 'alt text' })
      ])
    ])
    const markdown = markdownSerializer.serialize(doc)
    expect(markdown).toContain('![alt text](image.png)')
  })

  it('should serialize images with title to markdown syntax', () => {
    const doc = schema.nodes.doc.create(null, [
      schema.nodes.paragraph.create(null, [
        schema.nodes.image.create({ src: 'image.png', alt: 'alt', title: 'my title' })
      ])
    ])
    const markdown = markdownSerializer.serialize(doc)
    expect(markdown).toContain('![alt](image.png "my title")')
  })

  it('should serialize images with align to HTML', () => {
    const doc = schema.nodes.doc.create(null, [
      schema.nodes.paragraph.create(null, [
        schema.nodes.image.create({ src: 'image.png', align: 'center' })
      ])
    ])
    const markdown = markdownSerializer.serialize(doc)
    expect(markdown).toContain('<img')
    expect(markdown).toContain('src="image.png"')
    expect(markdown).toContain('align="center"')
  })

  it('should serialize images with width to HTML', () => {
    const doc = schema.nodes.doc.create(null, [
      schema.nodes.paragraph.create(null, [
        schema.nodes.image.create({ src: 'image.png', width: 50 })
      ])
    ])
    const markdown = markdownSerializer.serialize(doc)
    expect(markdown).toContain('<img')
    expect(markdown).toContain('width="50%"')
  })

  it('should serialize images with both align and width to HTML', () => {
    const doc = schema.nodes.doc.create(null, [
      schema.nodes.paragraph.create(null, [
        schema.nodes.image.create({ src: 'image.png', alt: 'my image', align: 'left', width: 75 })
      ])
    ])
    const markdown = markdownSerializer.serialize(doc)
    expect(markdown).toContain('<img')
    expect(markdown).toContain('src="image.png"')
    expect(markdown).toContain('alt="my image"')
    expect(markdown).toContain('align="left"')
    expect(markdown).toContain('width="75%"')
  })

  it('should use markdown syntax for default align/width', () => {
    const doc = schema.nodes.doc.create(null, [
      schema.nodes.paragraph.create(null, [
        schema.nodes.image.create({ src: 'image.png', align: 'inline', width: 100 })
      ])
    ])
    const markdown = markdownSerializer.serialize(doc)
    expect(markdown).toContain('![](image.png)')
    expect(markdown).not.toContain('<img')
  })
})

describe('Image Round-trip Tests', () => {
  it('should preserve standard images through round-trip', () => {
    const original = '![alt text](folder/image.png)'
    const doc = markdownParser.parse(original)
    const serialized = markdownSerializer.serialize(doc!)
    expect(serialized.trim()).toBe(original)
  })

  it('should preserve HTML images with align through round-trip', () => {
    const original = '<img src="image.png" align="center" />'
    const doc = markdownParser.parse(original)
    const serialized = markdownSerializer.serialize(doc!)
    expect(serialized).toContain('src="image.png"')
    expect(serialized).toContain('align="center"')
  })

  it('should preserve HTML images with width through round-trip', () => {
    const original = '<img src="image.png" width="50%" />'
    const doc = markdownParser.parse(original)
    const serialized = markdownSerializer.serialize(doc!)
    expect(serialized).toContain('src="image.png"')
    expect(serialized).toContain('width="50%"')
  })

  it('should preserve images mixed with other content', () => {
    const original = `# Title

Some text.

<img src="photo.jpg" align="right" width="40%" />

More text after image.`

    const doc = markdownParser.parse(original)
    const serialized = markdownSerializer.serialize(doc!)

    expect(serialized).toContain('# Title')
    expect(serialized).toContain('Some text.')
    expect(serialized).toContain('src="photo.jpg"')
    expect(serialized).toContain('align="right"')
    expect(serialized).toContain('width="40%"')
    expect(serialized).toContain('More text after image.')
  })
})

describe('Table Round-trip Tests', () => {
  it('should preserve table structure through parse/serialize cycle', () => {
    const original = `| Name | Age |
| --- | --- |
| Alice | 30 |
| Bob | 25 |`

    const doc = markdownParser.parse(original)
    expect(doc).toBeDefined()

    const serialized = markdownSerializer.serialize(doc!)

    // Re-parse the serialized content
    const doc2 = markdownParser.parse(serialized)
    expect(doc2).toBeDefined()

    // Should have same structure
    expect(doc2?.firstChild?.type.name).toBe('table')
    expect(doc2?.firstChild?.childCount).toBe(3) // header + 2 data rows
  })

  it('should preserve cell content through round-trip', () => {
    const original = `| Column A | Column B |
| --- | --- |
| Value 1 | Value 2 |`

    const doc = markdownParser.parse(original)
    const serialized = markdownSerializer.serialize(doc!)
    const doc2 = markdownParser.parse(serialized)

    // Check that cell content is preserved
    const table = doc2?.firstChild
    const dataRow = table?.child(1)

    expect(dataRow?.firstChild?.textContent).toBe('Value 1')
    expect(dataRow?.child(1)?.textContent).toBe('Value 2')
  })

  it('should handle table with surrounding content through round-trip', () => {
    const original = `# Document Title

| Key | Value |
| --- | --- |
| foo | bar |

Some text after.`

    const doc = markdownParser.parse(original)
    const serialized = markdownSerializer.serialize(doc!)
    const doc2 = markdownParser.parse(serialized)

    // Verify structure is preserved
    expect(doc2?.child(0)?.type.name).toBe('heading')
    expect(doc2?.child(1)?.type.name).toBe('table')
    expect(doc2?.child(2)?.type.name).toBe('paragraph')
  })
})
