/**
 * Tests for toast notification state management.
 * Tests the singleton pattern and state updates used for showing toast messages.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { showToast, hideToast, subscribeToast, getToastState } from './toast'

describe('Toast State Management', () => {
  beforeEach(() => {
    // Reset toast state between tests
    hideToast()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should start with hidden toast', () => {
    const state = getToastState()
    expect(state.visible).toBe(false)
    expect(state.message).toBe('')
  })

  it('should show toast with message', () => {
    showToast('Test message')
    const state = getToastState()
    expect(state.visible).toBe(true)
    expect(state.message).toBe('Test message')
  })

  it('should hide toast', () => {
    showToast('Test message')
    hideToast()
    const state = getToastState()
    expect(state.visible).toBe(false)
  })

  it('should auto-hide after duration', () => {
    showToast('Test message', 1000)
    expect(getToastState().visible).toBe(true)

    vi.advanceTimersByTime(1000)
    expect(getToastState().visible).toBe(false)
  })

  it('should notify subscribers on show', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeToast(listener)

    // Should be called immediately with current state
    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ visible: false }))

    showToast('Test message')
    expect(listener).toHaveBeenCalledTimes(2)
    expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({
      visible: true,
      message: 'Test message'
    }))

    unsubscribe()
  })

  it('should notify subscribers on hide', () => {
    showToast('Test message')

    const listener = vi.fn()
    const unsubscribe = subscribeToast(listener)

    hideToast()
    expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({
      visible: false
    }))

    unsubscribe()
  })

  it('should unsubscribe correctly', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeToast(listener)

    expect(listener).toHaveBeenCalledTimes(1) // Initial call

    unsubscribe()

    showToast('Test message')
    // Should not be called again after unsubscribe
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('should replace previous toast when showing new one', () => {
    showToast('First message', 5000)
    expect(getToastState().message).toBe('First message')

    showToast('Second message', 5000)
    expect(getToastState().message).toBe('Second message')
  })

  it('should reset auto-hide timer when showing new toast', () => {
    showToast('First message', 1000)

    vi.advanceTimersByTime(500)
    expect(getToastState().visible).toBe(true)

    showToast('Second message', 1000)

    // Original timer at 1000ms should not hide it
    vi.advanceTimersByTime(600)
    expect(getToastState().visible).toBe(true)
    expect(getToastState().message).toBe('Second message')

    // But new timer should hide it after full duration
    vi.advanceTimersByTime(400)
    expect(getToastState().visible).toBe(false)
  })

  it('should use default duration of 2000ms', () => {
    showToast('Test message')
    expect(getToastState().duration).toBe(2000)

    expect(getToastState().visible).toBe(true)
    vi.advanceTimersByTime(1999)
    expect(getToastState().visible).toBe(true)
    vi.advanceTimersByTime(1)
    expect(getToastState().visible).toBe(false)
  })
})
