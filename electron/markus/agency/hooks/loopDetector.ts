/**
 * Loop Detector Hook
 *
 * PostToolUse hook that detects repetitive tool call patterns from local
 * models. When the same tool call is repeated 3+ times, or a circular
 * pattern is detected (A→B→A→B), injects a warning into the system
 * context to break the loop.
 *
 * Critical for small local models that tend to get stuck in repetitive
 * cycles when they can't make progress on a task.
 */

import { createHash } from 'crypto'

export interface LoopDetectorConfig {
  /** Number of recent tool calls to track */
  windowSize: number
  /** Number of repetitions before injecting a warning */
  repeatThreshold: number
}

interface ToolCallRecord {
  hash: string
  toolName: string
  timestamp: number
}

/**
 * Creates the loop detector state and hook callback.
 * The returned callback is used as a PostToolUse hook in the SDK.
 */
export function createLoopDetector(config: LoopDetectorConfig = { windowSize: 6, repeatThreshold: 3 }) {
  const recentCalls: ToolCallRecord[] = []

  function hashToolCall(toolName: string, input: unknown): string {
    const raw = `${toolName}:${JSON.stringify(input)}`
    return createHash('md5').update(raw).digest('hex').slice(0, 12)
  }

  /**
   * Records a tool call and checks for repetitive patterns.
   * Returns a warning message if a loop is detected, null otherwise.
   */
  function checkForLoop(toolName: string, input: unknown): string | null {
    const hash = hashToolCall(toolName, input)
    recentCalls.push({ hash, toolName, timestamp: Date.now() })

    // Keep window bounded
    while (recentCalls.length > config.windowSize) {
      recentCalls.shift()
    }

    if (recentCalls.length < 3) return null

    // Check for exact repetition (same call N times)
    const lastHash = hash
    let repeatCount = 0
    for (let i = recentCalls.length - 1; i >= 0; i--) {
      if (recentCalls[i].hash === lastHash) repeatCount++
      else break
    }

    if (repeatCount >= config.repeatThreshold) {
      return `STOP: You have called ${toolName} with the same arguments ${repeatCount} times. This is a loop. Try a completely different approach or ask for help.`
    }

    // Check for circular pattern (A→B→A→B)
    if (recentCalls.length >= 4) {
      const hashes = recentCalls.slice(-4).map(r => r.hash)
      if (hashes[0] === hashes[2] && hashes[1] === hashes[3] && hashes[0] !== hashes[1]) {
        return `STOP: You are in a circular pattern (${recentCalls[recentCalls.length - 2].toolName} ↔ ${toolName}). Break out of this loop by trying a different strategy.`
      }
    }

    return null
  }

  /** Resets the loop detector state (e.g. on new conversation) */
  function reset(): void {
    recentCalls.length = 0
  }

  return { checkForLoop, reset }
}
