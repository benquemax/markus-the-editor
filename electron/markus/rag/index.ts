/**
 * RAG (Retrieval-Augmented Generation) Module
 *
 * Exports all RAG-related functionality for semantic search.
 */

// Chunking
export {
  chunkMarkdown,
  chunkPlainText,
  chunkDocument,
  type TextChunk,
  type ChunkOptions
} from './chunker'

// Embeddings
export {
  BaseEmbeddingProvider,
  TFIDFEmbeddingProvider,
  APIEmbeddingProvider,
  LocalEmbeddingProvider,
  createEmbeddingProvider,
  type EmbeddingProvider,
  type EmbeddingConfig,
  type EmbeddingResult
} from './embeddings'

// Vector Store
export {
  VectorStore,
  type StoredDocument,
  type VectorSearchResult
} from './vectorStore'

// Index Manager
export {
  IndexManager,
  getIndexManager,
  resetIndexManager,
  type IndexStatus,
  type IndexManagerEvents
} from './indexManager'
