/**
 * Markus Memory System
 *
 * Manages persistent memory for the AI agent. Memory is stored in markdown
 * files with section headers, allowing organized storage of context that
 * persists across conversations.
 *
 * Two scopes:
 * - System: ~/.config/markus-the-editor/memory.md (global)
 * - Project: {workspace}/.markus/memory.md (per-project)
 */

import path from 'path'
import fs from 'fs/promises'
import { existsSync } from 'fs'
import { v4 as uuidv4 } from 'uuid'
import { MemoryScope, MemoryUpdateRequest, MemoryUpdateProposal } from './types'
import { getConfigDir } from './settings'

/**
 * Gets the system memory file path.
 */
function getSystemMemoryPath(): string {
  return path.join(getConfigDir(), 'memory.md')
}

/**
 * Gets the project memory file path.
 */
function getProjectMemoryPath(workspaceFolder: string): string {
  return path.join(workspaceFolder, '.markus', 'memory.md')
}

/**
 * Gets the system instructions file path.
 */
function getSystemInstructionsPath(): string {
  return path.join(getConfigDir(), 'instructions.md')
}

/**
 * Gets the project instructions file path.
 */
function getProjectInstructionsPath(workspaceFolder: string): string {
  return path.join(workspaceFolder, '.markus', 'instructions.md')
}

/**
 * Reads a memory file, returning empty string if not found.
 */
async function readMemoryFile(filePath: string): Promise<string> {
  if (!existsSync(filePath)) {
    return ''
  }

  try {
    return await fs.readFile(filePath, 'utf-8')
  } catch {
    return ''
  }
}

/**
 * Writes content to a memory file, creating directories as needed.
 */
async function writeMemoryFile(filePath: string, content: string): Promise<void> {
  const dir = path.dirname(filePath)
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(filePath, content, 'utf-8')
}

/**
 * Parses markdown content into sections.
 */
function parseSections(content: string): Map<string, string> {
  const sections = new Map<string, string>()
  const lines = content.split('\n')

  let currentSection = ''
  let currentContent: string[] = []

  for (const line of lines) {
    // Check for section header (## Section Name)
    const headerMatch = line.match(/^##\s+(.+)$/)

    if (headerMatch) {
      // Save previous section
      if (currentSection) {
        sections.set(currentSection, currentContent.join('\n').trim())
      }

      currentSection = headerMatch[1].trim()
      currentContent = []
    } else {
      currentContent.push(line)
    }
  }

  // Save last section
  if (currentSection) {
    sections.set(currentSection, currentContent.join('\n').trim())
  }

  return sections
}

/**
 * Serializes sections back to markdown.
 */
function serializeSections(sections: Map<string, string>): string {
  const parts: string[] = []

  for (const [header, content] of sections) {
    parts.push(`## ${header}\n\n${content}`)
  }

  return parts.join('\n\n') + '\n'
}

/**
 * Gets memory content for a scope.
 */
export async function getMemory(
  scope: MemoryScope,
  workspaceFolder?: string
): Promise<string> {
  if (scope === 'system') {
    return readMemoryFile(getSystemMemoryPath())
  }

  if (!workspaceFolder) {
    return ''
  }

  return readMemoryFile(getProjectMemoryPath(workspaceFolder))
}

/**
 * Gets all memory and instructions for context building.
 */
export async function getAllContext(workspaceFolders: string[]): Promise<{
  systemMemory: string
  systemInstructions: string
  projectMemory: string
  projectInstructions: string
}> {
  const systemMemory = await readMemoryFile(getSystemMemoryPath())
  const systemInstructions = await readMemoryFile(getSystemInstructionsPath())

  // Combine project memory/instructions from all workspace folders
  let projectMemory = ''
  let projectInstructions = ''

  for (const folder of workspaceFolders) {
    const memory = await readMemoryFile(getProjectMemoryPath(folder))
    const instructions = await readMemoryFile(getProjectInstructionsPath(folder))

    if (memory) {
      projectMemory += `\n### ${path.basename(folder)}\n\n${memory}\n`
    }
    if (instructions) {
      projectInstructions += `\n### ${path.basename(folder)}\n\n${instructions}\n`
    }
  }

  return {
    systemMemory,
    systemInstructions,
    projectMemory: projectMemory.trim(),
    projectInstructions: projectInstructions.trim()
  }
}

/**
 * Creates a proposal for updating memory.
 */
export async function proposeMemoryUpdate(
  request: MemoryUpdateRequest,
  workspaceFolder?: string
): Promise<MemoryUpdateProposal> {
  const currentContent = await getMemory(request.scope, workspaceFolder)
  const sections = parseSections(currentContent)

  // Apply the proposed change
  const proposedSections = new Map(sections)

  switch (request.action) {
    case 'add':
      if (proposedSections.has(request.section)) {
        // Append to existing section
        const existing = proposedSections.get(request.section) || ''
        proposedSections.set(request.section, existing + '\n\n' + request.content)
      } else {
        proposedSections.set(request.section, request.content)
      }
      break

    case 'update':
      proposedSections.set(request.section, request.content)
      break

    case 'remove':
      proposedSections.delete(request.section)
      break
  }

  const proposedContent = serializeSections(proposedSections)

  // Generate a simple diff
  const diff = generateDiff(currentContent, proposedContent)

  return {
    id: uuidv4(),
    scope: request.scope,
    currentContent,
    proposedContent,
    diff
  }
}

/**
 * Applies a memory update proposal.
 */
export async function applyMemoryUpdate(
  proposal: MemoryUpdateProposal,
  workspaceFolder?: string
): Promise<void> {
  if (proposal.scope === 'system') {
    await writeMemoryFile(getSystemMemoryPath(), proposal.proposedContent)
  } else if (workspaceFolder) {
    await writeMemoryFile(getProjectMemoryPath(workspaceFolder), proposal.proposedContent)
  }
}

/**
 * Generates a simple diff between two strings.
 */
function generateDiff(oldContent: string, newContent: string): string {
  const oldLines = oldContent.split('\n')
  const newLines = newContent.split('\n')
  const diff: string[] = []

  // Simple line-by-line comparison
  const maxLines = Math.max(oldLines.length, newLines.length)

  for (let i = 0; i < maxLines; i++) {
    const oldLine = oldLines[i]
    const newLine = newLines[i]

    if (oldLine === newLine) {
      diff.push(`  ${oldLine || ''}`)
    } else if (oldLine === undefined) {
      diff.push(`+ ${newLine}`)
    } else if (newLine === undefined) {
      diff.push(`- ${oldLine}`)
    } else {
      diff.push(`- ${oldLine}`)
      diff.push(`+ ${newLine}`)
    }
  }

  return diff.join('\n')
}

/**
 * Creates the default memory file with initial structure.
 */
export async function ensureMemoryFile(scope: MemoryScope, workspaceFolder?: string): Promise<void> {
  const filePath = scope === 'system'
    ? getSystemMemoryPath()
    : workspaceFolder
      ? getProjectMemoryPath(workspaceFolder)
      : null

  if (!filePath) return

  if (existsSync(filePath)) return

  const defaultContent = `# ${scope === 'system' ? 'Markus System' : 'Project'} Memory

This file stores information that Markus should remember across conversations.

## Preferences

(Add your preferences here)

## Context

(Add relevant context here)
`

  await writeMemoryFile(filePath, defaultContent)
}

/**
 * Creates the default instructions file.
 */
export async function ensureInstructionsFile(scope: MemoryScope, workspaceFolder?: string): Promise<void> {
  const filePath = scope === 'system'
    ? getSystemInstructionsPath()
    : workspaceFolder
      ? getProjectInstructionsPath(workspaceFolder)
      : null

  if (!filePath) return

  if (existsSync(filePath)) return

  const defaultContent = scope === 'system'
    ? `# Markus Global Instructions

These instructions are included in every conversation.

## Response Style

(Define your preferred response style)

## Formatting

(Define your preferred formatting)
`
    : `# Project Instructions

These instructions apply only to this project.

## Project Overview

(Describe your project)

## Coding Conventions

(Define coding conventions for this project)
`

  await writeMemoryFile(filePath, defaultContent)
}
