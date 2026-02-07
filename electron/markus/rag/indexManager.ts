/**
 * Index Manager
 *
 * Manages the RAG index lifecycle including:
 * - Workspace scanning and indexing
 * - Change detection and incremental updates
 * - Index persistence
 */

import fs from 'fs/promises'
import path from 'path'
import crypto from 'crypto'
import { chunkDocument } from './chunker'
import {
  BaseEmbeddingProvider,
  createEmbeddingProvider,
  EmbeddingConfig,
  LocalEmbeddingProvider
} from './embeddings'
import { VectorStore, VectorSearchResult } from './vectorStore'
import { RAGSettings } from '../agents/types'

// ============================================================================
// Types
// ============================================================================

/**
 * Index status.
 */
export interface IndexStatus {
  /** Whether indexing is in progress */
  indexing: boolean
  /** Total files to index */
  totalFiles: number
  /** Files indexed so far */
  indexedFiles: number
  /** Total chunks indexed */
  totalChunks: number
  /** Last index update time */
  lastUpdated: number | null
  /** Error if any */
  error?: string
}

/**
 * Index manager events.
 */
export interface IndexManagerEvents {
  'index:start': { totalFiles: number }
  'index:progress': { file: string; progress: number }
  'index:complete': { totalChunks: number; duration: number }
  'index:error': { error: string }
}

// ============================================================================
// Index Manager
// ============================================================================

/**
 * Manages RAG indexes for workspaces.
 */
export class IndexManager {
  private vectorStore: VectorStore | null = null
  private embedder: BaseEmbeddingProvider | null = null
  private workspaceFolders: string[] = []
  private settings: RAGSettings
  private status: IndexStatus = {
    indexing: false,
    totalFiles: 0,
    indexedFiles: 0,
    totalChunks: 0,
    lastUpdated: null
  }
  private storeDir: string

  /** Event listeners */
  private listeners = new Map<
    keyof IndexManagerEvents,
    Array<(data: IndexManagerEvents[keyof IndexManagerEvents]) => void>
  >()

  constructor(settings: RAGSettings, configDir: string) {
    this.settings = settings
    this.storeDir = path.join(configDir, 'rag')
  }

  /**
   * Initialize the index manager.
   */
  async initialize(workspaceFolders: string[]): Promise<void> {
    this.workspaceFolders = workspaceFolders

    if (!this.settings.enabled) {
      console.log('[IndexManager] RAG is disabled')
      return
    }

    // Create embedding provider
    const embeddingConfig: EmbeddingConfig = {
      provider: this.settings.embeddings.provider,
      model: this.settings.embeddings.model
    }
    this.embedder = createEmbeddingProvider(embeddingConfig)

    // Calculate workspace hash for storage path
    const workspaceHash = this.hashWorkspace(workspaceFolders)
    const storePath = path.join(this.storeDir, workspaceHash)

    // Create vector store
    this.vectorStore = new VectorStore(this.embedder, storePath)

    // Try to load existing index
    const loaded = await this.vectorStore.load()
    if (loaded) {
      console.log(
        `[IndexManager] Loaded existing index with ${this.vectorStore.getDocumentCount()} chunks`
      )
      this.status.totalChunks = this.vectorStore.getDocumentCount()
      this.status.lastUpdated = Date.now()
    }
  }

  /**
   * Hash workspace folders for unique storage path.
   */
  private hashWorkspace(folders: string[]): string {
    const sorted = [...folders].sort().join('|')
    return crypto.createHash('sha256').update(sorted).digest('hex').slice(0, 16)
  }

  /**
   * Get index status.
   */
  getStatus(): IndexStatus {
    return { ...this.status }
  }

  /**
   * Emit an event.
   */
  private emit<K extends keyof IndexManagerEvents>(
    event: K,
    data: IndexManagerEvents[K]
  ): void {
    const handlers = this.listeners.get(event) || []
    for (const handler of handlers) {
      handler(data)
    }
  }

  /**
   * Subscribe to an event.
   */
  on<K extends keyof IndexManagerEvents>(
    event: K,
    handler: (data: IndexManagerEvents[K]) => void
  ): () => void {
    const handlers = this.listeners.get(event) || []
    handlers.push(handler as (data: IndexManagerEvents[keyof IndexManagerEvents]) => void)
    this.listeners.set(event, handlers)

    return () => {
      const current = this.listeners.get(event) || []
      const index = current.indexOf(handler as (data: IndexManagerEvents[keyof IndexManagerEvents]) => void)
      if (index >= 0) {
        current.splice(index, 1)
      }
    }
  }

  /**
   * Index all markdown files in workspace.
   */
  async indexWorkspace(): Promise<void> {
    if (!this.settings.enabled || !this.vectorStore || !this.embedder) {
      return
    }

    if (this.status.indexing) {
      console.log('[IndexManager] Indexing already in progress')
      return
    }

    const startTime = Date.now()
    this.status.indexing = true
    this.status.indexedFiles = 0

    try {
      // Collect all markdown files
      const files: string[] = []
      for (const folder of this.workspaceFolders) {
        await this.collectFiles(folder, files)
      }

      this.status.totalFiles = files.length
      this.emit('index:start', { totalFiles: files.length })

      // Build TF-IDF vocabulary first (for local embeddings)
      if (this.embedder instanceof LocalEmbeddingProvider) {
        for (const file of files) {
          const content = await fs.readFile(file, 'utf-8')
          this.embedder.addDocument(content)
        }
      }

      // Index each file
      for (const file of files) {
        try {
          await this.indexFile(file)
          this.status.indexedFiles++
          this.emit('index:progress', {
            file,
            progress: this.status.indexedFiles / this.status.totalFiles
          })
        } catch (error) {
          console.error(`[IndexManager] Error indexing ${file}:`, error)
        }
      }

      // Save index
      await this.vectorStore.save()

      this.status.totalChunks = this.vectorStore.getDocumentCount()
      this.status.lastUpdated = Date.now()

      const duration = Date.now() - startTime
      this.emit('index:complete', {
        totalChunks: this.status.totalChunks,
        duration
      })

      console.log(
        `[IndexManager] Indexed ${this.status.totalChunks} chunks from ${files.length} files in ${duration}ms`
      )
    } catch (error) {
      this.status.error = String(error)
      this.emit('index:error', { error: String(error) })
    } finally {
      this.status.indexing = false
    }
  }

  /**
   * Collect files to index from a directory.
   */
  private async collectFiles(
    dir: string,
    files: string[],
    depth: number = 0
  ): Promise<void> {
    if (depth > 10) return // Max depth

    const entries = await fs.readdir(dir, { withFileTypes: true })

    for (const entry of entries) {
      // Skip hidden files and common ignore patterns
      if (
        entry.name.startsWith('.') ||
        entry.name === 'node_modules' ||
        entry.name === 'dist' ||
        entry.name === 'build'
      ) {
        continue
      }

      const fullPath = path.join(dir, entry.name)

      if (entry.isDirectory()) {
        await this.collectFiles(fullPath, files, depth + 1)
      } else if (entry.isFile()) {
        const ext = entry.name.toLowerCase().split('.').pop()
        if (['md', 'markdown', 'mdx', 'txt'].includes(ext || '')) {
          files.push(fullPath)
        }
      }
    }
  }

  /**
   * Index a single file.
   */
  async indexFile(filePath: string): Promise<void> {
    if (!this.vectorStore) return

    const content = await fs.readFile(filePath, 'utf-8')

    const chunks = chunkDocument(content, filePath, {
      maxChunkSize: this.settings.chunking.maxChunkSize,
      overlap: this.settings.chunking.overlap
    })

    await this.vectorStore.indexChunks(chunks, content)
  }

  /**
   * Remove a file from the index.
   */
  removeFile(filePath: string): void {
    if (!this.vectorStore) return
    this.vectorStore.removeFile(filePath)
  }

  /**
   * Search the index.
   */
  async search(
    query: string,
    limit: number = 10,
    minScore: number = 0.3
  ): Promise<VectorSearchResult[]> {
    if (!this.vectorStore || !this.settings.enabled) {
      return []
    }

    return this.vectorStore.search(query, limit, minScore)
  }

  /**
   * Search within specific files.
   */
  async searchInFiles(
    query: string,
    filePaths: string[],
    limit: number = 10
  ): Promise<VectorSearchResult[]> {
    if (!this.vectorStore || !this.settings.enabled) {
      return []
    }

    return this.vectorStore.searchInFiles(query, filePaths, limit)
  }

  /**
   * Clear the entire index.
   */
  async clear(): Promise<void> {
    if (!this.vectorStore) return
    this.vectorStore.clear()
    await this.vectorStore.save()
    this.status.totalChunks = 0
  }

  /**
   * Save the index.
   */
  async save(): Promise<void> {
    if (!this.vectorStore) return
    await this.vectorStore.save()
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let indexManagerInstance: IndexManager | null = null

/**
 * Get or create the global index manager.
 */
export function getIndexManager(
  settings?: RAGSettings,
  configDir?: string
): IndexManager {
  if (!indexManagerInstance && settings && configDir) {
    indexManagerInstance = new IndexManager(settings, configDir)
  }
  if (!indexManagerInstance) {
    throw new Error('IndexManager not initialized')
  }
  return indexManagerInstance
}

/**
 * Reset the global index manager.
 */
export function resetIndexManager(): void {
  if (indexManagerInstance) {
    indexManagerInstance = null
  }
}
