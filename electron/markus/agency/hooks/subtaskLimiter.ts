/**
 * Subtask Limiter Hook
 *
 * PreToolUse hook on the Task tool that limits the total number of
 * subagent invocations per conversation. Prevents runaway delegation
 * where an orchestrator spawns too many subtasks.
 *
 * In the Claude Agent SDK, subagents cannot spawn subagents, which
 * already limits depth. This hook limits breadth (total count).
 */

export interface SubtaskLimiterConfig {
  maxSpawns: number
}

/**
 * Creates the subtask limiter state and check function.
 * The returned function should be called from a PreToolUse hook
 * when the tool name is 'Task'.
 */
export function createSubtaskLimiter(config: SubtaskLimiterConfig = { maxSpawns: 8 }) {
  let spawnCount = 0

  /**
   * Checks if a new subtask can be spawned.
   * Returns null if allowed, or an error message if the limit is reached.
   */
  function checkLimit(): string | null {
    spawnCount++
    if (spawnCount > config.maxSpawns) {
      return `Subtask limit reached (${config.maxSpawns}). You must complete the remaining work yourself without delegating to more subagents. This limit exists to prevent runaway delegation.`
    }
    return null
  }

  /** Gets the current spawn count */
  function getCount(): number {
    return spawnCount
  }

  /** Resets the limiter (e.g. on new conversation) */
  function reset(): void {
    spawnCount = 0
  }

  return { checkLimit, getCount, reset }
}
