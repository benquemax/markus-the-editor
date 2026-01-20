/**
 * Floating action button for toggling the code editor split view.
 * Displays a code icon and shows Ctrl+M shortcut in tooltip.
 */

interface CodeEditorFabProps {
  /** Whether the code editor is currently shown */
  isActive: boolean
  /** Callback to toggle code editor visibility */
  onToggle: () => void
}

export function CodeEditorFab({ isActive, onToggle }: CodeEditorFabProps) {
  return (
    <button
      className={`code-editor-fab ${isActive ? 'active' : ''}`}
      onClick={onToggle}
      title="Toggle Code Editor (Ctrl+M)"
      aria-label="Toggle Code Editor"
    >
      {/* Code/terminal icon - using </> symbol */}
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <polyline points="16 18 22 12 16 6" />
        <polyline points="8 6 2 12 8 18" />
      </svg>
    </button>
  )
}
