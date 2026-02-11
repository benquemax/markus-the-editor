/**
 * Layout mode hook for responsive horizontal/vertical switching.
 *
 * When the window aspect ratio is portrait (width < height), the app switches
 * from a column-based layout (side panels) to a row-based layout (top/bottom
 * panels). This happens automatically when users snap the editor to half-screen.
 */

import { useState, useEffect } from 'react'

export function useLayoutMode() {
  const [isVertical, setIsVertical] = useState(
    () => window.innerWidth < window.innerHeight
  )

  useEffect(() => {
    const handleResize = () => {
      setIsVertical(window.innerWidth < window.innerHeight)
    }

    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  return { isVertical }
}
