/**
 * MetadataPanel Component
 *
 * A collapsible panel that sits above the ProseMirror editor, allowing users
 * to view and edit YAML frontmatter fields. Designed for power users who work
 * with static site generators (Hugo, Jekyll, Astro, MDX).
 *
 * Collapsed: a small toggle button with a dot indicator when fields exist.
 * Expanded: slides down with key-value input rows for editing.
 */

import { useCallback } from 'react'
import { ChevronDown, Plus, X } from 'lucide-react'
import { cn } from '../../lib/utils'
import { FrontmatterField } from '../../lib/frontmatter'

interface MetadataPanelProps {
  fields: FrontmatterField[]
  onChange: (fields: FrontmatterField[]) => void
  isOpen: boolean
  onToggle: () => void
}

const INPUT_CLASS = cn(
  'px-2 py-1 text-sm rounded',
  'bg-background border border-border',
  'text-foreground placeholder:text-muted-foreground/50',
  'outline-none focus:ring-1 focus:ring-ring'
)

export function MetadataPanel({ fields, onChange, isOpen, onToggle }: MetadataPanelProps) {
  const hasFields = fields.length > 0

  const handleFieldChange = useCallback((index: number, prop: keyof FrontmatterField, value: string) => {
    const updated = [...fields]
    updated[index] = { ...updated[index], [prop]: value }
    onChange(updated)
  }, [fields, onChange])

  const handleDelete = useCallback((index: number) => {
    onChange(fields.filter((_, i) => i !== index))
  }, [fields, onChange])

  const handleAdd = useCallback(() => {
    onChange([...fields, { key: '', value: '' }])
  }, [fields, onChange])

  return (
    <div className="flex-shrink-0">
      {/* Toggle button — always visible */}
      <button
        onClick={onToggle}
        className={cn(
          'flex items-center gap-1.5 px-2 py-1 text-xs text-muted-foreground',
          'hover:text-foreground transition-colors rounded',
          'select-none'
        )}
        title={isOpen ? 'Hide metadata' : 'Show metadata'}
      >
        <ChevronDown
          className={cn(
            'w-3.5 h-3.5 transition-transform duration-200',
            !isOpen && '-rotate-90'
          )}
        />
        <span>Metadata</span>
        {/* Indicator dot when frontmatter exists and panel is collapsed */}
        {!isOpen && hasFields && (
          <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
        )}
      </button>

      {/* Expandable panel */}
      <div
        className={cn(
          'overflow-hidden transition-[max-height] duration-200 ease-in-out',
          isOpen ? 'max-h-96' : 'max-h-0'
        )}
      >
        <div className="px-3 pb-3 pt-1 border-b border-border bg-muted/30">
          {/* Field rows */}
          <div className="space-y-1.5">
            {fields.map((field, index) => (
              <div key={index} className="flex items-center gap-1.5">
                <input
                  type="text"
                  value={field.key}
                  onChange={e => handleFieldChange(index, 'key', e.target.value)}
                  placeholder="key"
                  className={cn('w-[30%]', INPUT_CLASS)}
                />
                <input
                  type="text"
                  value={field.value}
                  onChange={e => handleFieldChange(index, 'value', e.target.value)}
                  placeholder="value"
                  className={cn('flex-1', INPUT_CLASS)}
                />
                <button
                  onClick={() => handleDelete(index)}
                  className="p-1 text-muted-foreground hover:text-destructive transition-colors rounded"
                  title="Remove field"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>

          {/* Add field button */}
          <button
            onClick={handleAdd}
            className={cn(
              'flex items-center gap-1 mt-2 px-2 py-1 text-xs',
              'text-muted-foreground hover:text-foreground',
              'transition-colors rounded'
            )}
          >
            <Plus className="w-3 h-3" />
            <span>Add field</span>
          </button>
        </div>
      </div>
    </div>
  )
}
