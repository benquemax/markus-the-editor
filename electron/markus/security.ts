/**
 * Markus Security Module
 *
 * Provides path validation and sandboxing to ensure the AI agent
 * can only access files within explicitly allowed workspace directories.
 * This prevents unauthorized access to system files or other sensitive data.
 */

import path from 'path'
import { existsSync, statSync } from 'fs'

/**
 * Error thrown when a path access is denied due to security restrictions.
 */
export class PathSecurityError extends Error {
  constructor(
    public readonly attemptedPath: string,
    public readonly reason: string
  ) {
    super(`Access denied: ${reason}`)
    this.name = 'PathSecurityError'
  }
}

/**
 * Normalizes a path to absolute form and resolves symlinks conceptually.
 * This prevents directory traversal attacks using .. or symlinks.
 */
export function normalizePath(inputPath: string): string {
  // Resolve to absolute path
  const absolutePath = path.isAbsolute(inputPath)
    ? inputPath
    : path.resolve(inputPath)

  // Normalize to remove . and .. components
  return path.normalize(absolutePath)
}

/**
 * Checks if a path is inside one of the allowed directories.
 * Uses strict prefix matching after normalization.
 */
export function isPathInAllowedDirs(filePath: string, allowedDirs: string[]): boolean {
  const normalizedPath = normalizePath(filePath)

  for (const allowedDir of allowedDirs) {
    const normalizedAllowedDir = normalizePath(allowedDir)

    // Check if path starts with the allowed directory
    // Add trailing separator to prevent /home/user matching /home/user2
    const dirWithSep = normalizedAllowedDir.endsWith(path.sep)
      ? normalizedAllowedDir
      : normalizedAllowedDir + path.sep

    if (normalizedPath === normalizedAllowedDir || normalizedPath.startsWith(dirWithSep)) {
      return true
    }
  }

  return false
}

/**
 * Validates a path for read access within allowed directories.
 * Throws PathSecurityError if access is denied.
 */
export function validateReadPath(filePath: string, allowedDirs: string[]): string {
  const normalizedPath = normalizePath(filePath)

  if (allowedDirs.length === 0) {
    throw new PathSecurityError(filePath, 'No workspace folders are open')
  }

  if (!isPathInAllowedDirs(normalizedPath, allowedDirs)) {
    throw new PathSecurityError(
      filePath,
      `Path is outside allowed workspace directories: ${allowedDirs.join(', ')}`
    )
  }

  return normalizedPath
}

/**
 * Validates a path for write access within allowed directories.
 * Checks parent directory exists for new files.
 */
export function validateWritePath(filePath: string, allowedDirs: string[]): string {
  const normalizedPath = normalizePath(filePath)

  if (allowedDirs.length === 0) {
    throw new PathSecurityError(filePath, 'No workspace folders are open')
  }

  if (!isPathInAllowedDirs(normalizedPath, allowedDirs)) {
    throw new PathSecurityError(
      filePath,
      `Path is outside allowed workspace directories: ${allowedDirs.join(', ')}`
    )
  }

  // Check parent directory exists (for new files)
  const parentDir = path.dirname(normalizedPath)
  if (!existsSync(parentDir)) {
    throw new PathSecurityError(filePath, `Parent directory does not exist: ${parentDir}`)
  }

  return normalizedPath
}

/**
 * Validates a directory path for listing/creation.
 */
export function validateDirectoryPath(dirPath: string, allowedDirs: string[]): string {
  const normalizedPath = normalizePath(dirPath)

  if (allowedDirs.length === 0) {
    throw new PathSecurityError(dirPath, 'No workspace folders are open')
  }

  if (!isPathInAllowedDirs(normalizedPath, allowedDirs)) {
    throw new PathSecurityError(
      dirPath,
      `Path is outside allowed workspace directories: ${allowedDirs.join(', ')}`
    )
  }

  return normalizedPath
}

/**
 * Checks if a path exists and is a file.
 */
export function isFile(filePath: string): boolean {
  try {
    return existsSync(filePath) && statSync(filePath).isFile()
  } catch {
    return false
  }
}

/**
 * Checks if a path exists and is a directory.
 */
export function isDirectory(dirPath: string): boolean {
  try {
    return existsSync(dirPath) && statSync(dirPath).isDirectory()
  } catch {
    return false
  }
}

/**
 * Gets the relative path from a workspace root.
 * Useful for display purposes.
 */
export function getRelativePath(filePath: string, workspaceFolders: string[]): string {
  const normalizedPath = normalizePath(filePath)

  for (const folder of workspaceFolders) {
    const normalizedFolder = normalizePath(folder)
    if (normalizedPath.startsWith(normalizedFolder)) {
      return path.relative(normalizedFolder, normalizedPath)
    }
  }

  return filePath
}

/**
 * Finds which workspace folder contains a path.
 */
export function findContainingWorkspace(filePath: string, workspaceFolders: string[]): string | null {
  const normalizedPath = normalizePath(filePath)

  for (const folder of workspaceFolders) {
    const normalizedFolder = normalizePath(folder)
    const dirWithSep = normalizedFolder.endsWith(path.sep)
      ? normalizedFolder
      : normalizedFolder + path.sep

    if (normalizedPath === normalizedFolder || normalizedPath.startsWith(dirWithSep)) {
      return folder
    }
  }

  return null
}

/**
 * Validates an edit operation - checks that old_string exists in file.
 * This is a security measure to prevent arbitrary file overwrites.
 */
export function validateEditOperation(
  filePath: string,
  oldString: string,
  fileContent: string
): { valid: boolean; error?: string; occurrences: number } {
  // Count occurrences of the old string
  let count = 0
  let pos = 0
  while ((pos = fileContent.indexOf(oldString, pos)) !== -1) {
    count++
    pos += oldString.length
  }

  if (count === 0) {
    return {
      valid: false,
      error: `The string to replace was not found in ${filePath}`,
      occurrences: 0
    }
  }

  return {
    valid: true,
    occurrences: count
  }
}
