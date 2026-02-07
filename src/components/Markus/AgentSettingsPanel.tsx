/**
 * AgentSettingsPanel Component
 *
 * Configuration panel for per-agent model settings.
 * Allows users to assign different models to different agents.
 */

import { useState } from 'react'
import { ChevronDown, ChevronUp, Server, Cpu, Thermometer } from 'lucide-react'
import type {
  AgentType,
  AgentSettings,
  MultiAgentSettings,
  ModelPreset
} from '../../lib/markus/types'

interface AgentSettingsPanelProps {
  /** Current settings */
  settings: MultiAgentSettings
  /** Available model presets */
  presets: Record<string, ModelPreset>
  /** Callback when settings change */
  onChange: (settings: MultiAgentSettings) => void
}

/**
 * Agent type display info.
 */
const AGENT_INFO: Record<AgentType, { name: string; description: string; recommended: string }> = {
  orchestrator: {
    name: 'Orchestrator (Markus)',
    description: 'Coordinates tasks and routes to specialists',
    recommended: 'Larger model (Devstral 24B, GPT-4)'
  },
  editor: {
    name: 'Editor',
    description: 'File creation and modification',
    recommended: 'Small model (Ministral 8B)'
  },
  research: {
    name: 'Research',
    description: 'File search, RAG queries, web search',
    recommended: 'Small model (Ministral 8B)'
  },
  critique: {
    name: 'Critique',
    description: 'Quality review, consistency checking',
    recommended: 'Small model (Ministral 8B)'
  },
  style: {
    name: 'Style',
    description: 'Voice, tone, formatting consistency',
    recommended: 'Small model (Ministral 8B)'
  },
  creative: {
    name: 'Creative Director',
    description: 'Ideas, structure, creative solutions',
    recommended: 'Larger model (Devstral 24B, GPT-4)'
  }
}

/**
 * Settings row for a single agent.
 */
function AgentSettingsRow({
  type,
  settings,
  defaults,
  presets,
  onChange
}: {
  type: AgentType
  settings: Partial<AgentSettings> | undefined
  defaults: Partial<AgentSettings>
  presets: Record<string, ModelPreset>
  onChange: (settings: Partial<AgentSettings>) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const info = AGENT_INFO[type]

  // Get effective values (agent-specific or defaults)
  const effectiveModel = settings?.model || defaults.model || ''
  const effectiveEndpoint = settings?.endpoint || defaults.endpoint || ''
  const effectiveTemperature = settings?.temperature ?? defaults.temperature ?? 0.7

  // Check if using custom settings
  const isCustom = settings?.model || settings?.endpoint

  return (
    <div className="border border-border/50 rounded-lg overflow-hidden">
      {/* Header */}
      <button
        className="w-full flex items-center justify-between p-3 hover:bg-muted/30 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex flex-col items-start gap-0.5">
          <span className="text-sm font-medium">{info.name}</span>
          <span className="text-xs text-muted-foreground">{info.description}</span>
        </div>
        <div className="flex items-center gap-2">
          {isCustom && (
            <span className="text-xs px-1.5 py-0.5 bg-blue-500/20 text-blue-500 rounded">
              Custom
            </span>
          )}
          <span className="text-xs text-muted-foreground truncate max-w-[100px]">
            {effectiveModel || 'Default'}
          </span>
          {expanded ? (
            <ChevronUp className="w-4 h-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="w-4 h-4 text-muted-foreground" />
          )}
        </div>
      </button>

      {/* Expanded settings */}
      {expanded && (
        <div className="p-3 border-t border-border/50 bg-muted/20 space-y-3">
          {/* Model preset selector */}
          <div>
            <label className="block text-xs text-muted-foreground mb-1">
              Model Preset
            </label>
            <select
              className="w-full px-2 py-1.5 text-sm bg-background border border-border rounded"
              value={
                Object.entries(presets).find(
                  ([, p]) => p.model === effectiveModel && p.endpoint === effectiveEndpoint
                )?.[0] || 'custom'
              }
              onChange={(e) => {
                const preset = presets[e.target.value]
                if (preset) {
                  onChange({
                    model: preset.model,
                    endpoint: preset.endpoint
                  })
                }
              }}
            >
              <option value="default">Use Defaults</option>
              {Object.entries(presets).map(([key, preset]) => (
                <option key={key} value={key}>
                  {preset.name}
                </option>
              ))}
              <option value="custom">Custom</option>
            </select>
            <p className="text-xs text-muted-foreground mt-1">
              {info.recommended}
            </p>
          </div>

          {/* Model name */}
          <div>
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
              <Cpu className="w-3 h-3" />
              Model
            </label>
            <input
              type="text"
              className="w-full px-2 py-1.5 text-sm bg-background border border-border rounded"
              value={settings?.model || ''}
              placeholder={defaults.model || 'Use default'}
              onChange={(e) => onChange({ ...settings, model: e.target.value || undefined })}
            />
          </div>

          {/* Endpoint */}
          <div>
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
              <Server className="w-3 h-3" />
              Endpoint
            </label>
            <input
              type="text"
              className="w-full px-2 py-1.5 text-sm bg-background border border-border rounded"
              value={settings?.endpoint || ''}
              placeholder={defaults.endpoint || 'Use default'}
              onChange={(e) => onChange({ ...settings, endpoint: e.target.value || undefined })}
            />
          </div>

          {/* Temperature */}
          <div>
            <label className="flex items-center justify-between text-xs text-muted-foreground mb-1">
              <span className="flex items-center gap-1.5">
                <Thermometer className="w-3 h-3" />
                Temperature
              </span>
              <span>{effectiveTemperature.toFixed(1)}</span>
            </label>
            <input
              type="range"
              className="w-full"
              min="0"
              max="1"
              step="0.1"
              value={settings?.temperature ?? defaults.temperature ?? 0.7}
              onChange={(e) =>
                onChange({ ...settings, temperature: parseFloat(e.target.value) })
              }
            />
          </div>

          {/* Reset button */}
          {isCustom && (
            <button
              className="text-xs text-muted-foreground hover:text-foreground"
              onClick={() => onChange({})}
            >
              Reset to defaults
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export function AgentSettingsPanel({
  settings,
  presets,
  onChange
}: AgentSettingsPanelProps) {
  const agentTypes: AgentType[] = [
    'orchestrator',
    'editor',
    'research',
    'critique',
    'style',
    'creative'
  ]

  const handleAgentChange = (type: AgentType, agentSettings: Partial<AgentSettings>) => {
    onChange({
      ...settings,
      [type]: Object.keys(agentSettings).length > 0 ? agentSettings : undefined
    })
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold mb-1">Agent Models</h3>
        <p className="text-xs text-muted-foreground">
          Configure different models for each agent. Smaller models work well for
          specialized tasks, while larger models are better for coordination.
        </p>
      </div>

      <div className="space-y-2">
        {agentTypes.map((type) => (
          <AgentSettingsRow
            key={type}
            type={type}
            settings={settings[type]}
            defaults={settings.defaults}
            presets={presets}
            onChange={(s) => handleAgentChange(type, s)}
          />
        ))}
      </div>
    </div>
  )
}
