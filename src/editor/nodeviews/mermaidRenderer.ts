/**
 * Mermaid rendering utility module.
 *
 * Handles initialization and rendering of Mermaid diagrams with theme support.
 * Used by MermaidNodeView to render diagrams inside the ProseMirror editor.
 */

import mermaid from 'mermaid'

// Track whether mermaid has been initialized
let isInitialized = false

// Current theme for re-initialization when theme changes
let currentTheme: 'dark' | 'default' = 'default'

/**
 * Detects if the current document is using dark mode.
 * Checks for the 'dark' class on the html element, which is the
 * convention used by Tailwind CSS and this application.
 */
export function isDarkMode(): boolean {
  return document.documentElement.classList.contains('dark')
}

/**
 * Initializes or re-initializes mermaid with the appropriate theme.
 * Safe to call multiple times - only reinitializes if theme changed.
 */
export function initializeMermaid(forceReinit = false): void {
  const theme = isDarkMode() ? 'dark' : 'default'

  // Skip if already initialized with the same theme
  if (isInitialized && currentTheme === theme && !forceReinit) {
    return
  }

  currentTheme = theme
  isInitialized = true

  mermaid.initialize({
    startOnLoad: false,
    theme,
    // Custom theme variables for a polished look
    themeVariables: theme === 'dark' ? {
      // Dark theme colors
      primaryColor: '#3b82f6',
      primaryTextColor: '#f8fafc',
      primaryBorderColor: '#60a5fa',
      lineColor: '#94a3b8',
      secondaryColor: '#1e293b',
      tertiaryColor: '#334155',
      background: '#0f172a',
      mainBkg: '#1e293b',
      nodeBorder: '#475569',
      clusterBkg: '#1e293b',
      clusterBorder: '#475569',
      titleColor: '#f8fafc',
      edgeLabelBackground: '#1e293b',
    } : {
      // Light theme colors
      primaryColor: '#3b82f6',
      primaryTextColor: '#1e293b',
      primaryBorderColor: '#2563eb',
      lineColor: '#64748b',
      secondaryColor: '#f1f5f9',
      tertiaryColor: '#e2e8f0',
      background: '#ffffff',
      mainBkg: '#f8fafc',
      nodeBorder: '#cbd5e1',
      clusterBkg: '#f1f5f9',
      clusterBorder: '#cbd5e1',
      titleColor: '#1e293b',
      edgeLabelBackground: '#ffffff',
    },
    // Flowchart settings
    flowchart: {
      htmlLabels: true,
      curve: 'basis',
      padding: 15,
    },
    // Sequence diagram settings
    sequence: {
      diagramMarginX: 50,
      diagramMarginY: 10,
      actorMargin: 50,
      width: 150,
      height: 65,
      boxMargin: 10,
      boxTextMargin: 5,
      noteMargin: 10,
      messageMargin: 35,
    },
    // Security - disable clicking on diagram elements
    securityLevel: 'strict',
  })
}

/**
 * Renders mermaid diagram code to SVG.
 *
 * @param code - The mermaid diagram definition
 * @param id - Unique identifier for the diagram (used for mermaid's internal rendering)
 * @returns Object with either svg string or error message
 */
export async function renderMermaid(
  code: string,
  id: string
): Promise<{ svg?: string; error?: string }> {
  // Ensure mermaid is initialized with current theme
  initializeMermaid()

  // Empty code should show as empty, not as error
  if (!code.trim()) {
    return { error: 'Empty diagram - add mermaid code to render' }
  }

  try {
    // Validate the diagram syntax first
    const valid = await mermaid.parse(code)
    if (!valid) {
      return { error: 'Invalid mermaid syntax' }
    }

    // Render to SVG
    const { svg } = await mermaid.render(id, code)
    return { svg }
  } catch (err) {
    // Extract useful error message from mermaid's error
    const errorMessage = err instanceof Error ? err.message : 'Failed to render diagram'
    // Clean up common mermaid error prefixes
    const cleanedMessage = errorMessage
      .replace(/^Error: /, '')
      .replace(/^Syntax error in graph/, 'Syntax error')
    return { error: cleanedMessage }
  }
}

/**
 * Forces mermaid to reinitialize with the current theme.
 * Call this when the theme changes to update diagram colors.
 */
export function reinitializeMermaidForTheme(): void {
  initializeMermaid(true)
}
