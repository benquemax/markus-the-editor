/**
 * Agency API — Custom MCP Tool Server
 *
 * Creates an in-process MCP server that provides the custom tools
 * available to all Agency API agents. These tools wrap Markus's existing
 * fuzzy matching and task management systems.
 *
 * Tools:
 * - markus_edit: SEARCH/REPLACE with 4-tier anchor-based fuzzy matching
 * - markus_tasks: Task list CRUD for tracking work during conversations
 */

import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import { executeEdit } from './edit'
import { executeTasks } from './tasks'

/**
 * Creates the MCP tool server for the Agency API.
 * The returned config is passed to the SDK via mcpServers option.
 */
export function createAgencyToolServer(workspace: string, conversationId: string) {
  return createSdkMcpServer({
    name: 'agency-tools',
    version: '1.0.0',
    tools: [
      tool(
        'markus_edit',
        `Edit a file using SEARCH/REPLACE with anchor-based fuzzy matching.
Uses a 4-tier matching cascade (exact → whitespace-normalized → fuzzy → anchor)
that tolerates imprecise edits from small models. Returns match strategy and
confidence level. To create a new file, pass empty search text.`,
        {
          file: z.string().describe('File path relative to workspace'),
          search: z.string().describe('Text to search for (must be unique in file). Empty string creates a new file.'),
          replace: z.string().describe('Replacement text')
        },
        async (args) => {
          const result = await executeEdit({
            file: args.file,
            search: args.search,
            replace: args.replace,
            workspace
          })

          const text = result.success
            ? `Edit applied (${result.strategy} match, ${result.confidence} confidence${result.lineNumber ? `, line ${result.lineNumber}` : ''})`
            : `Edit failed: ${result.error}`

          return {
            content: [{ type: 'text' as const, text }],
            isError: !result.success
          }
        },
        { annotations: { title: 'Edit File', readOnlyHint: false, destructiveHint: false, openWorldHint: false } }
      ),

      tool(
        'markus_tasks',
        `Manage the task list for the current conversation. Actions:
- list: Show all tasks
- add: Create a new task (provide description)
- update: Change task status (provide taskId and status: pending/in_progress/done/blocked)
- complete: Mark a task as done (provide taskId)
- remove: Delete a task (provide taskId)`,
        {
          action: z.enum(['list', 'add', 'update', 'remove', 'complete']).describe('Task action to perform'),
          description: z.string().optional().describe('Task description (for add action)'),
          priority: z.number().optional().describe('Task priority 0-10 (for add action)'),
          taskId: z.string().optional().describe('Task ID (for update/remove/complete actions)'),
          status: z.enum(['pending', 'in_progress', 'done', 'blocked']).optional().describe('New status (for update action)')
        },
        async (args) => {
          const result = await executeTasks({
            action: args.action,
            workspaceId: workspace,
            conversationId,
            description: args.description,
            priority: args.priority,
            taskId: args.taskId,
            status: args.status
          })

          const text = result.success
            ? result.taskList || 'Task operation completed.'
            : `Task error: ${result.error}`

          return {
            content: [{ type: 'text' as const, text }],
            isError: !result.success
          }
        },
        { annotations: { title: 'Manage Tasks', readOnlyHint: false, destructiveHint: false, openWorldHint: false } }
      )
    ]
  })
}
