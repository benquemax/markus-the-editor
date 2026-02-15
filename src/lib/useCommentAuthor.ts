/**
 * useCommentAuthor Hook
 *
 * Resolves the comment author name using this priority:
 * 1. User-configured nickname (from electron-store)
 * 2. Git user.name
 * 3. OS username (fallback to 'Anonymous')
 *
 * Also provides a setter to persist a custom nickname.
 */

import { useState, useEffect, useCallback } from 'react'

const STORE_KEY = 'commentNickname'

export function useCommentAuthor() {
  const [author, setAuthor] = useState('Anonymous')

  useEffect(() => {
    async function resolve() {
      // 1. Check for saved nickname
      const saved = await window.electron.store.get(STORE_KEY)
      if (typeof saved === 'string' && saved.trim()) {
        setAuthor(saved.trim())
        return
      }

      // 2. Try git user.name
      try {
        const gitName = await window.electron.git.getConfig('user.name')
        if (gitName) {
          setAuthor(gitName)
          return
        }
      } catch {
        // Fall through
      }

      // 3. Fallback stays as 'Anonymous'
    }

    resolve()
  }, [])

  const setNickname = useCallback(async (name: string) => {
    const trimmed = name.trim()
    setAuthor(trimmed || 'Anonymous')
    await window.electron.store.set(STORE_KEY, trimmed)
  }, [])

  return { author, setNickname }
}
