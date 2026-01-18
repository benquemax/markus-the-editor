import { GitBranch, FileText } from 'lucide-react'

interface StatusBarProps {
  wordCount: number
  charCount: number
  isDirty: boolean
  filePath: string | null
  isGitRepo: boolean
  onGitClick: () => void
}

export function StatusBar({
  wordCount,
  charCount,
  isDirty,
  filePath,
  isGitRepo,
  onGitClick
}: StatusBarProps) {
  return (
    <div className="h-6 bg-muted/50 border-t border-border flex items-center justify-between px-3 text-xs text-muted-foreground">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-1">
          <FileText className="w-3 h-3" />
          <span>{filePath ? filePath.split('/').pop() : 'Untitled'}</span>
          {isDirty && <span className="text-primary">*</span>}
        </div>
      </div>

      <div className="flex items-center gap-4">
        {isGitRepo && (
          <button
            onClick={onGitClick}
            className="flex items-center gap-1 hover:text-foreground transition-colors"
          >
            <GitBranch className="w-3 h-3" />
            <span>Git</span>
          </button>
        )}
        <span>{wordCount} words</span>
        <span>{charCount} chars</span>
      </div>
    </div>
  )
}
