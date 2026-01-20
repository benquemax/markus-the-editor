/**
 * Toast notification state management.
 * Provides a singleton pattern for showing toast messages from ProseMirror plugins
 * and other non-React code. The Toast component subscribes to state changes.
 */

export interface ToastState {
  visible: boolean
  message: string
  duration: number
}

type ToastListener = (state: ToastState) => void

let currentState: ToastState = {
  visible: false,
  message: '',
  duration: 2000
}

const listeners: Set<ToastListener> = new Set()
let hideTimeout: ReturnType<typeof setTimeout> | null = null

/**
 * Subscribe to toast state changes.
 * Returns an unsubscribe function.
 */
export function subscribeToast(listener: ToastListener): () => void {
  listeners.add(listener)
  // Immediately notify with current state
  listener(currentState)
  return () => listeners.delete(listener)
}

/**
 * Get current toast state.
 */
export function getToastState(): ToastState {
  return currentState
}

function notifyListeners() {
  listeners.forEach(listener => listener(currentState))
}

/**
 * Show a toast notification.
 * The toast will auto-dismiss after the specified duration.
 */
export function showToast(message: string, duration = 2000): void {
  // Clear any existing timeout
  if (hideTimeout) {
    clearTimeout(hideTimeout)
    hideTimeout = null
  }

  currentState = {
    visible: true,
    message,
    duration
  }
  notifyListeners()

  // Auto-hide after duration
  hideTimeout = setTimeout(() => {
    hideToast()
  }, duration)
}

/**
 * Hide the current toast notification.
 */
export function hideToast(): void {
  if (hideTimeout) {
    clearTimeout(hideTimeout)
    hideTimeout = null
  }

  currentState = {
    ...currentState,
    visible: false
  }
  notifyListeners()
}
