/**
 * SettingsPanel Component
 *
 * Unified settings panel with three sections:
 * 1. Main Settings — primary LLM configuration from settings.yaml
 * 2. Providers — CRUD for LLM provider configurations with model discovery
 * 3. Agents — CRUD for agent definitions with provider/model dropdowns
 *
 * Exported as AgentDefinitionsPanel for backward compatibility with MarkusPanel.
 */

import { useState, useEffect, useCallback } from 'react'
import {
  ArrowLeft,
  Plus,
  Pencil,
  Trash2,
  Save,
  Bot,
  Loader2,
  X,
  ChevronDown,
  ChevronRight,
  Server,
  Settings,
  Zap,
  CheckCircle,
  AlertCircle
} from 'lucide-react'
import { cn } from '../../lib/utils'
import type {
  MarkusClient,
  AgentDefinition,
  CreateAgentDefinitionOptions,
  UpdateAgentDefinitionOptions,
  Provider,
  ModelInfo,
  MarkusSettings
} from '../../lib/markus/client'

// ============================================================================
// Types
// ============================================================================

interface SettingsPanelProps {
  client: MarkusClient
  onClose: () => void
  onAgentsChanged: () => void
}

/** LLM source for an agent: inherit main settings, use a provider, or custom endpoint */
type LlmSource = 'main' | 'custom' | string // string = provider ID

interface AgentFormData {
  slug: string
  name: string
  description: string
  roleDefinition: string
  whenToUse: string
  customInstructions: string
  llmSource: LlmSource
  model: string
  endpoint: string
  apiKey: string
  maxTokens: number
  temperature: number
  tools: string[]
}

interface ProviderFormData {
  name: string
  endpoint: string
  apiKey: string
  defaultModel: string
}

const EMPTY_AGENT_FORM: AgentFormData = {
  slug: '',
  name: '',
  description: '',
  roleDefinition: '',
  whenToUse: '',
  customInstructions: '',
  llmSource: 'main',
  model: '',
  endpoint: '',
  apiKey: '',
  maxTokens: 4096,
  temperature: 0.7,
  tools: [],
}

const EMPTY_PROVIDER_FORM: ProviderFormData = {
  name: '',
  endpoint: '',
  apiKey: '',
  defaultModel: '',
}

// ============================================================================
// Main Component (exported as AgentDefinitionsPanel for compat)
// ============================================================================

export function AgentDefinitionsPanel({
  client,
  onClose,
  onAgentsChanged
}: SettingsPanelProps) {
  // Data
  const [settings, setSettings] = useState<MarkusSettings | null>(null)
  const [providers, setProviders] = useState<Provider[]>([])
  const [agents, setAgents] = useState<AgentDefinition[]>([])
  const [toolPresets, setToolPresets] = useState<Record<string, string[]>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Sub-view navigation: null = main list, otherwise editing something
  const [editView, setEditView] = useState<
    | null
    | { type: 'agent'; id: string | 'new' }
    | { type: 'provider'; id: string | 'new' }
    | { type: 'main-settings' }
  >(null)

  // Agent form state
  const [agentForm, setAgentForm] = useState<AgentFormData>(EMPTY_AGENT_FORM)
  const [saving, setSaving] = useState(false)

  // Provider form state
  const [providerForm, setProviderForm] = useState<ProviderFormData>(EMPTY_PROVIDER_FORM)

  // Model discovery cache keyed by provider ID
  const [modelsByProvider, setModelsByProvider] = useState<Record<string, ModelInfo[]>>({})
  const [modelsLoading, setModelsLoading] = useState<string | null>(null)
  const [modelsError, setModelsError] = useState<string | null>(null)

  // Main settings form
  const [mainSettingsForm, setMainSettingsForm] = useState<{
    apiEndpoint: string
    apiKey: string
    model: string
  }>({ apiEndpoint: '', apiKey: '', model: '' })

  // Collapsible sections
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    new Set(['identity', 'llm', 'tools', 'main-settings', 'providers', 'agents'])
  )

  // ========================================================================
  // Data Loading
  // ========================================================================

  const loadAll = useCallback(async () => {
    try {
      const [settingsData, providerList, agentList, presets] = await Promise.all([
        client.getSettings(),
        client.listProviders(),
        client.listAgentDefinitions(),
        client.getToolPresets().catch(() => ({ presets: {}, default: [] as string[] }))
      ])
      setSettings(settingsData)
      setProviders(providerList)
      setAgents(agentList)
      setToolPresets(presets.presets)
      setMainSettingsForm({
        apiEndpoint: settingsData.llm.apiEndpoint,
        apiKey: settingsData.llm.apiKey,
        model: settingsData.llm.model,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load settings')
    } finally {
      setLoading(false)
    }
  }, [client])

  useEffect(() => { loadAll() }, [loadAll])

  // ========================================================================
  // Model Discovery
  // ========================================================================

  const fetchModels = useCallback(async (providerId: string) => {
    // Already cached
    if (modelsByProvider[providerId]) return

    setModelsLoading(providerId)
    setModelsError(null)
    try {
      const models = await client.listProviderModels(providerId)
      setModelsByProvider(prev => ({ ...prev, [providerId]: models }))
    } catch (err) {
      setModelsError(err instanceof Error ? err.message : 'Failed to fetch models')
    } finally {
      setModelsLoading(null)
    }
  }, [client, modelsByProvider])

  // ========================================================================
  // Agent Handlers
  // ========================================================================

  const handleEditAgent = useCallback((agent: AgentDefinition) => {
    // Determine LLM source from the stored agent data
    let llmSource: LlmSource = 'main'
    if (agent.providerId) {
      llmSource = agent.providerId
    } else if (agent.endpoint) {
      llmSource = 'custom'
    }

    setAgentForm({
      slug: agent.slug,
      name: agent.name,
      description: agent.description,
      roleDefinition: agent.roleDefinition,
      whenToUse: agent.whenToUse,
      customInstructions: agent.customInstructions || '',
      llmSource,
      model: agent.model,
      endpoint: agent.endpoint || '',
      apiKey: agent.apiKey || '',
      maxTokens: agent.maxTokens,
      temperature: agent.temperature,
      tools: agent.tools || [],
    })
    setEditView({ type: 'agent', id: agent.id })
    setError(null)

    // Prefetch models if agent has a provider
    if (agent.providerId) {
      fetchModels(agent.providerId)
    }
  }, [fetchModels])

  const handleNewAgent = useCallback(() => {
    setAgentForm(EMPTY_AGENT_FORM)
    setEditView({ type: 'agent', id: 'new' })
    setError(null)
  }, [])

  const handleSaveAgent = useCallback(async () => {
    if (!editView || editView.type !== 'agent') return
    setSaving(true)
    setError(null)

    try {
      // Resolve LLM fields based on source
      const providerId = agentForm.llmSource !== 'main' && agentForm.llmSource !== 'custom'
        ? agentForm.llmSource
        : undefined
      const endpoint = agentForm.llmSource === 'custom'
        ? agentForm.endpoint
        : undefined
      const apiKey = agentForm.llmSource === 'custom'
        ? (agentForm.apiKey || undefined)
        : undefined

      if (editView.id === 'new') {
        const options: CreateAgentDefinitionOptions = {
          slug: agentForm.slug,
          name: agentForm.name,
          description: agentForm.description,
          roleDefinition: agentForm.roleDefinition,
          whenToUse: agentForm.whenToUse,
          customInstructions: agentForm.customInstructions || undefined,
          providerId,
          model: agentForm.model,
          endpoint,
          apiKey,
          maxTokens: agentForm.maxTokens,
          temperature: agentForm.temperature,
          tools: agentForm.tools.length > 0 ? agentForm.tools : undefined,
        }
        await client.createAgentDefinition(options)
      } else {
        const options: UpdateAgentDefinitionOptions = {
          name: agentForm.name,
          description: agentForm.description,
          roleDefinition: agentForm.roleDefinition,
          whenToUse: agentForm.whenToUse,
          customInstructions: agentForm.customInstructions || undefined,
          providerId: providerId ?? null,
          model: agentForm.model,
          endpoint: endpoint || undefined,
          apiKey: apiKey,
          maxTokens: agentForm.maxTokens,
          temperature: agentForm.temperature,
          tools: agentForm.tools.length > 0 ? agentForm.tools : undefined,
        }
        await client.updateAgentDefinition(editView.id, options)
      }

      const updated = await client.listAgentDefinitions()
      setAgents(updated)
      onAgentsChanged()
      setEditView(null)
      setAgentForm(EMPTY_AGENT_FORM)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save agent')
    } finally {
      setSaving(false)
    }
  }, [editView, agentForm, client, onAgentsChanged])

  const handleDeleteAgent = useCallback(async (id: string) => {
    try {
      await client.deleteAgentDefinition(id)
      const updated = await client.listAgentDefinitions()
      setAgents(updated)
      onAgentsChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete agent')
    }
  }, [client, onAgentsChanged])

  // ========================================================================
  // Provider Handlers
  // ========================================================================

  const handleEditProvider = useCallback((provider: Provider) => {
    setProviderForm({
      name: provider.name,
      endpoint: provider.endpoint,
      apiKey: provider.apiKey || '',
      defaultModel: provider.defaultModel || '',
    })
    setEditView({ type: 'provider', id: provider.id })
    setError(null)
  }, [])

  const handleNewProvider = useCallback(() => {
    setProviderForm(EMPTY_PROVIDER_FORM)
    setEditView({ type: 'provider', id: 'new' })
    setError(null)
  }, [])

  const handleSaveProvider = useCallback(async () => {
    if (!editView || editView.type !== 'provider') return
    setSaving(true)
    setError(null)

    try {
      if (editView.id === 'new') {
        await client.createProvider({
          name: providerForm.name,
          endpoint: providerForm.endpoint,
          apiKey: providerForm.apiKey || undefined,
          defaultModel: providerForm.defaultModel || undefined,
        })
      } else {
        await client.updateProvider(editView.id, {
          name: providerForm.name,
          endpoint: providerForm.endpoint,
          apiKey: providerForm.apiKey || undefined,
          defaultModel: providerForm.defaultModel || undefined,
        })
      }

      const updated = await client.listProviders()
      setProviders(updated)
      setEditView(null)
      setProviderForm(EMPTY_PROVIDER_FORM)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save provider')
    } finally {
      setSaving(false)
    }
  }, [editView, providerForm, client])

  const handleDeleteProvider = useCallback(async (id: string) => {
    try {
      await client.deleteProvider(id)
      const updated = await client.listProviders()
      setProviders(updated)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete provider')
    }
  }, [client])

  const handleTestProvider = useCallback(async (providerId: string) => {
    // Clear cache so it forces a fresh fetch
    setModelsByProvider(prev => {
      const next = { ...prev }
      delete next[providerId]
      return next
    })
    await fetchModels(providerId)
  }, [fetchModels])

  // ========================================================================
  // Main Settings Handlers
  // ========================================================================

  const handleSaveMainSettings = useCallback(async () => {
    setSaving(true)
    setError(null)
    try {
      await client.updateSettings({
        llm: {
          apiEndpoint: mainSettingsForm.apiEndpoint,
          apiKey: mainSettingsForm.apiKey,
          model: mainSettingsForm.model,
        }
      })
      const updated = await client.getSettings()
      setSettings(updated)
      setEditView(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save settings')
    } finally {
      setSaving(false)
    }
  }, [mainSettingsForm, client])

  // ========================================================================
  // Agent Form Helpers
  // ========================================================================

  const handleApplyPreset = useCallback((presetName: string) => {
    const presetTools = toolPresets[presetName]
    if (presetTools) {
      setAgentForm(prev => ({ ...prev, tools: [...presetTools] }))
    }
  }, [toolPresets])

  const handleToggleTool = useCallback((toolName: string) => {
    setAgentForm(prev => {
      const tools = prev.tools.includes(toolName)
        ? prev.tools.filter(t => t !== toolName)
        : [...prev.tools, toolName]
      return { ...prev, tools }
    })
  }, [])

  const toggleSection = useCallback((section: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev)
      if (next.has(section)) next.delete(section)
      else next.add(section)
      return next
    })
  }, [])

  const updateAgentField = useCallback(<K extends keyof AgentFormData>(
    field: K,
    value: AgentFormData[K]
  ) => {
    setAgentForm(prev => ({ ...prev, [field]: value }))
  }, [])

  // When LLM source changes, prefetch models for the selected provider
  const handleLlmSourceChange = useCallback((source: LlmSource) => {
    setAgentForm(prev => ({ ...prev, llmSource: source }))
    if (source !== 'main' && source !== 'custom') {
      fetchModels(source)
    }
  }, [fetchModels])

  // ========================================================================
  // Render
  // ========================================================================

  if (loading) {
    return (
      <div className="h-full flex flex-col bg-muted/20">
        <PanelHeader onClose={onClose} title="Settings" />
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      </div>
    )
  }

  // ---- Main Settings Edit View ----
  if (editView?.type === 'main-settings') {
    return (
      <div className="h-full flex flex-col bg-muted/20">
        <PanelHeader onClose={() => setEditView(null)} title="Main LLM Settings" backButton />
        <div className="flex-1 overflow-auto thin-scrollbar p-3 space-y-3">
          {error && <ErrorBanner message={error} />}
          <FormField label="API Endpoint" required>
            <input
              type="text"
              value={mainSettingsForm.apiEndpoint}
              onChange={e => setMainSettingsForm(prev => ({ ...prev, apiEndpoint: e.target.value }))}
              placeholder="e.g. https://api.mistral.ai/v1/chat/completions"
              className="w-full px-2 py-1.5 text-sm bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </FormField>
          <FormField label="Model" required>
            <input
              type="text"
              value={mainSettingsForm.model}
              onChange={e => setMainSettingsForm(prev => ({ ...prev, model: e.target.value }))}
              placeholder="e.g. mistral-large-latest"
              className="w-full px-2 py-1.5 text-sm bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </FormField>
          <FormField label="API Key">
            <input
              type="password"
              value={mainSettingsForm.apiKey}
              onChange={e => setMainSettingsForm(prev => ({ ...prev, apiKey: e.target.value }))}
              placeholder="Your API key"
              className="w-full px-2 py-1.5 text-sm bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </FormField>
        </div>
        <SaveCancelFooter
          onCancel={() => setEditView(null)}
          onSave={handleSaveMainSettings}
          saving={saving}
          saveLabel="Save"
        />
      </div>
    )
  }

  // ---- Provider Edit View ----
  if (editView?.type === 'provider') {
    return (
      <div className="h-full flex flex-col bg-muted/20">
        <PanelHeader
          onClose={() => { setEditView(null); setProviderForm(EMPTY_PROVIDER_FORM) }}
          title={editView.id === 'new' ? 'New Provider' : `Edit: ${providerForm.name}`}
          backButton
        />
        <div className="flex-1 overflow-auto thin-scrollbar p-3 space-y-3">
          {error && <ErrorBanner message={error} />}
          <FormField label="Name" required>
            <input
              type="text"
              value={providerForm.name}
              onChange={e => setProviderForm(prev => ({ ...prev, name: e.target.value }))}
              placeholder="e.g. Mistral AI"
              className="w-full px-2 py-1.5 text-sm bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </FormField>
          <FormField label="Endpoint" required>
            <input
              type="text"
              value={providerForm.endpoint}
              onChange={e => setProviderForm(prev => ({ ...prev, endpoint: e.target.value }))}
              placeholder="e.g. https://api.mistral.ai/v1"
              className="w-full px-2 py-1.5 text-sm bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </FormField>
          <FormField label="API Key">
            <input
              type="password"
              value={providerForm.apiKey}
              onChange={e => setProviderForm(prev => ({ ...prev, apiKey: e.target.value }))}
              placeholder={editView.id !== 'new' ? '*** (unchanged if left empty)' : 'Optional API key'}
              className="w-full px-2 py-1.5 text-sm bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </FormField>
          <FormField label="Default Model">
            <input
              type="text"
              value={providerForm.defaultModel}
              onChange={e => setProviderForm(prev => ({ ...prev, defaultModel: e.target.value }))}
              placeholder="e.g. mistral-large-latest"
              className="w-full px-2 py-1.5 text-sm bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </FormField>
          {/* Test Connection button (only for existing providers) */}
          {editView.id !== 'new' && (
            <TestConnectionButton
              providerId={editView.id}
              models={modelsByProvider[editView.id]}
              loading={modelsLoading === editView.id}
              error={modelsError}
              onTest={() => handleTestProvider(editView.id as string)}
            />
          )}
        </div>
        <SaveCancelFooter
          onCancel={() => { setEditView(null); setProviderForm(EMPTY_PROVIDER_FORM) }}
          onSave={handleSaveProvider}
          saving={saving}
          saveLabel={editView.id === 'new' ? 'Create' : 'Save'}
        />
      </div>
    )
  }

  // ---- Agent Edit View ----
  if (editView?.type === 'agent') {
    return (
      <div className="h-full flex flex-col bg-muted/20">
        <PanelHeader
          onClose={() => { setEditView(null); setAgentForm(EMPTY_AGENT_FORM) }}
          title={editView.id === 'new' ? 'New Agent' : `Edit: ${agentForm.name}`}
          backButton
        />
        <div className="flex-1 overflow-auto thin-scrollbar p-3 space-y-3">
          {error && <ErrorBanner message={error} />}

          {/* Identity Section */}
          <FormSection
            title="Identity"
            section="identity"
            expanded={expandedSections.has('identity')}
            onToggle={toggleSection}
          >
            <FormField label="Name" required>
              <input
                type="text"
                value={agentForm.name}
                onChange={e => updateAgentField('name', e.target.value)}
                placeholder="e.g. Research Analyst"
                className="w-full px-2 py-1.5 text-sm bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </FormField>
            <FormField label="Slug" required hint={editView.id !== 'new' ? 'Read-only when editing' : undefined}>
              <input
                type="text"
                value={agentForm.slug}
                onChange={e => updateAgentField('slug', e.target.value)}
                placeholder="e.g. research-analyst"
                disabled={editView.id !== 'new'}
                className="w-full px-2 py-1.5 text-sm bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
              />
            </FormField>
            <FormField label="Description" required>
              <input
                type="text"
                value={agentForm.description}
                onChange={e => updateAgentField('description', e.target.value)}
                placeholder="Short description of what this agent does"
                className="w-full px-2 py-1.5 text-sm bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </FormField>
          </FormSection>

          {/* Behavior Section */}
          <FormSection
            title="Behavior"
            section="behavior"
            expanded={expandedSections.has('behavior')}
            onToggle={toggleSection}
          >
            <FormField label="Role Definition" required>
              <textarea
                value={agentForm.roleDefinition}
                onChange={e => updateAgentField('roleDefinition', e.target.value)}
                placeholder="Core instructions defining this agent's identity and behavior..."
                rows={4}
                className="w-full px-2 py-1.5 text-sm bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-ring resize-none"
              />
            </FormField>
            <FormField label="When to Use" required>
              <textarea
                value={agentForm.whenToUse}
                onChange={e => updateAgentField('whenToUse', e.target.value)}
                placeholder="Guidance on when to engage this agent..."
                rows={2}
                className="w-full px-2 py-1.5 text-sm bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-ring resize-none"
              />
            </FormField>
            <FormField label="Custom Instructions">
              <textarea
                value={agentForm.customInstructions}
                onChange={e => updateAgentField('customInstructions', e.target.value)}
                placeholder="Additional per-agent instructions (optional)..."
                rows={2}
                className="w-full px-2 py-1.5 text-sm bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-ring resize-none"
              />
            </FormField>
          </FormSection>

          {/* LLM Section */}
          <FormSection
            title="LLM Configuration"
            section="llm"
            expanded={expandedSections.has('llm')}
            onToggle={toggleSection}
          >
            {/* Provider / source selector */}
            <FormField label="LLM Source">
              <select
                value={agentForm.llmSource}
                onChange={e => handleLlmSourceChange(e.target.value)}
                className="w-full px-2 py-1.5 text-sm bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="main">Use main settings (default)</option>
                {providers.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
                <option value="custom">Custom endpoint</option>
              </select>
            </FormField>

            {/* Model field — dropdown when provider selected, text input otherwise */}
            <FormField label="Model" required>
              <ModelSelector
                value={agentForm.model}
                onChange={val => updateAgentField('model', val)}
                providerId={agentForm.llmSource !== 'main' && agentForm.llmSource !== 'custom' ? agentForm.llmSource : undefined}
                models={agentForm.llmSource !== 'main' && agentForm.llmSource !== 'custom'
                  ? modelsByProvider[agentForm.llmSource]
                  : undefined}
                loading={modelsLoading === agentForm.llmSource}
                placeholder={agentForm.llmSource === 'main' ? 'Leave empty to inherit from main settings' : 'e.g. mistral-large-latest'}
              />
            </FormField>

            {/* Custom endpoint fields — only shown for "custom" source */}
            {agentForm.llmSource === 'custom' && (
              <>
                <FormField label="Endpoint" required>
                  <input
                    type="text"
                    value={agentForm.endpoint}
                    onChange={e => updateAgentField('endpoint', e.target.value)}
                    placeholder="e.g. https://api.mistral.ai/v1/chat/completions"
                    className="w-full px-2 py-1.5 text-sm bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                </FormField>
                <FormField label="API Key">
                  <input
                    type="password"
                    value={agentForm.apiKey}
                    onChange={e => updateAgentField('apiKey', e.target.value)}
                    placeholder={editView.id !== 'new' ? '*** (unchanged if left empty)' : 'Optional API key'}
                    className="w-full px-2 py-1.5 text-sm bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                </FormField>
              </>
            )}

            <div className="flex gap-3">
              <FormField label="Max Tokens" className="flex-1">
                <input
                  type="number"
                  value={agentForm.maxTokens}
                  onChange={e => updateAgentField('maxTokens', parseInt(e.target.value) || 4096)}
                  min={1}
                  className="w-full px-2 py-1.5 text-sm bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </FormField>
              <FormField label={`Temperature: ${agentForm.temperature.toFixed(1)}`} className="flex-1">
                <input
                  type="range"
                  value={agentForm.temperature}
                  onChange={e => updateAgentField('temperature', parseFloat(e.target.value))}
                  min={0}
                  max={2}
                  step={0.1}
                  className="w-full mt-1"
                />
              </FormField>
            </div>
          </FormSection>

          {/* Tools Section */}
          <FormSection
            title="Tools"
            section="tools"
            expanded={expandedSections.has('tools')}
            onToggle={toggleSection}
          >
            {Object.keys(toolPresets).length > 0 && (
              <div className="flex flex-wrap gap-1 mb-2">
                <span className="text-xs text-muted-foreground mr-1 self-center">Presets:</span>
                {Object.keys(toolPresets).map(preset => (
                  <button
                    key={preset}
                    onClick={() => handleApplyPreset(preset)}
                    className="px-2 py-0.5 text-xs rounded border border-border hover:bg-accent transition-colors"
                  >
                    {preset}
                  </button>
                ))}
              </div>
            )}
            <div className="grid grid-cols-2 gap-1">
              {getAllToolNames(toolPresets).map(toolName => (
                <label
                  key={toolName}
                  className="flex items-center gap-1.5 text-xs cursor-pointer hover:bg-muted/50 rounded px-1 py-0.5"
                >
                  <input
                    type="checkbox"
                    checked={agentForm.tools.includes(toolName)}
                    onChange={() => handleToggleTool(toolName)}
                    className="rounded"
                  />
                  <span className="truncate">{toolName}</span>
                </label>
              ))}
            </div>
          </FormSection>
        </div>
        <SaveCancelFooter
          onCancel={() => { setEditView(null); setAgentForm(EMPTY_AGENT_FORM) }}
          onSave={handleSaveAgent}
          saving={saving}
          saveLabel={editView.id === 'new' ? 'Create' : 'Save'}
        />
      </div>
    )
  }

  // ---- Main List View (3 sections) ----
  return (
    <div className="h-full flex flex-col bg-muted/20">
      <PanelHeader onClose={onClose} title="Settings" />

      <div className="flex-1 overflow-auto thin-scrollbar p-3 space-y-3">
        {error && <ErrorBanner message={error} />}

        {/* Section 1: Main Settings */}
        <FormSection
          title="Main LLM Settings"
          section="main-settings"
          expanded={expandedSections.has('main-settings')}
          onToggle={toggleSection}
        >
          {settings && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Settings className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{settings.llm.model}</div>
                  <div className="text-xs text-muted-foreground truncate">{settings.llm.apiEndpoint}</div>
                </div>
                <button
                  onClick={() => {
                    setMainSettingsForm({
                      apiEndpoint: settings.llm.apiEndpoint,
                      apiKey: settings.llm.apiKey,
                      model: settings.llm.model,
                    })
                    setEditView({ type: 'main-settings' })
                  }}
                  className="p-1 hover:bg-accent rounded shrink-0"
                  title="Edit main settings"
                >
                  <Pencil className="w-3 h-3 text-muted-foreground" />
                </button>
              </div>
              <p className="text-[10px] text-muted-foreground">
                Used by agents without a specific provider or endpoint.
              </p>
            </div>
          )}
        </FormSection>

        {/* Section 2: Providers */}
        <FormSection
          title={`Providers (${providers.length})`}
          section="providers"
          expanded={expandedSections.has('providers')}
          onToggle={toggleSection}
        >
          {providers.length === 0 ? (
            <p className="text-xs text-muted-foreground py-2">No providers configured.</p>
          ) : (
            <div className="space-y-1.5">
              {providers.map(provider => (
                <ProviderCard
                  key={provider.id}
                  provider={provider}
                  onEdit={() => handleEditProvider(provider)}
                  onDelete={() => handleDeleteProvider(provider.id)}
                />
              ))}
            </div>
          )}
          <button
            onClick={handleNewProvider}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 mt-2 text-sm border border-dashed border-border rounded hover:bg-accent transition-colors text-muted-foreground hover:text-foreground"
          >
            <Plus className="w-3.5 h-3.5" />
            Add Provider
          </button>
        </FormSection>

        {/* Section 3: Agents */}
        <FormSection
          title={`Agents (${agents.length})`}
          section="agents"
          expanded={expandedSections.has('agents')}
          onToggle={toggleSection}
        >
          {agents.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-6 text-muted-foreground">
              <Bot className="w-8 h-8 mb-1.5 opacity-50" />
              <p className="text-xs">No agents defined yet</p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {agents.map(agent => (
                <AgentCard
                  key={agent.id}
                  agent={agent}
                  providers={providers}
                  onEdit={() => handleEditAgent(agent)}
                  onDelete={() => handleDeleteAgent(agent.id)}
                />
              ))}
            </div>
          )}
          <button
            onClick={handleNewAgent}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 mt-2 text-sm border border-dashed border-border rounded hover:bg-accent transition-colors text-muted-foreground hover:text-foreground"
          >
            <Plus className="w-3.5 h-3.5" />
            Add Agent
          </button>
        </FormSection>
      </div>
    </div>
  )
}

// ============================================================================
// Sub-components
// ============================================================================

function PanelHeader({
  onClose,
  title,
  backButton
}: {
  onClose: () => void
  title: string
  backButton?: boolean
}) {
  return (
    <div className="flex items-center justify-between px-3 py-2 border-b border-border">
      <div className="flex items-center gap-1.5">
        {backButton && (
          <button onClick={onClose} className="p-0.5 hover:bg-accent rounded">
            <ArrowLeft className="w-3.5 h-3.5 text-muted-foreground" />
          </button>
        )}
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </span>
      </div>
      {!backButton && (
        <button onClick={onClose} className="p-1 hover:bg-accent rounded" title="Close settings">
          <X className="w-3.5 h-3.5 text-muted-foreground" />
        </button>
      )}
    </div>
  )
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="p-2 bg-destructive/10 border border-destructive/20 rounded text-xs text-destructive">
      {message}
    </div>
  )
}

function SaveCancelFooter({
  onCancel,
  onSave,
  saving,
  saveLabel
}: {
  onCancel: () => void
  onSave: () => void
  saving: boolean
  saveLabel: string
}) {
  return (
    <div className="px-3 py-2 border-t border-border flex gap-2">
      <button
        onClick={onCancel}
        className="flex-1 px-3 py-1.5 text-sm border border-border rounded hover:bg-accent transition-colors"
      >
        Cancel
      </button>
      <button
        onClick={onSave}
        disabled={saving}
        className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded hover:bg-primary/90 transition-colors disabled:opacity-50"
      >
        {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
        {saveLabel}
      </button>
    </div>
  )
}

function ProviderCard({
  provider,
  onEdit,
  onDelete
}: {
  provider: Provider
  onEdit: () => void
  onDelete: () => void
}) {
  return (
    <div className="group p-2.5 border border-border rounded-lg hover:border-border/80 transition-colors">
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <Server className="w-3.5 h-3.5 text-green-500 shrink-0" />
            <span className="text-sm font-medium truncate">{provider.name}</span>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5 truncate">{provider.endpoint}</p>
          {provider.defaultModel && (
            <span className="text-[10px] text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded mt-1 inline-block">
              {provider.defaultModel}
            </span>
          )}
        </div>
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity ml-2">
          <button onClick={onEdit} className="p-1 hover:bg-accent rounded" title="Edit provider">
            <Pencil className="w-3 h-3 text-muted-foreground" />
          </button>
          <button onClick={onDelete} className="p-1 hover:bg-destructive/10 rounded" title="Delete provider">
            <Trash2 className="w-3 h-3 text-destructive" />
          </button>
        </div>
      </div>
    </div>
  )
}

function AgentCard({
  agent,
  providers,
  onEdit,
  onDelete
}: {
  agent: AgentDefinition
  providers: Provider[]
  onEdit: () => void
  onDelete: () => void
}) {
  const toolBadge = agent.tools ? `${agent.tools.length} tools` : 'default'

  // Determine LLM source label
  let sourceBadge = 'main'
  if (agent.providerId) {
    const provider = providers.find(p => p.id === agent.providerId)
    sourceBadge = provider ? provider.name : 'unknown provider'
  } else if (agent.endpoint) {
    sourceBadge = 'custom'
  }

  return (
    <div className="group p-2.5 border border-border rounded-lg hover:border-border/80 transition-colors">
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <Bot className="w-3.5 h-3.5 text-blue-500 shrink-0" />
            <span className="text-sm font-medium truncate">{agent.name}</span>
            <span className="text-[10px] text-muted-foreground font-mono bg-muted/50 px-1 py-0.5 rounded">
              {agent.slug}
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
            {agent.description}
          </p>
          <div className="flex items-center gap-2 mt-1.5">
            <span className="text-[10px] text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded">
              {agent.model}
            </span>
            <span className="text-[10px] text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded">
              {sourceBadge}
            </span>
            <span className="text-[10px] text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded">
              {toolBadge}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity ml-2">
          <button onClick={onEdit} className="p-1 hover:bg-accent rounded" title="Edit agent">
            <Pencil className="w-3 h-3 text-muted-foreground" />
          </button>
          <button onClick={onDelete} className="p-1 hover:bg-destructive/10 rounded" title="Delete agent">
            <Trash2 className="w-3 h-3 text-destructive" />
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * Model selector: shows a <select> dropdown when models are available from a provider,
 * falls back to a text input otherwise. Shows loading spinner while fetching.
 */
function ModelSelector({
  value,
  onChange,
  models,
  loading,
  placeholder
}: {
  value: string
  onChange: (value: string) => void
  providerId?: string
  models?: ModelInfo[]
  loading: boolean
  placeholder?: string
}) {
  // If we have models from the provider, show a combo: dropdown + free-text fallback
  if (models && models.length > 0) {
    return (
      <div className="space-y-1">
        <select
          value={models.some(m => m.id === value) ? value : '__custom__'}
          onChange={e => {
            if (e.target.value !== '__custom__') {
              onChange(e.target.value)
            }
          }}
          className="w-full px-2 py-1.5 text-sm bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-ring"
        >
          {!models.some(m => m.id === value) && (
            <option value="__custom__">{value || '(select a model)'}</option>
          )}
          {models.map(m => (
            <option key={m.id} value={m.id}>{m.id}</option>
          ))}
        </select>
        {/* Allow free-text override */}
        <input
          type="text"
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder="Or type a model name..."
          className="w-full px-2 py-1 text-xs bg-background border border-border/50 rounded focus:outline-none focus:ring-1 focus:ring-ring text-muted-foreground"
        />
      </div>
    )
  }

  // Loading state
  if (loading) {
    return (
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          className="flex-1 px-2 py-1.5 text-sm bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-ring"
        />
        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground shrink-0" />
      </div>
    )
  }

  // Plain text input
  return (
    <input
      type="text"
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full px-2 py-1.5 text-sm bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-ring"
    />
  )
}

/**
 * Test Connection button with result display.
 */
function TestConnectionButton({
  models,
  loading,
  error,
  onTest
}: {
  providerId: string
  models?: ModelInfo[]
  loading: boolean
  error: string | null
  onTest: () => void
}) {
  return (
    <div className="space-y-1.5">
      <button
        onClick={onTest}
        disabled={loading}
        className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-border rounded hover:bg-accent transition-colors disabled:opacity-50"
      >
        {loading ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : (
          <Zap className="w-3.5 h-3.5" />
        )}
        Test Connection
      </button>
      {models && (
        <div className="flex items-center gap-1 text-xs text-green-600">
          <CheckCircle className="w-3 h-3" />
          {models.length} model{models.length !== 1 ? 's' : ''} available
        </div>
      )}
      {error && (
        <div className="flex items-center gap-1 text-xs text-destructive">
          <AlertCircle className="w-3 h-3" />
          {error}
        </div>
      )}
    </div>
  )
}

function FormSection({
  title,
  section,
  expanded,
  onToggle,
  children
}: {
  title: string
  section: string
  expanded: boolean
  onToggle: (section: string) => void
  children: React.ReactNode
}) {
  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <button
        onClick={() => onToggle(section)}
        className="w-full flex items-center gap-1.5 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:bg-muted/30 transition-colors"
      >
        {expanded
          ? <ChevronDown className="w-3 h-3" />
          : <ChevronRight className="w-3 h-3" />
        }
        {title}
      </button>
      {expanded && (
        <div className="px-3 pb-3 space-y-2">
          {children}
        </div>
      )}
    </div>
  )
}

function FormField({
  label,
  required,
  hint,
  className,
  children
}: {
  label: string
  required?: boolean
  hint?: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={cn('space-y-0.5', className)}>
      <label className="text-xs text-muted-foreground">
        {label}
        {required && <span className="text-destructive ml-0.5">*</span>}
        {hint && <span className="ml-1 text-muted-foreground/60">({hint})</span>}
      </label>
      {children}
    </div>
  )
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Extracts a unique sorted list of all tool names from all presets.
 */
function getAllToolNames(presets: Record<string, string[]>): string[] {
  const allTools = new Set<string>()
  for (const tools of Object.values(presets)) {
    for (const tool of tools) {
      allTools.add(tool)
    }
  }
  return Array.from(allTools).sort()
}
