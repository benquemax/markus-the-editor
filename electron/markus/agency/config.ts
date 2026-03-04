/**
 * Agency API Configuration
 *
 * Manages model role assignments, server routing, and SDK configuration
 * for the Agency API. Each role maps to an actual local model and server.
 *
 * Role naming reflects function in the agent hierarchy:
 * - orchestrator: plans tasks and delegates to subagents (SDK 'opus' alias)
 * - analyst: researches, reviews, and reasons about complex problems (SDK 'sonnet' alias)
 * - worker: executes focused tasks quickly — edits, tests, simple reasoning (SDK 'haiku' alias)
 *
 * The SDK's ANTHROPIC_DEFAULT_*_MODEL env vars are set from these roles via getSdkEnvVars().
 */

export interface ModelConfig {
  /** Model name as the LLM server knows it */
  modelId: string
  /** Base URL of the server hosting this model */
  serverUrl: string
  /** Context window size in tokens */
  contextWindow: number
  /** Human-readable description */
  description: string
  /** API key for authenticated endpoints (cloud providers) */
  apiKey?: string
  /** Extra headers required by the provider (e.g. Kimi's client gating) */
  customHeaders?: Record<string, string>
}

export interface AgencyConfig {
  /** Port for the format adapter proxy */
  adapterPort: number
  /** Port for the Agency API server */
  apiPort: number

  /** Model role assignments */
  models: {
    /** Plans and delegates — maps to SDK 'opus' alias */
    orchestrator: ModelConfig
    /** Researches and reviews — maps to SDK 'sonnet' alias */
    analyst: ModelConfig
    /** Executes focused tasks — maps to SDK 'haiku' alias */
    worker: ModelConfig
  }

  /** Embedding model for RAG */
  embeddingModel?: {
    modelId: string
    serverUrl: string
  }

  /** Agent limits */
  limits: {
    maxSubagentSpawns: number
    maxTurnsOrchestrator: number
    maxTurnsSubagent: number
    loopDetectionWindow: number
    maxTasksPerConversation: number
  }
}

/**
 * Default configuration for development.
 * All three models run on Ollama CPU (ferocitee:11434) — vllama GPU
 * has tool-calling bugs that make it unsuitable for the agency.
 */
export function createDefaultConfig(): AgencyConfig {
  return {
    adapterPort: 3860,
    apiPort: 3861,

    models: {
      orchestrator: {
        modelId: 'huihui_ai/devstral-abliterated:latest',
        serverUrl: 'http://ferocitee:11434',
        contextWindow: 131072,
        // devstral-abliterated on Ollama CPU — tool calling works correctly here.
        // vllama GPU lists this model but its tool call parser produces empty tool_calls[]
        // (finish_reason=tool_calls with no actual calls), so Ollama CPU is used instead.
        description: 'Devstral Abliterated on Ollama CPU — best reasoning, tool calling works'
      },
      analyst: {
        modelId: 'qwen3-coder-next:latest',
        serverUrl: 'http://ferocitee:11434',
        contextWindow: 74880,
        description: 'Qwen3 Coder Next on Ollama CPU — good all-rounder'
      },
      worker: {
        modelId: 'ministral-3:14b',
        // vllama GPU server lists ministral but hangs on inference; using Ollama CPU works fine
        serverUrl: 'http://ferocitee:11434',
        contextWindow: 59416,
        description: 'Ministral 14B on Ollama CPU — fast inference'
      }
    },

    embeddingModel: {
      modelId: 'nomic-embed-text:latest',
      serverUrl: 'http://ferocitee:11434'
    },

    limits: {
      maxSubagentSpawns: 8,
      maxTurnsOrchestrator: 30,
      maxTurnsSubagent: 15,
      loopDetectionWindow: 6,
      maxTasksPerConversation: 20
    }
  }
}

/**
 * Resolves the full ModelConfig for a given model name.
 * Returns the role config including auth headers and API key.
 */
export function resolveModelConfig(config: AgencyConfig, modelName: string): ModelConfig {
  for (const role of Object.values(config.models)) {
    if (role.modelId === modelName) {
      return role
    }
  }
  // Fallback: use the analyst role for unknown models
  return config.models.analyst
}

/**
 * Resolves which server URL to use for a given model name.
 * Checks the model against all configured roles.
 */
export function resolveServerForModel(config: AgencyConfig, modelName: string): string {
  return resolveModelConfig(config, modelName).serverUrl
}

/**
 * Creates a Kimi cloud configuration for development/testing.
 * Uses Kimi K2.5 via cloud inference as the orchestrator tier.
 */
export function createKimiCloudConfig(apiKey: string): AgencyConfig {
  return {
    adapterPort: 3860,
    apiPort: 3861,

    models: {
      orchestrator: {
        modelId: 'kimi-for-coding',
        serverUrl: 'https://api.kimi.com/coding/v1',
        contextWindow: 131072,
        description: 'Kimi K2.5 cloud inference — strongest reasoning',
        apiKey,
        customHeaders: {
          'X-Traffic-Source': 'self',
          'User-Agent': 'KimiCLI/1.3'
        }
      },
      analyst: {
        modelId: 'kimi-for-coding',
        serverUrl: 'https://api.kimi.com/coding/v1',
        contextWindow: 131072,
        description: 'Kimi K2.5 cloud inference — all tiers during testing',
        apiKey,
        customHeaders: {
          'X-Traffic-Source': 'self',
          'User-Agent': 'KimiCLI/1.3'
        }
      },
      worker: {
        modelId: 'kimi-for-coding',
        serverUrl: 'https://api.kimi.com/coding/v1',
        contextWindow: 131072,
        description: 'Kimi K2.5 cloud inference — all tiers during testing',
        apiKey,
        customHeaders: {
          'X-Traffic-Source': 'self',
          'User-Agent': 'KimiCLI/1.3'
        }
      }
    },

    embeddingModel: {
      modelId: 'nomic-embed-text:latest',
      serverUrl: 'http://ferocitee:11434'
    },

    limits: {
      maxSubagentSpawns: 8,
      maxTurnsOrchestrator: 30,
      maxTurnsSubagent: 15,
      loopDetectionWindow: 6,
      maxTasksPerConversation: 20
    }
  }
}

/**
 * Gets the SDK environment variables needed to configure model aliases.
 * Maps our role names to the SDK's fixed alias names (opus/sonnet/haiku).
 */
export function getSdkEnvVars(config: AgencyConfig): Record<string, string> {
  return {
    ANTHROPIC_BASE_URL: `http://localhost:${config.adapterPort}`,
    ANTHROPIC_API_KEY: 'agency-api-local',
    ANTHROPIC_DEFAULT_OPUS_MODEL: config.models.orchestrator.modelId,
    ANTHROPIC_DEFAULT_SONNET_MODEL: config.models.analyst.modelId,
    ANTHROPIC_DEFAULT_HAIKU_MODEL: config.models.worker.modelId,
  }
}
