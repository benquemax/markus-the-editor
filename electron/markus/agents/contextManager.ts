/**
 * Agent Context Manager
 *
 * Manages the context window for each agent independently.
 * This is critical for small local models - each agent has a limited
 * context budget that must be carefully managed to prevent hallucinations.
 */

import {
  AgentType,
  AgentContext,
  AgentContextMessage,
  RelevantFile,
  AgentSettings
} from './types'

// ============================================================================
// Token Estimation
// ============================================================================

/**
 * Rough token estimation (4 chars per token on average).
 * For production, consider using a proper tokenizer like tiktoken.
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

// ============================================================================
// Context Budget Defaults
// ============================================================================

/**
 * Default context budgets per agent type.
 * These are conservative estimates for small models.
 */
const DEFAULT_CONTEXT_BUDGETS: Record<AgentType, number> = {
  orchestrator: 8192,   // Needs more context for coordination
  editor: 4096,         // Focused on specific file edits
  research: 6144,       // Needs room for search results
  critique: 6144,       // Needs to see content being reviewed
  style: 4096,          // Focused on specific passages
  creative: 6144        // Needs room for ideation
}

// System prompt token budgets for reference:
// orchestrator: 500, editor: 300, research: 400, critique: 400, style: 300, creative: 400

// ============================================================================
// Context Manager
// ============================================================================

/**
 * Manages context for all agents in the system.
 * Each agent has an isolated context window.
 */
export class AgentContextManager {
  private contexts = new Map<AgentType, AgentContext>()
  private workspaceFolders: string[] = []

  constructor(workspaceFolders: string[] = []) {
    this.workspaceFolders = workspaceFolders
  }

  /**
   * Update the workspace folders.
   */
  setWorkspaceFolders(folders: string[]): void {
    this.workspaceFolders = folders
    // Update all existing contexts
    for (const context of this.contexts.values()) {
      context.workspaceFolders = folders
    }
  }

  /**
   * Get or create a context for an agent.
   */
  getContext(agent: AgentType, settings?: Partial<AgentSettings>): AgentContext {
    let context = this.contexts.get(agent)

    if (!context) {
      const maxTokens = settings?.maxTokens || DEFAULT_CONTEXT_BUDGETS[agent]
      const systemPrompt = this.buildSystemPrompt(agent)

      context = {
        agent,
        maxContextTokens: maxTokens,
        currentTokens: estimateTokens(systemPrompt),
        systemPrompt,
        messages: [],
        tools: this.getAgentTools(agent),
        workspaceFolders: this.workspaceFolders,
        relevantFiles: []
      }

      this.contexts.set(agent, context)
    }

    return context
  }

  /**
   * Add a message to an agent's context.
   * Automatically manages context window size.
   */
  addMessage(agent: AgentType, message: Omit<AgentContextMessage, 'tokens'>): void {
    const context = this.getContext(agent)
    const tokens = estimateTokens(message.content)

    const fullMessage: AgentContextMessage = {
      ...message,
      tokens
    }

    // Check if we need to trim context
    const newTotal = context.currentTokens + tokens
    if (newTotal > context.maxContextTokens) {
      this.trimContext(agent, tokens)
    }

    context.messages.push(fullMessage)
    context.currentTokens += tokens
  }

  /**
   * Trim context to make room for new content.
   * Uses a sliding window approach, keeping recent messages.
   */
  private trimContext(agent: AgentType, neededTokens: number): void {
    const context = this.contexts.get(agent)
    if (!context) return

    const targetTokens = context.maxContextTokens - neededTokens
    const systemPromptTokens = estimateTokens(context.systemPrompt)

    // Keep removing oldest messages until we have room
    while (
      context.messages.length > 0 &&
      context.currentTokens > targetTokens
    ) {
      const removed = context.messages.shift()
      if (removed) {
        context.currentTokens -= removed.tokens
      }
    }

    // Ensure we never go below system prompt tokens
    context.currentTokens = Math.max(context.currentTokens, systemPromptTokens)
  }

  /**
   * Add relevant files to an agent's context.
   */
  addRelevantFiles(agent: AgentType, files: RelevantFile[]): void {
    const context = this.getContext(agent)

    for (const file of files) {
      // Check if file is already in context
      const existing = context.relevantFiles.find(f => f.path === file.path)
      if (existing) {
        // Update if new file has higher score
        if (file.score > existing.score) {
          const index = context.relevantFiles.indexOf(existing)
          context.relevantFiles[index] = file
        }
      } else {
        context.relevantFiles.push(file)
      }
    }

    // Sort by relevance score
    context.relevantFiles.sort((a, b) => b.score - a.score)

    // Limit to top N files to prevent context overflow
    const MAX_RELEVANT_FILES = 5
    if (context.relevantFiles.length > MAX_RELEVANT_FILES) {
      context.relevantFiles = context.relevantFiles.slice(0, MAX_RELEVANT_FILES)
    }
  }

  /**
   * Clear relevant files for an agent.
   */
  clearRelevantFiles(agent: AgentType): void {
    const context = this.contexts.get(agent)
    if (context) {
      context.relevantFiles = []
    }
  }

  /**
   * Reset an agent's context (clear messages, keep system prompt).
   */
  resetContext(agent: AgentType): void {
    const context = this.contexts.get(agent)
    if (context) {
      context.messages = []
      context.relevantFiles = []
      context.currentTokens = estimateTokens(context.systemPrompt)
    }
  }

  /**
   * Reset all agent contexts.
   */
  resetAllContexts(): void {
    for (const agent of this.contexts.keys()) {
      this.resetContext(agent)
    }
  }

  /**
   * Get the messages formatted for LLM API.
   */
  getMessagesForLLM(
    agent: AgentType
  ): Array<{ role: 'user' | 'assistant' | 'system'; content: string }> {
    const context = this.getContext(agent)

    const messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }> = [
      { role: 'system', content: context.systemPrompt }
    ]

    // Add relevant file context if available
    if (context.relevantFiles.length > 0) {
      const fileContext = this.formatRelevantFiles(context.relevantFiles)
      messages.push({
        role: 'system',
        content: `Relevant files:\n${fileContext}`
      })
    }

    // Add conversation messages
    for (const msg of context.messages) {
      messages.push({
        role: msg.role,
        content: msg.content
      })
    }

    return messages
  }

  /**
   * Format relevant files for inclusion in context.
   */
  private formatRelevantFiles(files: RelevantFile[]): string {
    return files.map(file => {
      let content = `## ${file.path}\nReason: ${file.reason}\n`
      if (file.snippets && file.snippets.length > 0) {
        for (const snippet of file.snippets) {
          if (snippet.headingContext) {
            content += `### ${snippet.headingContext}\n`
          }
          content += `Lines ${snippet.startLine}-${snippet.endLine}:\n\`\`\`\n${snippet.content}\n\`\`\`\n`
        }
      }
      return content
    }).join('\n')
  }

  /**
   * Get available tools for an agent type.
   */
  private getAgentTools(agent: AgentType): string[] {
    switch (agent) {
      case 'orchestrator':
        return ['delegate_task', 'get_status', 'approve_edit']
      case 'editor':
        return ['read_file', 'edit_file', 'create_file']
      case 'research':
        return ['vector_search', 'read_file', 'list_directory', 'search_files', 'search_web']
      case 'critique':
        return ['read_file', 'list_directory']
      case 'style':
        return ['read_file']
      case 'creative':
        return ['read_file', 'list_directory', 'search_files']
      default:
        return []
    }
  }

  /**
   * Build the system prompt for an agent.
   * These are compact prompts optimized for small models.
   */
  private buildSystemPrompt(agent: AgentType): string {
    switch (agent) {
      case 'orchestrator':
        return this.buildOrchestratorPrompt()
      case 'editor':
        return this.buildEditorPrompt()
      case 'research':
        return this.buildResearchPrompt()
      case 'critique':
        return this.buildCritiquePrompt()
      case 'style':
        return this.buildStylePrompt()
      case 'creative':
        return this.buildCreativePrompt()
      default:
        return 'You are a helpful assistant.'
    }
  }

  private buildOrchestratorPrompt(): string {
    return `You are Markus, coordinator for a markdown editor.
ROLE: Route tasks to specialists. DO NOT write content yourself.
SPECIALISTS:
- RESEARCH: Find information from files and web
- EDITOR: Modify files using SEARCH/REPLACE
- CRITIQUE: Review content quality
- STYLE: Check voice and formatting
- CREATIVE: Generate ideas and structure

FORMAT for delegating:
<agent_request agent="name">
task description with specific instructions
</agent_request>

RULES:
1. Decompose complex tasks into subtasks
2. Wait for results before continuing
3. Summarize results for the user
4. Never write markdown content directly
5. Encourage specialists to use mermaid diagrams when visualizing concepts, flows, or architecture`
  }

  private buildEditorPrompt(): string {
    return `You modify markdown files using SEARCH/REPLACE blocks.

FORMAT:
<edit>
<file>path/to/file.md</file>
<search>
exact text to find with surrounding context
</search>
<replace>
new text to insert
</replace>
</edit>

RULES:
1. Search text must exist in the file
2. Include enough context to make search unique
3. Preserve indentation and formatting
4. One edit per block, multiple blocks allowed
5. For new files, use empty <search></search>
6. Use mermaid code blocks for diagrams, flowcharts, and visual explanations when suitable`
  }

  private buildResearchPrompt(): string {
    return `You find information from files and web.

TOOLS:
- vector_search(query): Semantic search across files
- read_file(path): Read file contents
- list_directory(path): List directory contents
- search_files(query, path, pattern): Text search in files
- search_web(query): Web search

FORMAT for results:
<findings>
<source>file path or URL</source>
<summary>key information found</summary>
</findings>

RULES:
1. Search before reading full files
2. Return only relevant snippets
3. Cite sources for all findings`
  }

  private buildCritiquePrompt(): string {
    return `You review content for quality and consistency.

CHECKLIST:
- Factual accuracy
- Logical flow
- Completeness
- Clarity
- Contradictions

FORMAT:
<review>
<issue severity="high|medium|low">
Description of issue
</issue>
<suggestion>
How to fix it
</suggestion>
</review>

RULES:
1. Be specific about locations
2. Prioritize by severity
3. Suggest concrete fixes`
  }

  private buildStylePrompt(): string {
    return `You check voice, tone, and formatting.

CHECKLIST:
- Consistent voice
- Appropriate tone
- Heading hierarchy
- List formatting
- Link validity

FORMAT:
<style_issue>
<location>where in document</location>
<issue>what's wrong</issue>
<fix>suggested correction</fix>
</style_issue>

RULES:
1. Match existing document style
2. Flag inconsistencies
3. Preserve author's voice`
  }

  private buildCreativePrompt(): string {
    return `You generate ideas and document structure.

CAPABILITIES:
- Brainstorm topics
- Outline documents
- Suggest improvements
- Find connections
- Expand on ideas
- Create mermaid diagrams for visual concepts

FORMAT:
<idea>
<title>Brief title</title>
<description>Detailed explanation</description>
<rationale>Why this works</rationale>
</idea>

RULES:
1. Generate multiple options
2. Consider context
3. Be specific, not generic
4. Use mermaid code blocks for flowcharts, architecture diagrams, state machines, and other visual explanations`
  }
}

/**
 * Global context manager instance.
 */
export const agentContextManager = new AgentContextManager()
