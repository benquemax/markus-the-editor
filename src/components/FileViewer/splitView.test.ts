/**
 * Split View Tests
 *
 * Tests the split view sync behavior between the ProseMirror WYSIWYG editor
 * and the Monaco code editor showing raw markdown source.
 *
 * Key behaviors tested:
 * - Debounced sync from code editor → ProseMirror (prevents churn)
 * - Focus guard: content updates skip when the editor has focus (prevents cursor jumps)
 * - Timer cleanup on save (flush pending sync)
 * - Tab content always up-to-date for save regardless of which editor was used
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

describe('Split view debounced sync', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('debounces setContent calls with 300ms delay', () => {
    const setContent = vi.fn()
    const updateTabContent = vi.fn()
    let timer: ReturnType<typeof setTimeout> | undefined

    // Simulate the handleSplitCodeChange handler from App.tsx
    function handleSplitCodeChange(newContent: string) {
      updateTabContent(newContent)
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        setContent(newContent)
      }, 300)
    }

    handleSplitCodeChange('a')
    handleSplitCodeChange('ab')
    handleSplitCodeChange('abc')

    // Tab content updated immediately on each call
    expect(updateTabContent).toHaveBeenCalledTimes(3)
    expect(updateTabContent).toHaveBeenLastCalledWith('abc')

    // ProseMirror setContent not called yet (still within debounce window)
    expect(setContent).not.toHaveBeenCalled()

    // After 300ms, only the latest content is pushed
    vi.advanceTimersByTime(300)
    expect(setContent).toHaveBeenCalledTimes(1)
    expect(setContent).toHaveBeenCalledWith('abc')
  })

  it('resets debounce timer on each new change', () => {
    const setContent = vi.fn()
    let timer: ReturnType<typeof setTimeout> | undefined

    function debouncedSync(content: string) {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => setContent(content), 300)
    }

    debouncedSync('first')
    vi.advanceTimersByTime(200) // 200ms in, not yet fired
    expect(setContent).not.toHaveBeenCalled()

    debouncedSync('second') // resets the timer
    vi.advanceTimersByTime(200) // 400ms total, but only 200ms since last change
    expect(setContent).not.toHaveBeenCalled()

    vi.advanceTimersByTime(100) // 500ms total, 300ms since last change
    expect(setContent).toHaveBeenCalledTimes(1)
    expect(setContent).toHaveBeenCalledWith('second')
  })

  it('flushes pending sync on save by clearing timer', () => {
    const setContent = vi.fn()
    let timer: ReturnType<typeof setTimeout> | undefined

    function debouncedSync(content: string) {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => setContent(content), 300)
    }

    function flushOnSave() {
      if (timer) {
        clearTimeout(timer)
        timer = undefined
      }
    }

    debouncedSync('edit in code editor')
    expect(setContent).not.toHaveBeenCalled()

    // Save clears the pending timer — prevents stale sync after save
    flushOnSave()
    vi.advanceTimersByTime(300)
    expect(setContent).not.toHaveBeenCalled() // timer was cleared
  })

  it('does not fire after cleanup', () => {
    const setContent = vi.fn()
    let timer: ReturnType<typeof setTimeout> | undefined

    function debouncedSync(content: string) {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => setContent(content), 300)
    }

    function cleanup() {
      if (timer) clearTimeout(timer)
    }

    debouncedSync('content')
    cleanup() // simulate unmount

    vi.advanceTimersByTime(500)
    expect(setContent).not.toHaveBeenCalled()
  })
})

describe('CodeEditor focus guard', () => {
  /**
   * Simulates the logic in CodeEditor's useEffect that determines
   * whether to update the editor content from an external source.
   * When the editor has focus, external updates are skipped to
   * prevent cursor jumps during bidirectional sync.
   */
  function shouldUpdateFromProp(
    hasFocus: boolean,
    currentValue: string,
    propContent: string
  ): boolean {
    if (hasFocus) return false
    return currentValue !== propContent
  }

  it('allows update when editor has no focus and content differs', () => {
    expect(shouldUpdateFromProp(false, 'old content', 'new content')).toBe(true)
  })

  it('skips update when editor has focus (prevents cursor jump)', () => {
    expect(shouldUpdateFromProp(true, 'old', 'new')).toBe(false)
  })

  it('skips update when content is the same', () => {
    expect(shouldUpdateFromProp(false, 'same', 'same')).toBe(false)
  })

  it('skips update when editor has focus even if content is the same', () => {
    expect(shouldUpdateFromProp(true, 'same', 'same')).toBe(false)
  })
})

describe('Split view content flow', () => {
  it('tab content is updated immediately from code editor (not debounced)', () => {
    const tabContents: string[] = []
    const setContent = vi.fn()

    vi.useFakeTimers()

    let timer: ReturnType<typeof setTimeout> | undefined
    function handleSplitCodeChange(newContent: string) {
      tabContents.push(newContent) // immediate
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => setContent(newContent), 300)
    }

    handleSplitCodeChange('H')
    handleSplitCodeChange('He')
    handleSplitCodeChange('Hel')
    handleSplitCodeChange('Hell')
    handleSplitCodeChange('Hello')

    // Every keystroke immediately updates tab content (important for save)
    expect(tabContents).toEqual(['H', 'He', 'Hel', 'Hell', 'Hello'])

    // But ProseMirror sync is debounced
    expect(setContent).not.toHaveBeenCalled()
    vi.advanceTimersByTime(300)
    expect(setContent).toHaveBeenCalledTimes(1)
    expect(setContent).toHaveBeenCalledWith('Hello')

    vi.useRealTimers()
  })

  it('ProseMirror-originated content flows to code editor via prop', () => {
    // Simulates: ProseMirror onChange → updateTabContent → content state
    // → CodeEditor receives new content prop → useEffect syncs
    const contentUpdates: string[] = []
    let currentContent = 'initial'

    function simulateProseMirrorChange(markdown: string) {
      currentContent = markdown
      contentUpdates.push(markdown)
    }

    // ProseMirror emits changes
    simulateProseMirrorChange('# Hello')
    simulateProseMirrorChange('# Hello World')

    // Content is available for CodeEditor's prop
    expect(currentContent).toBe('# Hello World')
    expect(contentUpdates).toHaveLength(2)
  })

  it('both editors can update tab content independently', () => {
    let tabContent = 'initial'

    function updateFromProseMirror(content: string) {
      tabContent = content
    }

    function updateFromCodeEditor(content: string) {
      tabContent = content
    }

    updateFromProseMirror('from prosemirror')
    expect(tabContent).toBe('from prosemirror')

    updateFromCodeEditor('from code editor')
    expect(tabContent).toBe('from code editor')

    updateFromProseMirror('back to prosemirror')
    expect(tabContent).toBe('back to prosemirror')
  })
})
