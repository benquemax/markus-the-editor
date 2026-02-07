/**
 * Vector Store
 *
 * Stores and searches document embeddings for semantic retrieval.
 * Uses in-memory storage with optional persistence to disk.
 *
 * Note: This is a pure JavaScript implementation that doesn't require
 * native modules. For production use with large document sets, consider
 * integrating with better-sqlite3 + sqlite-vec.
 */

import fs from 'fs/promises'
import { existsSync } from 'fs'
import path from 'path'
import crypto from 'crypto'
import { TextChunk } from './chunker'
import { BaseEmbeddingProvider } from './embeddings'

// ============================================================================
// Types
// ============================================================================

/**
 * A document stored in the vector store.
 */
export interface StoredDocument {
  /** Chunk ID */
  id: string
  /** File path */
  filePath: string
  /** Chunk content */
  content: string
  /** Embedding vector */
  embedding: number[]
  /** Chunk metadata */
  metadata: {
    startLine: number
    endLine: number
    headingContext: string[]
    sectionTitle?: string
    chunkIndex: number
    tokens: number
  }
  /** File hash for change detection */
  fileHash: string
  /** Indexed timestamp */
  indexedAt: number
}

/**
 * Search result from vector store.
 */
export interface VectorSearchResult {
  /** Document data */
  document: StoredDocument
  /** Similarity score (0-1) */
  score: number
  /** Rank in results */
  rank: number
}

/**
 * File index entry for tracking changes.
 */
interface FileIndexEntry {
  /** File path */
  path: string
  /** Content hash */
  hash: string
  /** Last modified timestamp */
  modifiedAt: number
  /** Chunk IDs belonging to this file */
  chunkIds: string[]
}

// ============================================================================
// Vector Store
// ============================================================================

/**
 * In-memory vector store with disk persistence.
 */
export class VectorStore {
  /** Documents by ID */
  private documents = new Map<string, StoredDocument>()
  /** File index for change detection */
  private fileIndex = new Map<string, FileIndexEntry>()
  /** Embedding provider */
  private embedder: BaseEmbeddingProvider
  /** Store directory for persistence */
  private storeDir: string | null = null
  /** Whether the store has been modified since last save */
  private isDirty = false

  constructor(embedder: BaseEmbeddingProvider, storeDir?: string) {
    this.embedder = embedder
    this.storeDir = storeDir || null
  }

  /**
   * Calculate hash of file content.
   */
  private hashContent(content: string): string {
    return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16)
  }

  /**
   * Check if a file needs reindexing.
   */
  needsReindex(filePath: string, contentHash: string): boolean {
    const entry = this.fileIndex.get(filePath)
    if (!entry) return true
    return entry.hash !== contentHash
  }

  /**
   * Remove all chunks for a file.
   */
  removeFile(filePath: string): void {
    const entry = this.fileIndex.get(filePath)
    if (entry) {
      for (const chunkId of entry.chunkIds) {
        this.documents.delete(chunkId)
      }
      this.fileIndex.delete(filePath)
      this.isDirty = true
    }
  }

  /**
   * Index chunks from a file.
   */
  async indexChunks(
    chunks: TextChunk[],
    fileContent: string
  ): Promise<void> {
    if (chunks.length === 0) return

    const filePath = chunks[0].filePath
    const fileHash = this.hashContent(fileContent)

    // Check if file needs reindexing
    if (!this.needsReindex(filePath, fileHash)) {
      return
    }

    // Remove old chunks
    this.removeFile(filePath)

    // Generate embeddings for all chunks
    const texts = chunks.map(c => c.content)
    const embeddings = await this.embedder.embedBatch(texts)

    // Store documents
    const chunkIds: string[] = []
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i]
      const embedding = embeddings[i]

      const doc: StoredDocument = {
        id: chunk.id,
        filePath: chunk.filePath,
        content: chunk.content,
        embedding: embedding.vector,
        metadata: {
          startLine: chunk.startLine,
          endLine: chunk.endLine,
          headingContext: chunk.headingContext,
          sectionTitle: chunk.sectionTitle,
          chunkIndex: chunk.chunkIndex,
          tokens: chunk.tokens
        },
        fileHash,
        indexedAt: Date.now()
      }

      this.documents.set(chunk.id, doc)
      chunkIds.push(chunk.id)
    }

    // Update file index
    this.fileIndex.set(filePath, {
      path: filePath,
      hash: fileHash,
      modifiedAt: Date.now(),
      chunkIds
    })

    this.isDirty = true
  }

  /**
   * Search for similar documents.
   */
  async search(
    query: string,
    limit: number = 10,
    minScore: number = 0.3
  ): Promise<VectorSearchResult[]> {
    if (this.documents.size === 0) {
      return []
    }

    // Get query embedding
    const queryEmbedding = await this.embedder.embed(query)

    // Calculate similarity to all documents
    const results: VectorSearchResult[] = []

    for (const doc of this.documents.values()) {
      const score = this.embedder.cosineSimilarity(
        queryEmbedding.vector,
        doc.embedding
      )

      if (score >= minScore) {
        results.push({
          document: doc,
          score,
          rank: 0
        })
      }
    }

    // Sort by score descending
    results.sort((a, b) => b.score - a.score)

    // Assign ranks and limit
    const limited = results.slice(0, limit)
    for (let i = 0; i < limited.length; i++) {
      limited[i].rank = i + 1
    }

    return limited
  }

  /**
   * Search within specific files.
   */
  async searchInFiles(
    query: string,
    filePaths: string[],
    limit: number = 10,
    minScore: number = 0.3
  ): Promise<VectorSearchResult[]> {
    if (this.documents.size === 0) {
      return []
    }

    // Get query embedding
    const queryEmbedding = await this.embedder.embed(query)
    const fileSet = new Set(filePaths)

    // Calculate similarity to matching documents
    const results: VectorSearchResult[] = []

    for (const doc of this.documents.values()) {
      if (!fileSet.has(doc.filePath)) continue

      const score = this.embedder.cosineSimilarity(
        queryEmbedding.vector,
        doc.embedding
      )

      if (score >= minScore) {
        results.push({
          document: doc,
          score,
          rank: 0
        })
      }
    }

    // Sort and rank
    results.sort((a, b) => b.score - a.score)
    const limited = results.slice(0, limit)
    for (let i = 0; i < limited.length; i++) {
      limited[i].rank = i + 1
    }

    return limited
  }

  /**
   * Get all indexed file paths.
   */
  getIndexedFiles(): string[] {
    return Array.from(this.fileIndex.keys())
  }

  /**
   * Get total document count.
   */
  getDocumentCount(): number {
    return this.documents.size
  }

  /**
   * Get file count.
   */
  getFileCount(): number {
    return this.fileIndex.size
  }

  /**
   * Clear all data.
   */
  clear(): void {
    this.documents.clear()
    this.fileIndex.clear()
    this.isDirty = true
  }

  /**
   * Save to disk.
   */
  async save(): Promise<void> {
    if (!this.storeDir || !this.isDirty) return

    await fs.mkdir(this.storeDir, { recursive: true })

    // Save documents
    const docsPath = path.join(this.storeDir, 'documents.json')
    const docsData = Array.from(this.documents.values())
    await fs.writeFile(docsPath, JSON.stringify(docsData), 'utf-8')

    // Save file index
    const indexPath = path.join(this.storeDir, 'file_index.json')
    const indexData = Array.from(this.fileIndex.values())
    await fs.writeFile(indexPath, JSON.stringify(indexData), 'utf-8')

    this.isDirty = false
  }

  /**
   * Load from disk.
   */
  async load(): Promise<boolean> {
    if (!this.storeDir) return false

    const docsPath = path.join(this.storeDir, 'documents.json')
    const indexPath = path.join(this.storeDir, 'file_index.json')

    if (!existsSync(docsPath) || !existsSync(indexPath)) {
      return false
    }

    try {
      // Load documents
      const docsData = JSON.parse(await fs.readFile(docsPath, 'utf-8'))
      for (const doc of docsData) {
        this.documents.set(doc.id, doc as StoredDocument)
      }

      // Load file index
      const indexData = JSON.parse(await fs.readFile(indexPath, 'utf-8'))
      for (const entry of indexData) {
        this.fileIndex.set(entry.path, entry as FileIndexEntry)
      }

      this.isDirty = false
      return true
    } catch (error) {
      console.error('[VectorStore] Failed to load:', error)
      return false
    }
  }
}
