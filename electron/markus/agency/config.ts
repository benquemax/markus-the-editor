/**
 * Agency API Configuration
 *
 * Manages model tier mapping, server routing, and SDK configuration
 * for the Agency API. Maps Claude Agent SDK model aliases (opus/sonnet/haiku)
 * to actual local model names and routes requests to the correct server
 * (GPU for small models, CPU for large models).
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

  /** Model tier assignments */
  models: {
    opus: ModelConfig
    sonnet: ModelConfig
    haiku: ModelConfig
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
 * Uses fast GPU models for haiku, CPU models for larger tiers.
 */
export function createDefaultConfig(): AgencyConfig {
  return {
    adapterPort: 3860,
    apiPort: 3861,

    models: {
      opus: {
        modelId: 'huihui_ai/devstral-abliterated:latest',
        serverUrl: 'http://ferocitee:11434',
        contextWindow: 131072,
        // devstral-abliterated on Ollama CPU — tool calling works correctly here.
        // vllama GPU lists this model but its tool call parser produces empty tool_calls[]
        // (finish_reason=tool_calls with no actual calls), so Ollama CPU is used instead.
        description: 'Devstral Abliterated on Ollama CPU — best reasoning, tool calling works'
      },
      sonnet: {
        modelId: 'qwen3-coder-next:latest',
        serverUrl: 'http://ferocitee:11434',
        contextWindow: 74880,
        description: 'Qwen3 Coder Next on Ollama CPU — good all-rounder'
      },
      haiku: {
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
 * Returns the tier config including auth headers and API key.
 */
export function resolveModelConfig(config: AgencyConfig, modelName: string): ModelConfig {
  for (const tier of Object.values(config.models)) {
    if (tier.modelId === modelName) {
      return tier
    }
  }
  // Fallback: use the sonnet tier for unknown models
  return config.models.sonnet
}

/**
 * Resolves which server URL to use for a given model name.
 * Checks the model against all configured tiers.
 */
export function resolveServerForModel(config: AgencyConfig, modelName: string): string {
  return resolveModelConfig(config, modelName).serverUrl
}

/**
 * Creates a Kimi cloud configuration for development/testing.
 * Uses Kimi K2.5 via cloud inference as the opus tier.
 */
export function createKimiCloudConfig(apiKey: string): AgencyConfig {
  return {
    adapterPort: 3860,
    apiPort: 3861,

    models: {
      opus: {
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
      sonnet: {
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
      haiku: {
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
 */
export function getSdkEnvVars(config: AgencyConfig): Record<string, string> {
  return {
    ANTHROPIC_BASE_URL: `http://localhost:${config.adapterPort}`,
    ANTHROPIC_API_KEY: 'agency-api-local',
    ANTHROPIC_DEFAULT_OPUS_MODEL: config.models.opus.modelId,
    ANTHROPIC_DEFAULT_SONNET_MODEL: config.models.sonnet.modelId,
    ANTHROPIC_DEFAULT_HAIKU_MODEL: config.models.haiku.modelId,
  }
}
