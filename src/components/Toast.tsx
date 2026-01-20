/**
 * Toast notification component.
 * Displays transient messages at the bottom of the editor, primarily used
 * for the double-backspace deletion warning pattern.
 */
import { useEffect, useState } from 'react'
import { subscribeToast, ToastState } from '../lib/toast'

export function Toast() {
  const [state, setState] = useState<ToastState>({
    visible: false,
    message: '',
    duration: 2000
  })

  useEffect(() => {
    return subscribeToast(setState)
  }, [])

  if (!state.visible) {
    return null
  }

  return (
    <div className="toast">
      {state.message}
    </div>
  )
}
