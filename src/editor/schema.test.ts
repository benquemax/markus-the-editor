import { describe, it, expect } from 'vitest'
import { schema } from './schema'

describe('ProseMirror Schema', () => {
  describe('Nodes', () => {
    it('should have doc node', () => {
      expect(schema.nodes.doc).toBeDefined()
    })

    it('should have paragraph node', () => {
      expect(schema.nodes.paragraph).toBeDefined()
    })

    it('should have heading node with level attribute', () => {
      expect(schema.nodes.heading).toBeDefined()
      const heading = schema.nodes.heading.create({ level: 2 })
      expect(heading.attrs.level).toBe(2)
    })

    it('should have blockquote node', () => {
      expect(schema.nodes.blockquote).toBeDefined()
    })

    it('should have code_block node with language attribute', () => {
      expect(schema.nodes.code_block).toBeDefined()
      const codeBlock = schema.nodes.code_block.create({ language: 'javascript' })
      expect(codeBlock.attrs.language).toBe('javascript')
    })

    it('should have horizontal_rule node', () => {
      expect(schema.nodes.horizontal_rule).toBeDefined()
    })

    it('should have bullet_list and ordered_list nodes', () => {
      expect(schema.nodes.bullet_list).toBeDefined()
      expect(schema.nodes.ordered_list).toBeDefined()
    })

    it('should have list_item node', () => {
      expect(schema.nodes.list_item).toBeDefined()
    })

    it('should have image node with src, alt, and title attributes', () => {
      expect(schema.nodes.image).toBeDefined()
      const image = schema.nodes.image.create({
        src: 'test.jpg',
        alt: 'Test',
        title: 'Test Title'
      })
      expect(image.attrs.src).toBe('test.jpg')
      expect(image.attrs.alt).toBe('Test')
      expect(image.attrs.title).toBe('Test Title')
    })

    it('should have hard_break node', () => {
      expect(schema.nodes.hard_break).toBeDefined()
    })

    it('should have text node', () => {
      expect(schema.nodes.text).toBeDefined()
    })
  })

  describe('Marks', () => {
    it('should have strong mark', () => {
      expect(schema.marks.strong).toBeDefined()
    })

    it('should have em mark', () => {
      expect(schema.marks.em).toBeDefined()
    })

    it('should have code mark', () => {
      expect(schema.marks.code).toBeDefined()
    })

    it('should have link mark with href and title attributes', () => {
      expect(schema.marks.link).toBeDefined()
      const link = schema.marks.link.create({ href: 'https://example.com', title: 'Example' })
      expect(link.attrs.href).toBe('https://example.com')
      expect(link.attrs.title).toBe('Example')
    })

    it('should have strikethrough mark', () => {
      expect(schema.marks.strikethrough).toBeDefined()
    })
  })
})
