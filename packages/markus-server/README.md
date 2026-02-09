# Markus Server

Standalone Node.js server for the Markus AI writing assistant. Runs the thought loop, tool execution, and multi-agent orchestration over HTTP + WebSocket.

## Quick Start

```bash
npm run start        # Build core bundle and start server
# Server: http://localhost:3847
# WebSocket: ws://localhost:3847/ws?conversationId=<id>
```

## API

### HTTP Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check |
| POST | `/conversations` | Create conversation |
| GET | `/conversations` | List conversations |
| GET | `/conversations/:id` | Get conversation |
| DELETE | `/conversations/:id` | Delete conversation |
| POST | `/providers` | Create LLM provider |
| GET | `/providers` | List providers (keys masked) |
| GET | `/providers/:id` | Get provider (key masked) |
| PUT | `/providers/:id` | Update provider |
| DELETE | `/providers/:id` | Delete provider |
| GET | `/providers/:id/models` | Fetch models from upstream API (30s cache) |
| POST | `/agents` | Create agent definition |
| GET | `/agents` | List agent definitions |
| GET | `/agents/:id` | Get agent definition |
| PUT | `/agents/:id` | Update agent definition |
| DELETE | `/agents/:id` | Delete agent definition |
| GET | `/settings` | Get settings |

### WebSocket Protocol

Connect to `ws://localhost:3847/ws?conversationId=<id>`.

**Client messages:**
- `{ type: "message", content: "...", planningMode: bool, yoloMode: bool }` - Send message
- `{ type: "tool_response", toolCallId: "...", response: "..." }` - Respond to blocking tool
- `{ type: "cancel" }` - Cancel current request

**Server messages:**
- `{ type: "chunk", content: "..." }` - Streaming LLM text
- `{ type: "tool_started", toolCall: {...} }` - Tool execution started
- `{ type: "tool_complete", toolCallId: "...", result: {...} }` - Tool execution finished
- `{ type: "blocking", toolCallId: "...", uiData: {...} }` - Waiting for user input (ask_user, approval)
- `{ type: "tasks_updated", tasks: [...] }` - Task list changed
- `{ type: "complete", waitingForInput: bool }` - Thought loop finished
- `{ type: "error", message: "..." }` - Error occurred
- `{ type: "iteration_started", iterationIndex: number }` - New thought loop iteration

## Architecture

### Context Window Management

**Design constraint: all architectural choices must keep context usage within 64k tokens.**

Small local models (8B-24B parameters) with 64k context windows are the primary target. These models are slow, have limited reasoning ability, and degrade significantly as context grows. Even when the API endpoint is a cloud model with 128k+ context, keeping the window small improves response quality and reduces latency and cost.

#### Why Small Context Matters

Large context is not just a resource issue — it actively hurts small models:
- **Accuracy degrades**: Small models lose track of instructions and context buried in long prompts. The "lost in the middle" problem is severe with 8B models.
- **Speed degrades**: Inference time scales with context length. A 30k token context on a local GPU is noticeably slower than 10k.
- **Cost scales linearly**: For cloud APIs, input tokens are billed. Keeping context small across 10-30 iterations per conversation saves significant cost.
- **Repetition increases**: Models with large contexts tend to repeat themselves more, especially small models that can't track what they've already done.

#### Algorithmic Context Fabrication

The thought loop does NOT maintain a rolling conversation history. Each iteration's context is built algorithmically from structured data:

```
System prompt          ~2,100 tokens (fixed)
  - Rules & mode         ~580 tokens
  - Tool schema        ~1,400 tokens (13 tools)
  - Task list          ~120 tokens (varies)

User messages            ~50 tokens (all concatenated)
consult_boss messages   ~800 tokens (grows over conversation)
File cache            ~8,700 tokens (dominant, grows with files read)
Iteration summaries     ~300 tokens (sliding window of last 5)
Last tool results     ~2,100 tokens (replaced each iteration)
Continuation prompt      ~15 tokens (fixed)
```

**Measured peak: ~14,300 tokens (22% of 64k)** for an 11-iteration conversation that read 7 files and created a tutorial document.

#### What's Included Per Iteration

| Component | Scope | Growth |
|-----------|-------|--------|
| System prompt | Full (rules, tools, tasks, workspace paths) | Fixed ~2.1k tokens |
| User messages | All user messages concatenated | Slow (user inputs are short) |
| consult_boss history | All messages agent sent to user | Linear with conversation |
| File cache | Latest version of each file read | **Dominant** — grows with unique files |
| Iteration summaries | Last 5 iterations with tool names + args | Capped (sliding window) |
| Last iteration results | Full tool output from previous iteration only | Replaced each iteration |

#### Context Budget Projections

| Scenario | File cache | Total | % of 64k |
|----------|-----------|-------|----------|
| Simple task (7 files, ~5k chars avg) | ~8.7k tokens | ~14k | 22% |
| Medium task (15 files, ~6k chars avg) | ~22k tokens | ~28k | 43% |
| Heavy task (20 files at 10k truncation cap) | ~50k tokens | ~56k | 87% |

The file cache is the primary scaling concern. Current safeguards:
- `MAX_FILE_CHARS_EXECUTION = 10,000` — truncates large files in execution mode
- Files are deduplicated (only latest version per path kept)
- Iteration summaries are capped at 5 with compact format

#### Future Strategies (not yet implemented, keep in mind)

When file-heavy sessions push past 64k:
- **LRU file eviction** — drop cached files not referenced in recent iterations
- **Total file cache budget** — cap at e.g. 30k tokens, evict least-recently-used
- **Smarter truncation** — show only the sections of a file that were relevant (requires tracking which lines tools operated on)
- **Summary-based eviction** — replace full file content with an LLM-generated summary when evicting from cache

#### Rules for New Code

When modifying the context builder or adding features that affect what the LLM sees:

1. **Never include full conversation history.** The algorithmic approach exists for a reason — adding "just one more message" to context is how you blow the budget.
2. **Measure before committing.** Add `console.log` of `estimatedTokens` during development. If a change pushes typical conversations past 30k tokens, reconsider.
3. **Prefer structured data over prose.** "Iteration 5: read_file(/path/to/file.swift)" is 12 tokens. A full assistant message with reasoning is 200+.
4. **Cap all growing components.** Every list that grows over a conversation needs a cap or sliding window. The iteration summaries (capped at 5) are the model to follow.
5. **Test with 64k models.** If a feature works with Kimi (128k context) but fails with Devstral (64k), the feature needs redesign, not a bigger context window.

### Providers and Agent LLM Resolution

Providers are reusable LLM endpoint configurations stored in `~/.config/markus-the-editor/providers.json`. Agents can reference a provider instead of duplicating endpoint/apiKey fields.

**Resolution order** for an agent's endpoint/apiKey at runtime:
1. If `providerId` is set — resolve from that provider
2. If raw `endpoint` is set (no providerId) — use as-is (backward compat)
3. Neither — fall back to main LLM settings from `settings.yaml`

Resolution happens in `resolveAgentDefinition()` when a conversation is created.

#### Default Seeding

On first startup, the server seeds:
- **1 default provider** from the main LLM settings in `settings.yaml`
- **4 default agents**: Research Analyst, Editor, Critical Examiner, Creative Architect

Seeding only runs when the respective JSON file is empty. If you have agents/providers from a previous run, new defaults won't appear. To re-seed, delete the JSON files and restart:

```bash
rm ~/.config/markus-the-editor/agents.json
rm ~/.config/markus-the-editor/providers.json
# Restart server
```

### Thought Loop Robustness

The loop controller includes multiple safety mechanisms:

| Mechanism | Trigger | Action |
|-----------|---------|--------|
| Max iterations | 30 iterations reached | Stop loop |
| No-tool retries | 3 consecutive responses without tool calls | Stop loop |
| Text repetition | Same 500-char prefix seen twice | Stop loop |
| Tool spinning | Same tool signature 3 consecutive iterations | Stop loop |
| All-error detection | 3 consecutive iterations with all tools erroring | Stop loop |
| Unknown tool rejection | Tool not in definitions (orchestrator mode) | Immediate error, skip approval |
| Stream retry | ECONNRESET, timeout, network error | Retry up to 3x with exponential backoff |
| Graceful stream failure | Retries exhausted | Save progress, return error, don't crash |
| Approval timeout | Client doesn't respond to tool approval | Reject after 2 minutes |
| Auto mode switch | Write tool succeeds in planning mode | Switch to execution mode |

### Orchestrator / Sub-Agent Architecture

When API-defined agents are configured for a conversation, the thought loop becomes an orchestrator:

```
User  <->  Thought Loop (orchestrator)
             |
             +-- consult_boss          -> show message to user
             +-- update_tasks          -> manage task list
             +-- ask_user              -> pause for user input
             +-- request_task_approval -> submit work for review
             |
             +-- consult_reader_agent  -> sub-agent with read-only tools
             +-- consult_editor_agent  -> sub-agent with editor tools
             +-- consult_research_agent -> sub-agent with search tools
```

The orchestrator's context only contains user messages, its own reasoning, task list, and text summaries from sub-agents. It never sees file contents, tool call details, or sub-agent internals. Each sub-agent runs in an isolated context window.

When no agents are defined, the thought loop works with the full tool set (backward compatible).
