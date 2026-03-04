/**
 * Review Trigger Hook
 *
 * SubagentStop hook that nudges the orchestrator to review work quality
 * after editor/coder subagents complete. This reduces wasted user review
 * time by ensuring the orchestrator routes through critique/reviewer
 * before accepting results.
 */

/** Subagent names that should trigger a review suggestion */
const REVIEWABLE_AGENTS = new Set(['editor', 'coder'])

/**
 * Generates a review suggestion message after a subagent completes.
 * Returns null for subagents that don't need review (e.g. critique itself).
 */
export function getReviewSuggestion(agentName: string): string | null {
  if (!REVIEWABLE_AGENTS.has(agentName)) return null

  return `The ${agentName} has completed its work. Before proceeding, evaluate the quality of the changes. Consider delegating a review to the appropriate specialist (critique for writing, reviewer for code).`
}
