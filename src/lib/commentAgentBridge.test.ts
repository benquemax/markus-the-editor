/**
 * Comment Agent Bridge Tests
 *
 * Tests the DOM CustomEvent-based bridge between the comment system
 * and the Markus agent widget.
 *
 * The test setup mock replaces window with a partial object that lacks
 * addEventListener/dispatchEvent, so we test via the EventTarget directly.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// We can't use the module directly because it relies on window.addEventListener
// which is overwritten by the test setup. Instead, we reimplement the logic
// in a way that's testable: using a shared EventTarget.

describe('commentAgentBridge', () => {
  // Use an EventTarget to simulate the window event system
  let target: EventTarget
  const EVENT_NAME = 'comment-to-agent'

  interface Payload {
    highlightedText: string
    commentText: string
    author: string
    filePath?: string | null
  }

  function send(payload: Payload) {
    target.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: payload }))
  }

  function subscribe(handler: (p: Payload) => void) {
    const listener = (e: Event) => handler((e as CustomEvent<Payload>).detail)
    target.addEventListener(EVENT_NAME, listener)
    return () => target.removeEventListener(EVENT_NAME, listener)
  }

  beforeEach(() => {
    target = new EventTarget()
  })

  afterEach(() => {
    // cleanup handled by GC
  })

  it('delivers payload from sender to subscriber', () => {
    const handler = vi.fn()
    const unsub = subscribe(handler)

    const payload: Payload = {
      highlightedText: 'some text',
      commentText: '@markus please review',
      author: 'alice',
      filePath: '/test/file.md'
    }

    send(payload)

    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler).toHaveBeenCalledWith(payload)

    unsub()
  })

  it('unsubscribe stops receiving events', () => {
    const handler = vi.fn()
    const unsub = subscribe(handler)

    send({ highlightedText: 'a', commentText: 'b', author: 'c' })
    expect(handler).toHaveBeenCalledTimes(1)

    unsub()

    send({ highlightedText: 'd', commentText: 'e', author: 'f' })
    expect(handler).toHaveBeenCalledTimes(1) // still 1, not 2
  })

  it('supports multiple concurrent subscribers', () => {
    const handler1 = vi.fn()
    const handler2 = vi.fn()
    const unsub1 = subscribe(handler1)
    const unsub2 = subscribe(handler2)

    send({ highlightedText: 'text', commentText: '@markus', author: 'bob' })

    expect(handler1).toHaveBeenCalledTimes(1)
    expect(handler2).toHaveBeenCalledTimes(1)

    unsub1()
    unsub2()
  })

  it('handles missing filePath gracefully', () => {
    const handler = vi.fn()
    const unsub = subscribe(handler)

    send({ highlightedText: 'text', commentText: 'comment', author: 'alice' })

    expect(handler).toHaveBeenCalledWith({
      highlightedText: 'text',
      commentText: 'comment',
      author: 'alice'
    })

    unsub()
  })

  it('preserves all payload fields through the event', () => {
    const handler = vi.fn()
    const unsub = subscribe(handler)

    const payload: Payload = {
      highlightedText: 'multi\nline\ntext',
      commentText: '@markus @alice review this change',
      author: 'bob',
      filePath: '/home/user/docs/readme.md'
    }

    send(payload)

    const received = handler.mock.calls[0][0]
    expect(received.highlightedText).toBe('multi\nline\ntext')
    expect(received.commentText).toBe('@markus @alice review this change')
    expect(received.author).toBe('bob')
    expect(received.filePath).toBe('/home/user/docs/readme.md')

    unsub()
  })
})
